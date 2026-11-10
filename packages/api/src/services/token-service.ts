import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { Database } from "@Kavero/db";
import { user } from "@Kavero/db/schema/auth";
import { apiToken, auditLog } from "@Kavero/db/schema/integration";
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, gt, isNull, or } from "drizzle-orm";

export const SCOPES = {
  "catalogs:read": "Read catalogs",
  "catalogs:write": "Create and edit catalogs",
  "catalogs:delete": "Delete catalogs",
  publish: "Publish and unpublish websites",
} as const;
export type Scope = keyof typeof SCOPES;

/** Shared scope-to-permission mapping for first-party API keys and the MCP server. */
const SCOPE_PERMISSIONS: Record<Scope, readonly [resource: string, action: string]> = {
  "catalogs:read": ["catalogs", "read"],
  "catalogs:write": ["catalogs", "write"],
  "catalogs:delete": ["catalogs", "delete"],
  publish: ["publication", "publish"],
};

export function scopesToPermissions(scopes: readonly Scope[]) {
  const permissions: Record<string, string[]> = {};
  for (const scope of scopes) {
    const [resource, action] = SCOPE_PERMISSIONS[scope];
    (permissions[resource] ??= []).push(action);
  }
  return permissions;
}

/** Converts the Better Auth plugin's stored permissions back to the MCP scope set. */
export function permissionsToScopes(value: unknown): Scope[] {
  let permissions = value;
  if (typeof permissions === "string") {
    try {
      permissions = JSON.parse(permissions) as unknown;
    } catch {
      return [];
    }
  }
  if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) return [];
  const record = permissions as Record<string, unknown>;
  return (Object.entries(SCOPE_PERMISSIONS) as [Scope, readonly [string, string]][])
    .filter(([, [resource, action]]) => Array.isArray(record[resource]) && record[resource].includes(action))
    .map(([scope]) => scope);
}

const TOKEN_PREFIX = "kv_";
/** Active (not revoked, not expired) tokens per user. */
export const MAX_TOKENS_PER_USER = 50;
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export interface TokenPrincipal {
  userId: string;
  tokenId: string;
  scopes: Scope[];
}

/** Personal access tokens. The secret is returned once at creation and never stored. */
export class TokenService {
  constructor(private readonly db: Database) {}

  async create(userId: string, input: { name: string; scopes: Scope[]; expiresInDays?: number }) {
    const [active] = await this.db.select({ n: count() }).from(apiToken)
      .where(and(eq(apiToken.userId, userId), isNull(apiToken.revokedAt), or(isNull(apiToken.expiresAt), gt(apiToken.expiresAt, new Date()))));
    if ((active?.n ?? 0) >= MAX_TOKENS_PER_USER) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `You have ${MAX_TOKENS_PER_USER} active tokens. Revoke one you no longer use first.` });
    }
    const secret = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const id = randomUUID();
    const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null;
    await this.db.insert(apiToken).values({
      id, userId, name: input.name.trim().slice(0, 80) || "Token", prefix: secret.slice(0, 10),
      tokenHash: hashToken(secret), scopes: [...new Set(input.scopes)], expiresAt,
    });
    return { id, token: secret, expiresAt };
  }

  async list(userId: string) {
    return this.db
      .select({ id: apiToken.id, name: apiToken.name, prefix: apiToken.prefix, scopes: apiToken.scopes, lastUsedAt: apiToken.lastUsedAt, expiresAt: apiToken.expiresAt, createdAt: apiToken.createdAt })
      .from(apiToken)
      .where(and(eq(apiToken.userId, userId), isNull(apiToken.revokedAt)))
      .orderBy(desc(apiToken.createdAt));
  }

  async revoke(userId: string, id: string) {
    await this.db.update(apiToken).set({ revokedAt: new Date() }).where(and(eq(apiToken.id, id), eq(apiToken.userId, userId)));
    return { ok: true };
  }

  /** Resolve a bearer token, or null if unknown, revoked or expired. */
  async authenticate(token: string): Promise<TokenPrincipal | null> {
    if (!token.startsWith(TOKEN_PREFIX) || token.length > 200) return null;
    const [row] = await this.db.select().from(apiToken).where(eq(apiToken.tokenHash, hashToken(token))).limit(1);
    if (!row || row.revokedAt || (row.expiresAt && row.expiresAt < new Date())) return null;
    // Suspended accounts lose API and MCP access too, not just browser sign-in.
    const [owner] = await this.db.select({ banned: user.banned, banExpires: user.banExpires }).from(user).where(eq(user.id, row.userId)).limit(1);
    if (!owner || isBanned(owner)) return null;
    // Don't write on every request: once a minute is enough for "last used".
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
      await this.db.update(apiToken).set({ lastUsedAt: new Date() }).where(eq(apiToken.id, row.id));
    }
    return { userId: row.userId, tokenId: row.id, scopes: row.scopes as Scope[] };
  }
}

export async function audit(db: Database, entry: { userId?: string | null; tokenId?: string | null; action: string; target?: string | null; outcome: "ok" | "denied" | "error"; details?: unknown }) {
  try {
    await db.insert(auditLog).values({ id: randomUUID(), userId: entry.userId ?? null, tokenId: entry.tokenId ?? null, action: entry.action, target: entry.target ?? null, outcome: entry.outcome, details: entry.details ?? null });
  } catch {
    // Auditing must never break the request.
  }
}

export async function recentAudit(db: Database, userId: string, limit = 50) {
  return db.select().from(auditLog).where(eq(auditLog.userId, userId)).orderBy(desc(auditLog.createdAt)).limit(limit);
}

/** A ban without an end date, or one that hasn't ended yet. */
export function isBanned(u: { banned: boolean | null; banExpires: Date | null }) {
  return !!u.banned && (!u.banExpires || u.banExpires > new Date());
}
