import type { Database } from "@Kavero/db";
import { catalog, catalogAsset } from "@Kavero/db/schema/catalog";
import { publication } from "@Kavero/db/schema/publication";
import { createResilientRateLimiter, type ResilientRateLimiter } from "@Kavero/redis";
import { TRPCError } from "@trpc/server";
import { and, count, eq, sum } from "drizzle-orm";

import { unlimitedEntitlements, type Entitlements, type EntitlementProvider, type Platform } from "./edition";

/** Quota checks for a request context (unlimited when the host provides no platform). */
export function quotaFor(ctx: { db: Database; platform?: Platform }) {
  return new QuotaService(ctx.db, ctx.platform?.entitlements ?? unlimitedEntitlements);
}

/**
 * Enforces a user's entitlements (plan limits). Outside the cloud edition every
 * limit is null (unlimited), so these checks cost one in-memory call and no queries.
 */
export class QuotaService {
  constructor(private readonly db: Database, private readonly entitlements: EntitlementProvider) {}

  private limits(userId: string): Promise<Entitlements> {
    return this.entitlements.forUser(userId);
  }

  /** Before saving a catalog to the cloud: a new one must fit within maxCatalogs. */
  async assertCanSaveCatalog(userId: string, documentId: string) {
    const { maxCatalogs, plan } = await this.limits(userId);
    if (maxCatalogs === null) return;
    const [exists] = await this.db.select({ id: catalog.id }).from(catalog).where(and(eq(catalog.ownerId, userId), eq(catalog.documentId, documentId))).limit(1);
    if (exists) return;
    const [row] = await this.db.select({ n: count() }).from(catalog).where(eq(catalog.ownerId, userId));
    if ((row?.n ?? 0) >= maxCatalogs) throw limitError(`Your ${plan} plan includes ${maxCatalogs} cloud catalog${maxCatalogs === 1 ? "" : "s"}. Delete one or keep this catalog in your browser.`);
  }

  /** Before publishing: a catalog that isn't published yet must fit within maxPublishedSites. */
  async assertCanPublish(userId: string, catalogRowId: string) {
    const { maxPublishedSites, plan } = await this.limits(userId);
    if (maxPublishedSites === null) return;
    const [exists] = await this.db.select({ id: publication.id }).from(publication).where(eq(publication.catalogId, catalogRowId)).limit(1);
    if (exists) return;
    const [row] = await this.db.select({ n: count() }).from(publication).where(eq(publication.ownerId, userId));
    if ((row?.n ?? 0) >= maxPublishedSites) throw limitError(`Your ${plan} plan includes ${maxPublishedSites} published site${maxPublishedSites === 1 ? "" : "s"}. Unpublish one first.`);
  }

  /** Before storing `addBytes` more media for this user. */
  async assertStorage(userId: string, addBytes: number) {
    const { maxStorageMb, plan } = await this.limits(userId);
    if (maxStorageMb === null) return;
    const [row] = await this.db
      .select({ total: sum(catalogAsset.bytes) })
      .from(catalogAsset)
      .innerJoin(catalog, eq(catalog.id, catalogAsset.catalogId))
      .where(eq(catalog.ownerId, userId));
    const used = Number(row?.total ?? 0);
    if (used + addBytes > maxStorageMb * 1024 * 1024) throw limitError(`Your ${plan} plan includes ${maxStorageMb} MB of media storage, and it's full.`);
  }

  /** Counts one AI request against aiRequestsPerDay. */
  async consumeAiRequest(userId: string) {
    const { aiRequestsPerDay, plan } = await this.limits(userId);
    if (aiRequestsPerDay === null) return;
    if (aiRequestsPerDay === 0) throw limitError(`AI isn't included in your ${plan} plan.`);
    const decision = await dailyLimiter(aiRequestsPerDay).limit(userId);
    if (!decision.allowed) throw limitError(`You've used today's ${aiRequestsPerDay} AI requests on your ${plan} plan. Try again tomorrow.`);
  }
}

const limiters = new Map<number, ResilientRateLimiter>();
function dailyLimiter(max: number) {
  let l = limiters.get(max);
  if (!l) {
    l = createResilientRateLimiter({ namespace: `ai-daily-${max}`, maxRequests: max, windowMs: 24 * 60 * 60 * 1000 });
    limiters.set(max, l);
  }
  return l;
}

function limitError(message: string) {
  return new TRPCError({ code: "FORBIDDEN", message, cause: "plan-limit" });
}
