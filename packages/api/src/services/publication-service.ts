import { randomUUID, scrypt as scryptCb, timingSafeEqual, randomBytes } from "node:crypto";
import { promisify } from "node:util";

import { parseCatalogDocument, type CatalogDocument } from "@Kavero/catalog-engine";
import type { Database } from "@Kavero/db";
import { catalog, catalogAsset } from "@Kavero/db/schema/catalog";
import { publication, publicationAsset } from "@Kavero/db/schema/publication";
import { TRPCError } from "@trpc/server";
import { and, eq, ne, sql } from "drizzle-orm";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export type Visibility = "public" | "unlisted" | "password" | "private";

const RESERVED = new Set(["admin", "api", "app", "assets", "auth", "c", "dashboard", "editor", "help", "kavero", "login", "new", "render", "settings", "static", "www"]);

export function validateSlug(slug: string): string | null {
  if (!/^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/.test(slug)) return "Use 3–60 lowercase letters, numbers and dashes, starting and ending with a letter or number.";
  if (slug.includes("--")) return "Avoid double dashes.";
  if (RESERVED.has(slug)) return "That address is reserved.";
  return null;
}

export function slugify(title: string) {
  const s = title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
  return s.length >= 3 ? s : `catalog-${s || randomBytes(3).toString("hex")}`;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [alg, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

export interface PublishInput {
  catalogId: string;
  slug: string;
  visibility: Visibility;
  /** Required the first time visibility is "password"; omit to keep the existing one. */
  password?: string;
  seoTitle?: string;
  seoDescription?: string;
}

/**
 * Publishing for the web. Owner methods take the acting user id and enforce
 * ownership; public methods only ever return what a visitor may see.
 */
export class PublicationService {
  constructor(private readonly db: Database) {}

  private async ownedCatalog(userId: string, catalogId: string) {
    const [row] = await this.db
      .select({ id: catalog.id, revision: catalog.revision, document: catalog.document, title: catalog.title })
      .from(catalog)
      .where(and(eq(catalog.ownerId, userId), eq(catalog.id, catalogId)))
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Save this catalog to the cloud before publishing" });
    return row;
  }

  /** Publication settings for the editor's Publish dialog (no document). */
  async status(userId: string, catalogId: string) {
    const cat = await this.ownedCatalog(userId, catalogId);
    const [pub] = await this.db
      .select({
        slug: publication.slug, visibility: publication.visibility, version: publication.version,
        sourceRevision: publication.sourceRevision, seoTitle: publication.seoTitle, seoDescription: publication.seoDescription,
        hasPassword: sql<boolean>`${publication.passwordHash} is not null`, views: publication.views, publishedAt: publication.publishedAt,
      })
      .from(publication)
      .where(eq(publication.catalogId, catalogId))
      .limit(1);
    return { catalogRevision: cat.revision, suggestedSlug: slugify(cat.title), publication: pub ?? null };
  }

  async isSlugAvailable(userId: string, catalogId: string, slug: string) {
    const problem = validateSlug(slug);
    if (problem) return { available: false, reason: problem };
    const [taken] = await this.db.select({ catalogId: publication.catalogId, ownerId: publication.ownerId }).from(publication).where(eq(publication.slug, slug)).limit(1);
    if (taken && !(taken.catalogId === catalogId && taken.ownerId === userId)) return { available: false, reason: "That address is taken." };
    return { available: true, reason: null };
  }

  /** Snapshot the current cloud catalog and make it live (creating or replacing the publication). */
  async publish(userId: string, input: PublishInput) {
    const cat = await this.ownedCatalog(userId, input.catalogId);
    const slugCheck = await this.isSlugAvailable(userId, input.catalogId, input.slug);
    if (!slugCheck.available) throw new TRPCError({ code: "BAD_REQUEST", message: slugCheck.reason ?? "Invalid address" });

    const parsed = parseCatalogDocument(cat.document);
    if (!parsed.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Stored catalog is invalid" });
    const doc: CatalogDocument = parsed.document;

    const files = await this.db.select().from(catalogAsset).where(eq(catalogAsset.catalogId, cat.id));
    const byId = new Map(files.map((f) => [f.assetId, f]));
    const missing = doc.assets.filter((a) => !byId.has(a.id)).map((a) => a.name);

    const [existing] = await this.db.select({ id: publication.id, version: publication.version, passwordHash: publication.passwordHash }).from(publication).where(eq(publication.catalogId, cat.id)).limit(1);

    let passwordHash: string | null = null;
    if (input.visibility === "password") {
      if (input.password) {
        if (input.password.length < 4) throw new TRPCError({ code: "BAD_REQUEST", message: "Use a password of at least 4 characters" });
        passwordHash = await hashPassword(input.password);
      } else if (existing?.passwordHash) passwordHash = existing.passwordHash;
      else throw new TRPCError({ code: "BAD_REQUEST", message: "Set a password for this catalog" });
    }

    const values = {
      slug: input.slug, visibility: input.visibility, passwordHash, sourceRevision: cat.revision, document: doc,
      seoTitle: input.seoTitle?.trim().slice(0, 120) || null, seoDescription: input.seoDescription?.trim().slice(0, 300) || null,
      ogImageKey: null, publishedAt: new Date(),
    };

    const id = await this.db.transaction(async (tx) => {
      let pubId: string;
      if (existing) {
        pubId = existing.id;
        await tx.update(publication).set({ ...values, version: existing.version + 1 }).where(eq(publication.id, existing.id));
        await tx.delete(publicationAsset).where(eq(publicationAsset.publicationId, pubId));
      } else {
        pubId = randomUUID();
        await tx.insert(publication).values({ id: pubId, catalogId: cat.id, ownerId: userId, version: 1, ...values });
      }
      const pinned = doc.assets.map((a) => byId.get(a.id)).filter((f) => !!f);
      if (pinned.length) {
        await tx.insert(publicationAsset).values(pinned.map((f) => ({ id: randomUUID(), publicationId: pubId, assetId: f.assetId, mimeType: f.mimeType, storageKey: f.storageKey })));
      }
      return pubId;
    });

    return { id, slug: input.slug, version: (existing?.version ?? 0) + 1, missingFiles: missing };
  }

  async unpublish(userId: string, catalogId: string) {
    await this.ownedCatalog(userId, catalogId);
    await this.db.delete(publication).where(eq(publication.catalogId, catalogId));
    return { ok: true };
  }

  // ---------- Public side ----------

  /** Everything the public page needs; the caller decides access from `visibility`. */
  async findBySlug(slug: string) {
    const [pub] = await this.db.select().from(publication).where(eq(publication.slug, slug)).limit(1);
    return pub ?? null;
  }

  async publicAsset(publicationId: string, assetId: string) {
    const [a] = await this.db.select().from(publicationAsset).where(and(eq(publicationAsset.publicationId, publicationId), eq(publicationAsset.assetId, assetId))).limit(1);
    return a ?? null;
  }

  async countView(publicationId: string) {
    await this.db.update(publication).set({ views: sql`${publication.views} + 1` }).where(eq(publication.id, publicationId));
  }

  async setOgImage(publicationId: string, version: number, key: string) {
    await this.db.update(publication).set({ ogImageKey: key }).where(and(eq(publication.id, publicationId), eq(publication.version, version)));
  }

  /** Public catalogs for a sitemap. */
  async listPublic() {
    return this.db.select({ slug: publication.slug, updatedAt: publication.updatedAt }).from(publication).where(and(eq(publication.visibility, "public"), ne(publication.slug, "")));
  }
}
