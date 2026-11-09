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
  // "Owner" here = anyone who can read the source catalog (its owner or workspace members).
  const isOwner = !!session && (session.user.id === pub.ownerId || !!(await requireCatalog(db, session.user.id, pub.catalogId, "read").catch(() => null)));
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

// Simple in-memory brute-force guard for password attempts (per publication + IP).
const attempts = new Map<string, { n: number; until: number }>();
export function allowAttempt(key: string): boolean {
  const now = Date.now();
  const a = attempts.get(key);
  if (a && a.until > now && a.n >= 10) return false;
  if (!a || a.until <= now) attempts.set(key, { n: 1, until: now + 15 * 60_000 });
  else a.n += 1;
  return true;
}
