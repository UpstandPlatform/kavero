import { randomUUID } from "node:crypto";

import type { Database } from "@Kavero/db";
import { user } from "@Kavero/db/schema/auth";
import { AUDIT_AREAS, auditLog, type AuditArea, type AuditChannel } from "@Kavero/db/schema/integration";
import { and, desc, eq, ilike, lt, or, type SQL } from "drizzle-orm";

export const SCOPES = {
  "catalogs:read": "View catalogs and their content",
  "catalogs:write": "Create and edit catalogs",
  "catalogs:delete": "Delete catalogs",
  "assets:write": "Import images and fonts",
  "exports:read": "Render previews and export files",
  "ai:generate": "Generate catalogs with AI",
  "workspaces:write": "Create catalogs in team workspaces",
  publish: "Publish and unpublish websites",
} as const;
export type Scope = keyof typeof SCOPES;

const SCOPE_PERMISSIONS: Record<Scope, readonly [resource: string, action: string]> = {
  "catalogs:read": ["catalogs", "read"],
  "catalogs:write": ["catalogs", "write"],
  "catalogs:delete": ["catalogs", "delete"],
  "assets:write": ["assets", "write"],
  "exports:read": ["exports", "read"],
  "ai:generate": ["ai", "generate"],
  "workspaces:write": ["workspaces", "write"],
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

/** Convert Better Auth's permission record into the only MCP scopes Kavero accepts. */
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

export type AuditOutcome = "ok" | "denied" | "error";
export { AUDIT_AREAS };
export type { AuditArea, AuditChannel };

export interface ApiKeyPrincipal {
  userId: string;
  apiKeyId: string;
  scopes: Scope[];
}

function areaFor(action: string): AuditArea {
  if (action === "catalog:move_workspace") return "workspace";
  if (action.startsWith("catalog:")) return "catalogs";
  if (action.startsWith("api-key:")) return "api_keys";
  if (action.startsWith("admin:")) return "admin";
  if (action.startsWith("workspace:")) return "workspace";
  if (action.startsWith("publication:")) return "publication";
  if (action.startsWith("ai:")) return "ai";
  if (action.startsWith("mcp-client:")) return "integrations";
  if (action.startsWith("auth:")) return "auth";
  if (action.startsWith("account:")) return "account";
  if (action.startsWith("mcp:")) {
    const tool = action.slice("mcp:".length);
    if (tool.startsWith("font_") || tool === "asset_import") return "assets";
    if (tool.startsWith("catalog_export_") || tool === "catalog_preview") return "exports";
    if (tool.startsWith("catalog_publish") || tool.startsWith("catalog_unpublish")) return "publication";
    if (tool === "catalog_generate") return "ai";
    return "catalogs";
  }
  return "account";
}

function channelFor(action: string): AuditChannel {
  if (action.startsWith("mcp:")) return "mcp";
  if (action.startsWith("admin:")) return "admin";
  if (action.startsWith("system:")) return "system";
  return "web";
}

export async function audit(db: Database, entry: {
  userId?: string | null;
  apiKeyId?: string | null;
  /** Set explicitly for operations whose area isn't implied by the action name. */
  area?: AuditArea;
  channel?: AuditChannel;
  action: string;
  target?: string | null;
  outcome: AuditOutcome;
  details?: unknown;
}) {
  try {
    await db.insert(auditLog).values({
      id: randomUUID(),
      userId: entry.userId ?? null,
      apiKeyId: entry.apiKeyId ?? null,
      area: entry.area ?? areaFor(entry.action),
      channel: entry.channel ?? channelFor(entry.action),
      action: entry.action.slice(0, 120),
      target: entry.target?.slice(0, 300) ?? null,
      outcome: entry.outcome,
      details: entry.details ?? null,
    });
  } catch (error) {
    // A log storage issue must not turn a successful user operation into a failed request.
    console.error("Failed to persist audit record", {
      action: entry.action.slice(0, 120),
      area: entry.area ?? areaFor(entry.action),
      error: error instanceof Error ? error.message : "Unknown database error",
    });
  }
}

export async function listAudit(db: Database, input: {
  userId?: string;
  area?: AuditArea;
  outcome?: AuditOutcome;
  limit: number;
  before?: Date;
  beforeId?: string;
  actor?: string;
}) {
  const cursor: SQL | undefined = input.before
    ? input.beforeId
      ? or(lt(auditLog.createdAt, input.before), and(eq(auditLog.createdAt, input.before), lt(auditLog.id, input.beforeId)))
      : lt(auditLog.createdAt, input.before)
    : undefined;
  const where = and(
    input.userId ? eq(auditLog.userId, input.userId) : undefined,
    input.area ? eq(auditLog.area, input.area) : undefined,
    input.outcome ? eq(auditLog.outcome, input.outcome) : undefined,
    input.actor?.trim() ? ilike(user.email, `%${input.actor.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`) : undefined,
    cursor,
  );
  const rows = await db.select({
    id: auditLog.id,
    userId: auditLog.userId,
    apiKeyId: auditLog.apiKeyId,
    area: auditLog.area,
    channel: auditLog.channel,
    action: auditLog.action,
    target: auditLog.target,
    outcome: auditLog.outcome,
    details: auditLog.details,
    createdAt: auditLog.createdAt,
    userEmail: user.email,
  }).from(auditLog)
    .leftJoin(user, eq(user.id, auditLog.userId))
    .where(where)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(input.limit + 1);
  const hasMore = rows.length > input.limit;
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return { rows: page, hasMore, nextCursor: hasMore && last ? { before: last.createdAt, beforeId: last.id } : null };
}

/** A ban without an end date, or one that hasn't ended yet. */
export function isBanned(u: { banned: boolean | null; banExpires: Date | null }) {
  return !!u.banned && (!u.banExpires || u.banExpires > new Date());
}
