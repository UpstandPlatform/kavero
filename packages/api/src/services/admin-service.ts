import { SIGNUP_POLICY_KEY, getSignupPolicy, type SignupPolicy } from "@Kavero/auth";
import type { Database } from "@Kavero/db";
import { session, user } from "@Kavero/db/schema/auth";
import { catalog, catalogAsset } from "@Kavero/db/schema/catalog";
import { aiJob, apiToken, appSetting, auditLog } from "@Kavero/db/schema/integration";
import { publication } from "@Kavero/db/schema/publication";
import { workspace } from "@Kavero/db/schema/workspace";
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, gte, ilike, isNull, lt, max, or, sql, sum } from "drizzle-orm";

import { audit, isBanned } from "./token-service";

const DAY = 24 * 60 * 60 * 1000;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Server administration: users, roles, suspensions, sign-up policy and
 * published-site moderation. Every method assumes the caller is an admin
 * (enforced by adminProcedure) and records what it did in the audit log.
 */
export class AdminService {
  constructor(private readonly db: Database, private readonly adminId: string) {}

  private log(action: string, target: string | null, details?: unknown) {
    return audit(this.db, { userId: this.adminId, action: `admin:${action}`, target, outcome: "ok", details });
  }

  private async target(userId: string) {
    const [u] = await this.db.select().from(user).where(eq(user.id, userId)).limit(1);
    if (!u) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
    return u;
  }

  private async adminCount() {
    const [r] = await this.db.select({ n: count() }).from(user).where(eq(user.role, "admin"));
    return r?.n ?? 0;
  }

  /** Refuse anything that would leave the server without an admin or lock the caller out. */
  private async guardAdminChange(target: { id: string; role: string }, what: string) {
    if (target.id === this.adminId) throw new TRPCError({ code: "BAD_REQUEST", message: `You can't ${what} your own account. Ask another admin.` });
    if (target.role === "admin" && (await this.adminCount()) <= 1) throw new TRPCError({ code: "BAD_REQUEST", message: "This is the last admin. Make someone else an admin first." });
  }

  async overview() {
    const since30 = new Date(Date.now() - 30 * DAY);
    const since7 = new Date(Date.now() - 7 * DAY);
    const one = async <T>(q: Promise<T[]>) => (await q)[0]!;
    const [users, catalogs, sites, workspaces, storage, ai, policy] = await Promise.all([
      one(this.db.select({
        total: count(),
        admins: sql<number>`count(*) filter (where ${user.role} = 'admin')`.mapWith(Number),
        banned: sql<number>`count(*) filter (where ${user.banned} = true)`.mapWith(Number),
        new7: sql<number>`count(*) filter (where ${user.createdAt} >= ${since7})`.mapWith(Number),
        new30: sql<number>`count(*) filter (where ${user.createdAt} >= ${since30})`.mapWith(Number),
      }).from(user)),
      one(this.db.select({ total: count() }).from(catalog)),
      one(this.db.select({ total: count(), views: sum(publication.views).mapWith(Number) }).from(publication)),
      one(this.db.select({ total: count() }).from(workspace)),
      one(this.db.select({ bytes: sum(catalogAsset.bytes).mapWith(Number), files: count() }).from(catalogAsset)),
      one(this.db.select({
        total: count(),
        errors: sql<number>`count(*) filter (where ${aiJob.status} = 'error')`.mapWith(Number),
      }).from(aiJob).where(gte(aiJob.createdAt, since30))),
      getSignupPolicy(this.db),
    ]);
    return {
      users,
      catalogs: catalogs.total,
      sites: { total: sites.total, views: sites.views ?? 0 },
      workspaces: workspaces.total,
      storage: { bytes: storage.bytes ?? 0, files: storage.files },
      ai30d: ai,
      signupPolicy: policy,
    };
  }

  async listUsers(input: { query?: string; limit: number; offset: number }) {
    const q = input.query?.trim();
    const where = q ? or(ilike(user.email, `%${escapeLike(q)}%`), ilike(user.name, `%${escapeLike(q)}%`)) : undefined;
    const catalogs = this.db.select({ ownerId: catalog.ownerId, n: count().as("n") }).from(catalog).groupBy(catalog.ownerId).as("c");
    const seen = this.db.select({ userId: session.userId, at: max(session.updatedAt).as("at") }).from(session).groupBy(session.userId).as("s");
    const rows = await this.db
      .select({
        id: user.id, name: user.name, email: user.email, image: user.image, role: user.role,
        banned: user.banned, banReason: user.banReason, banExpires: user.banExpires, createdAt: user.createdAt,
        catalogs: sql<number>`coalesce(${catalogs.n}, 0)`.mapWith(Number),
        lastSeenAt: seen.at,
      })
      .from(user)
      .leftJoin(catalogs, eq(catalogs.ownerId, user.id))
      .leftJoin(seen, eq(seen.userId, user.id))
      .where(where)
      .orderBy(desc(user.createdAt))
      .limit(input.limit + 1)
      .offset(input.offset);
    const [total] = await this.db.select({ n: count() }).from(user).where(where);
    return {
      users: rows.slice(0, input.limit).map((r) => ({ ...r, banned: isBanned(r), isYou: r.id === this.adminId })),
      total: total?.n ?? 0,
      hasMore: rows.length > input.limit,
    };
  }

  async setRole(userId: string, role: "admin" | "user") {
    const u = await this.target(userId);
    if (u.role === role) return { ok: true };
    if (role === "user") await this.guardAdminChange(u, "remove admin from");
    if (role === "admin" && isBanned(u)) throw new TRPCError({ code: "BAD_REQUEST", message: "Lift the suspension before making this account an admin." });
    await this.db.update(user).set({ role }).where(eq(user.id, userId));
    await this.log("set-role", userId, { role });
    return { ok: true };
  }

  /** Suspends sign-in, API tokens and published sites; signs the user out everywhere. */
  async ban(userId: string, reason: string | undefined, days: number | undefined) {
    const u = await this.target(userId);
    if (u.id === this.adminId) throw new TRPCError({ code: "BAD_REQUEST", message: "You can't suspend your own account." });
    if (u.role === "admin") throw new TRPCError({ code: "BAD_REQUEST", message: "Remove admin from this account before suspending it." });
    await this.db.update(user).set({ banned: true, banReason: reason?.trim() || null, banExpires: days ? new Date(Date.now() + days * DAY) : null }).where(eq(user.id, userId));
    await this.db.delete(session).where(eq(session.userId, userId));
    await this.log("ban", userId, { reason, days });
    return { ok: true };
  }

  async unban(userId: string) {
    await this.target(userId);
    await this.db.update(user).set({ banned: false, banReason: null, banExpires: null }).where(eq(user.id, userId));
    await this.log("unban", userId);
    return { ok: true };
  }

  async revokeSessions(userId: string) {
    await this.target(userId);
    const r = await this.db.delete(session).where(eq(session.userId, userId)).returning({ id: session.id });
    const t = await this.db.update(apiToken).set({ revokedAt: new Date() }).where(and(eq(apiToken.userId, userId), isNull(apiToken.revokedAt))).returning({ id: apiToken.id });
    await this.log("revoke-sessions", userId, { sessions: r.length, tokens: t.length });
    return { sessions: r.length, tokens: t.length };
  }

  /** Deletes the account and everything it owns (catalogs, sites, tokens). Workspaces it created stay with their other members. */
  async deleteUser(userId: string) {
    const u = await this.target(userId);
    await this.guardAdminChange(u, "delete");
    await this.db.delete(user).where(eq(user.id, userId));
    await this.log("delete-user", userId, { email: u.email });
    return { ok: true };
  }

  async setSignupPolicy(policy: SignupPolicy) {
    await this.db
      .insert(appSetting)
      .values({ key: SIGNUP_POLICY_KEY, value: policy, updatedBy: this.adminId })
      .onConflictDoUpdate({ target: appSetting.key, set: { value: policy, updatedBy: this.adminId } });
    await this.log("signup-policy", null, { policy });
    return { signupPolicy: policy };
  }

  async listSites(input: { query?: string; limit: number; offset: number }) {
    const q = input.query?.trim();
    const where = q ? or(ilike(publication.slug, `%${escapeLike(q)}%`), ilike(user.email, `%${escapeLike(q)}%`), sql`${publication.document}->'metadata'->>'title' ilike ${`%${escapeLike(q)}%`}`) : undefined;
    const rows = await this.db
      .select({
        id: publication.id, slug: publication.slug, visibility: publication.visibility, views: publication.views,
        version: publication.version, updatedAt: publication.updatedAt,
        title: sql<string>`${publication.document}->'metadata'->>'title'`,
        ownerEmail: user.email,
      })
      .from(publication)
      .innerJoin(user, eq(user.id, publication.ownerId))
      .where(where)
      .orderBy(desc(publication.updatedAt))
      .limit(input.limit + 1)
      .offset(input.offset);
    return { sites: rows.slice(0, input.limit), hasMore: rows.length > input.limit };
  }

  /** Takes a site offline. The catalog itself is untouched; its owner can publish again. */
  async unpublish(publicationId: string) {
    const [p] = await this.db.delete(publication).where(eq(publication.id, publicationId)).returning({ slug: publication.slug, ownerId: publication.ownerId });
    if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Site not found" });
    await this.log("unpublish", publicationId, p);
    return { ok: true };
  }

  async activity(input: { limit: number; before?: Date; action?: string }) {
    const rows = await this.db
      .select({
        id: auditLog.id, action: auditLog.action, target: auditLog.target, outcome: auditLog.outcome,
        details: auditLog.details, createdAt: auditLog.createdAt, userEmail: user.email,
      })
      .from(auditLog)
      .leftJoin(user, eq(user.id, auditLog.userId))
      .where(and(input.before ? lt(auditLog.createdAt, input.before) : undefined, input.action ? ilike(auditLog.action, `${escapeLike(input.action)}%`) : undefined))
      .orderBy(desc(auditLog.createdAt))
      .limit(input.limit);
    return rows;
  }
}
