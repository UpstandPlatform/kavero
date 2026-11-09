import { defineRelationsPart } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { catalog } from "./catalog";

/**
 * A published website for a cloud catalog. It holds a frozen snapshot of the
 * document, so editing the catalog never changes the live site until the owner
 * publishes again (draft vs published).
 */
export const publication = pgTable(
  "publication",
  {
    id: text("id").primaryKey(),
    catalogId: text("catalog_id").notNull().references(() => catalog.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    /** public: listed and indexable; unlisted: link only; password: link + password; private: owner only. */
    visibility: text("visibility", { enum: ["public", "unlisted", "password", "private"] }).notNull().default("unlisted"),
    passwordHash: text("password_hash"),
    /** Bumped on every publish. */
    version: integer("version").notNull().default(1),
    /** Cloud catalog revision this snapshot was taken from. */
    sourceRevision: integer("source_revision").notNull(),
    document: jsonb("document").notNull(),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    /** Storage key of the rendered social preview image, if one was made. */
    ogImageKey: text("og_image_key"),
    views: integer("views").notNull().default(0),
    publishedAt: timestamp("published_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    uniqueIndex("publication_slug_idx").on(t.slug),
    uniqueIndex("publication_catalog_idx").on(t.catalogId),
    index("publication_owner_idx").on(t.ownerId),
  ],
);

/** Files a publication needs, pinned at publish time so later catalog edits can't remove them. */
export const publicationAsset = pgTable(
  "publication_asset",
  {
    id: text("id").primaryKey(),
    publicationId: text("publication_id").notNull().references(() => publication.id, { onDelete: "cascade" }),
    assetId: text("asset_id").notNull(),
    mimeType: text("mime_type").notNull(),
    storageKey: text("storage_key").notNull(),
  },
  (t) => [uniqueIndex("publication_asset_pub_asset_idx").on(t.publicationId, t.assetId)],
);

export const publicationRelations = defineRelationsPart({ catalog, publication, publicationAsset }, (r) => ({
  publication: {
    catalog: r.one.catalog({ from: r.publication.catalogId, to: r.catalog.id }),
    assets: r.many.publicationAsset({ from: r.publication.id, to: r.publicationAsset.publicationId }),
  },
  publicationAsset: { publication: r.one.publication({ from: r.publicationAsset.publicationId, to: r.publication.id }) },
}));
