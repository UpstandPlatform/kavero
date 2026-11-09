import { createHmac, timingSafeEqual } from "node:crypto";

import { requireCatalog } from "@Kavero/api/services/access";
import { PublicationService } from "@Kavero/api/services/publication-service";

import { auth, db } from "@/services";

export type Publication = NonNullable<Awaited<ReturnType<PublicationService["findBySlug"]>>>;
export type Access = { kind: "ok"; pub: Publication; isOwner: boolean } | { kind: "password"; pub: Publication } | { kind: "missing" };

export const publications = () => new PublicationService(db);

const secret = () => {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("BETTER_AUTH_SECRET is not set");
  return s;
};

export const unlockCookieName = (pubId: string) => `kv_unlock_${pubId.replace(/-/g, "").slice(0, 16)}`;

/** Bound to the current password hash, so changing the password locks old visitors out. */
export function unlockToken(pub: Publication) {
  return createHmac("sha256", secret()).update(`${pub.id}:${pub.passwordHash ?? ""}`).digest("base64url");
}

function tokenMatches(pub: Publication, token: string | undefined) {
  if (!token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(unlockToken(pub));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Decide what a visitor may see. Private and unknown slugs look identical (no leaks). */
export async function resolveAccess(slug: string, headers: Headers, cookie: (name: string) => string | undefined): Promise<Access> {
  const pub = await publications().findBySlug(slug);
  if (!pub) return { kind: "missing" };
  const session = await auth.api.getSession({ headers }).catch(() => null);
  // "Owner" = anyone who can read the source catalog *now* (its owner or workspace members);
  // pub.ownerId is only who published it, and they may have lost access since.
  const isOwner = !!session && !!(await requireCatalog(db, session.user.id, pub.catalogId, "read").catch(() => null));
  if (isOwner) return { kind: "ok", pub, isOwner };
  switch (pub.visibility) {
    case "public":
    case "unlisted":
      return { kind: "ok", pub, isOwner };
    case "password":
      return tokenMatches(pub, cookie(unlockCookieName(pub.id))) ? { kind: "ok", pub, isOwner } : { kind: "password", pub };
    case "private":
      return { kind: "missing" };
  }
}

// ---------- Password brute-force guard (in memory, per server process) ----------

const WINDOW_MS = 15 * 60_000;
/** Failed attempts allowed per client per publication, and per publication from everyone together. */
const PER_CLIENT = 10;
const PER_PUBLICATION = 100;
const MAX_KEYS = 50_000;

type Bucket = { n: number; until: number };
const g = globalThis as unknown as { __kaveroUnlockFailures?: Map<string, Bucket> };
const failures = (g.__kaveroUnlockFailures ??= new Map());

function prune(now: number) {
  for (const [k, b] of failures) if (b.until <= now) failures.delete(k);
  // Still too many (e.g. a spray of fake IPs): drop the oldest client buckets, never the per-publication ones.
  for (const k of failures.keys()) {
    if (failures.size <= MAX_KEYS) break;
    if (!k.startsWith("pub:")) failures.delete(k);
  }
}

const count = (key: string, now: number) => {
  const b = failures.get(key);
  return b && b.until > now ? b.n : 0;
};

/**
 * Client address for rate limiting. X-Forwarded-For is only trusted behind a
 * proxy we control (TRUST_PROXY=1, or the number of proxy hops); then the
 * entry that proxy appended is used, not the client-supplied first one.
 * Without it there is no trustworthy per-client address, so null.
 */
export function clientIp(headers: Headers): string | null {
  const hops = Number(process.env.TRUST_PROXY === "true" ? 1 : process.env.TRUST_PROXY ?? 0);
  if (!(hops >= 1)) return null;
  const chain = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return chain[chain.length - Math.floor(hops)] ?? null;
}

function keys(pubId: string, ip: string | null) {
  return ip ? [`pub:${pubId}`, `ip:${pubId}:${ip}`] : [`pub:${pubId}`];
}

/** False while this client (or the publication as a whole) has too many recent failures. */
export function attemptAllowed(pubId: string, ip: string | null): boolean {
  const now = Date.now();
  if (count(`pub:${pubId}`, now) >= PER_PUBLICATION) return false;
  return !ip || count(`ip:${pubId}:${ip}`, now) < PER_CLIENT;
}

export function recordFailure(pubId: string, ip: string | null) {
  const now = Date.now();
  if (failures.size > MAX_KEYS) prune(now);
  for (const key of keys(pubId, ip)) {
    const b = failures.get(key);
    if (!b || b.until <= now) failures.set(key, { n: 1, until: now + WINDOW_MS });
    else b.n += 1;
  }
}
