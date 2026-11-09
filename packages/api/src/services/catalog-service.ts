import { randomUUID } from "node:crypto";

import { checkIntegrity, parseCatalogDocument, type CatalogDocument } from "@Kavero/catalog-engine";
import { applyCommand, type EditorCommand } from "@Kavero/editor-core";
import type { Database } from "@Kavero/db";
import { catalog, catalogAsset, catalogRevision } from "@Kavero/db/schema/catalog";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, lt, notInArray } from "drizzle-orm";

/** How many earlier versions to keep per catalog. */
const KEEP_REVISIONS = 20;
/** Upper bound for stored document JSON (assets are stored separately). */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

export interface CloudCatalogSummary {
  id: string;
  documentId: string;
  title: string;
  slideCount: number;
  thumbnail: string | null;
  revision: number;
  updatedAt: Date;
  createdAt: Date;
}

const summaryColumns = {
  id: catalog.id,
  documentId: catalog.documentId,
  title: catalog.title,
  slideCount: catalog.slideCount,
  thumbnail: catalog.thumbnail,
  revision: catalog.revision,
  updatedAt: catalog.updatedAt,
  createdAt: catalog.createdAt,
};

/**
 * Server-side catalog operations. Every method takes the acting user id and
 * enforces ownership itself, so tRPC, MCP tools and route handlers can share it.
 */
export class CatalogService {
  constructor(private readonly db: Database) {}

  async list(userId: string): Promise<CloudCatalogSummary[]> {
    return this.db.select(summaryColumns).from(catalog).where(eq(catalog.ownerId, userId)).orderBy(desc(catalog.updatedAt));
  }

  /** Row id or the document id of one of the user's catalogs. */
  private async findOwned(userId: string, idOrDocumentId: string) {
    const [row] = await this.db
      .select()
      .from(catalog)
      .where(and(eq(catalog.ownerId, userId), idOrDocumentId.startsWith("cat_") ? eq(catalog.documentId, idOrDocumentId) : eq(catalog.id, idOrDocumentId)))
      .limit(1);
    return row ?? null;
  }

  async get(userId: string, id: string) {
    const row = await this.findOwned(userId, id);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Catalog not found" });
    const parsed = parseCatalogDocument(row.document);
    if (!parsed.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Stored catalog is invalid" });
    const assets = await this.db.select({ assetId: catalogAsset.assetId, hash: catalogAsset.hash }).from(catalogAsset).where(eq(catalogAsset.catalogId, row.id));
    return { id: row.id, revision: row.revision, document: parsed.document, uploadedAssets: assets };
  }

  /**
   * Create or update a cloud catalog.
   * `baseRevision` is the server revision the client last saw; if the server has
   * moved on since, the save is rejected with CONFLICT instead of overwriting.
   * Omit it only to create a new cloud copy.
   */
  async save(userId: string, input: { document: unknown; baseRevision?: number; thumbnail?: string }) {
    const parsed = parseCatalogDocument(input.document);
    if (!parsed.ok) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid catalog: ${parsed.issues.slice(0, 3).map((i) => `${i.path} ${i.message}`).join("; ")}` });
    }
    const doc: CatalogDocument = parsed.document;
    if (JSON.stringify(doc).length > MAX_DOCUMENT_BYTES) {
      throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Catalog is too large to save to the cloud" });
    }
    const thumbnail = input.thumbnail && input.thumbnail.length < 200_000 && input.thumbnail.startsWith("data:image/") ? input.thumbnail : null;

    const result = await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: catalog.id, revision: catalog.revision, document: catalog.document })
        .from(catalog)
        .where(and(eq(catalog.ownerId, userId), eq(catalog.documentId, doc.id)))
        .for("update")
        .limit(1);

      if (!existing) {
        if (input.baseRevision !== undefined) {
          throw new TRPCError({ code: "NOT_FOUND", message: "This catalog was deleted from the cloud" });
        }
        const id = randomUUID();
        await tx.insert(catalog).values({
          id, ownerId: userId, documentId: doc.id, title: doc.metadata.title, slideCount: doc.slides.length,
          thumbnail, revision: 1, schemaVersion: doc.schemaVersion, document: doc,
        });
        return { id, revision: 1, created: true };
      }

      if (input.baseRevision === undefined || input.baseRevision !== existing.revision) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `The cloud copy changed (cloud revision ${existing.revision}, yours ${input.baseRevision ?? "none"})`,
          cause: { serverRevision: existing.revision },
        });
      }

      const revision = existing.revision + 1;
      await tx.insert(catalogRevision).values({ id: randomUUID(), catalogId: existing.id, revision: existing.revision, document: existing.document });
      await tx.update(catalog).set({
        title: doc.metadata.title, slideCount: doc.slides.length, thumbnail, revision,
        schemaVersion: doc.schemaVersion, document: doc,
      }).where(eq(catalog.id, existing.id));
      await tx.delete(catalogRevision).where(and(eq(catalogRevision.catalogId, existing.id), lt(catalogRevision.revision, revision - KEEP_REVISIONS)));
      // Forget uploaded files the document no longer references.
      const ids = doc.assets.map((a) => a.id);
      await tx.delete(catalogAsset).where(ids.length ? and(eq(catalogAsset.catalogId, existing.id), notInArray(catalogAsset.assetId, ids)) : eq(catalogAsset.catalogId, existing.id));
      return { id: existing.id, revision, created: false };
    });
    return { ...result, missingAssetIds: await this.missingAssets(result.id, doc) };
  }

  /** Document assets whose bytes the server doesn't have yet (or has a different version of). */
  private async missingAssets(catalogId: string, doc: CatalogDocument): Promise<string[]> {
    const stored = await this.db.select({ assetId: catalogAsset.assetId, hash: catalogAsset.hash }).from(catalogAsset).where(eq(catalogAsset.catalogId, catalogId));
    const have = new Map(stored.map((a) => [a.assetId, a.hash]));
    return doc.assets.filter((a) => !have.has(a.id) || (a.hash && have.get(a.id) !== a.hash)).map((a) => a.id);
  }

  /** Create a new cloud catalog from a full document (fresh document id is the caller's job). */
  async create(userId: string, doc: CatalogDocument) {
    return this.save(userId, { document: doc });
  }

  /**
   * Apply editor commands on the server (MCP, AI). Uses the same command
   * implementation and validation as the visual editor, then saves with the
   * usual revision check. Retries if another save landed in between.
   */
  async applyCommands(userId: string, id: string, commands: EditorCommand[]) {
    for (let attempt = 0; ; attempt++) {
      const { id: rowId, revision, document } = await this.get(userId, id);
      const draft = structuredClone(document);
      let createdIds: string[];
      try {
        createdIds = applyCommand(draft, commands.length === 1 ? commands[0]! : { type: "batch", commands }).createdIds;
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: (e as Error).message });
      }
      const errors = checkIntegrity(draft).filter((i) => i.severity === "error");
      if (errors.length) throw new TRPCError({ code: "BAD_REQUEST", message: errors.map((e) => `${e.path}: ${e.message}`).join("; ") });
      draft.revision = document.revision + 1;
      try {
        const res = await this.save(userId, { document: draft, baseRevision: revision });
        return { id: rowId, revision: res.revision, createdIds, document: draft };
      } catch (e) {
        if (e instanceof TRPCError && e.code === "CONFLICT" && attempt < 2) continue;
        throw e;
      }
    }
  }

  async delete(userId: string, id: string) {
    const row = await this.findOwned(userId, id);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Catalog not found" });
    const keys = await this.db.select({ storageKey: catalogAsset.storageKey }).from(catalogAsset).where(eq(catalogAsset.catalogId, row.id));
    await this.db.delete(catalog).where(eq(catalog.id, row.id));
    return { storageKeys: keys.map((k) => k.storageKey) };
  }

  async revisions(userId: string, id: string) {
    const row = await this.findOwned(userId, id);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Catalog not found" });
    return this.db
      .select({ revision: catalogRevision.revision, createdAt: catalogRevision.createdAt })
      .from(catalogRevision)
      .where(eq(catalogRevision.catalogId, row.id))
      .orderBy(desc(catalogRevision.revision));
  }

  /** Ownership check for asset routes; returns the catalog row and whether the asset is referenced. */
  async assetTarget(userId: string, id: string, assetId: string) {
    const row = await this.findOwned(userId, id);
    if (!row) return null;
    const doc = row.document as CatalogDocument;
    const meta = doc.assets?.find((a) => a.id === assetId);
    return { catalogId: row.id, asset: meta ?? null };
  }

  async recordAsset(input: { catalogId: string; assetId: string; mimeType: string; bytes: number; hash: string; storageKey: string }) {
    await this.db
      .insert(catalogAsset)
      .values({ id: randomUUID(), ...input })
      .onConflictDoUpdate({ target: [catalogAsset.catalogId, catalogAsset.assetId], set: { mimeType: input.mimeType, bytes: input.bytes, hash: input.hash, storageKey: input.storageKey } });
  }

  async findAsset(userId: string, id: string, assetId: string) {
    const row = await this.findOwned(userId, id);
    if (!row) return null;
    const [asset] = await this.db.select().from(catalogAsset).where(and(eq(catalogAsset.catalogId, row.id), eq(catalogAsset.assetId, assetId))).limit(1);
    return asset ?? null;
  }
}
