import { defineRelationsPart } from "drizzle-orm";
import { bigint, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { workspace } from "./workspace";

/**
 * A cloud copy of a catalog. `documentId` is the id inside the catalog JSON
 * (shared with the local IndexedDB copy); `id` is the server row id, so two
 * users importing the same .kavero file never collide.
 */
export const catalog = pgTable(
  "catalog",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    /** Shared workspace, or null for a personal catalog. */
    workspaceId: text("workspace_id").references(() => workspace.id, { onDelete: "set null" }),
    documentId: text("document_id").notNull(),
    title: text("title").notNull(),
    slideCount: integer("slide_count").notNull().default(0),
    thumbnail: text("thumbnail"),
    /** Server revision, bumped on every accepted save. Used for conflict detection. */
    revision: integer("revision").notNull().default(1),
    schemaVersion: integer("schema_version").notNull(),
    document: jsonb("document").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    uniqueIndex("catalog_owner_document_idx").on(t.ownerId, t.documentId),
    index("catalog_owner_updated_idx").on(t.ownerId, t.updatedAt),
    index("catalog_workspace_idx").on(t.workspaceId),
  ],
);

/** Earlier versions of a catalog, kept on every save (pruned to the latest N). */
export const catalogRevision = pgTable(
  "catalog_revision",
  {
    id: text("id").primaryKey(),
    catalogId: text("catalog_id").notNull().references(() => catalog.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    document: jsonb("document").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("catalog_revision_catalog_rev_idx").on(t.catalogId, t.revision)],
);

/** Binary files (images, fonts) referenced by a cloud catalog; bytes live in object storage. */
export const catalogAsset = pgTable(
  "catalog_asset",
  {
    id: text("id").primaryKey(),
    catalogId: text("catalog_id").notNull().references(() => catalog.id, { onDelete: "cascade" }),
    /** CatalogAsset.id inside the document. */
    assetId: text("asset_id").notNull(),
    mimeType: text("mime_type").notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    hash: text("hash").notNull(),
    storageKey: text("storage_key").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("catalog_asset_catalog_asset_idx").on(t.catalogId, t.assetId)],
);

export const catalogRelations = defineRelationsPart({ user, catalog, catalogRevision, catalogAsset }, (r) => ({
  catalog: {
    owner: r.one.user({ from: r.catalog.ownerId, to: r.user.id }),
    revisions: r.many.catalogRevision({ from: r.catalog.id, to: r.catalogRevision.catalogId }),
    assets: r.many.catalogAsset({ from: r.catalog.id, to: r.catalogAsset.catalogId }),
  },
  catalogRevision: { catalog: r.one.catalog({ from: r.catalogRevision.catalogId, to: r.catalog.id }) },
  catalogAsset: { catalog: r.one.catalog({ from: r.catalogAsset.catalogId, to: r.catalog.id }) },
}));
