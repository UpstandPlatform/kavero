import {
  CURRENT_SCHEMA_VERSION,
  catalogDocumentSchema,
  type CatalogDocument,
  type CatalogSlide,
} from "./schema";

export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export const PAGE_PRESETS = {
  "a4-portrait": { width: 794, height: 1123 },
  "a4-landscape": { width: 1123, height: 794 },
  "letter-portrait": { width: 816, height: 1056 },
  "16:9": { width: 1920, height: 1080 },
  "4:3": { width: 1440, height: 1080 },
  square: { width: 1080, height: 1080 },
} as const;

export type PagePreset = keyof typeof PAGE_PRESETS;

export const DEFAULT_THEME: CatalogDocument["theme"] = {
  colors: {
    background: "#ffffff",
    text: "#111111",
    muted: "#6b7280",
    primary: "#111827",
    "on-primary": "#ffffff",
    accent: "#c084fc",
  },
  fonts: { heading: "Inter", body: "Inter" },
};

export function createBlankSlide(name = "Untitled slide"): CatalogSlide {
  return {
    id: createId("sld"),
    name,
    background: { kind: "color", color: "token:background" },
    elements: [],
  };
}

export interface CreateCatalogInput {
  title: string;
  description?: string;
  language?: string;
  currency?: string;
  page?: PagePreset | { width: number; height: number };
}

export function createCatalog(input: CreateCatalogInput): CatalogDocument {
  const page = typeof input.page === "object" ? input.page : PAGE_PRESETS[input.page ?? "16:9"];
  return catalogDocumentSchema.parse({
    id: createId("cat"),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    revision: 0,
    metadata: {
      title: input.title,
      description: input.description,
      language: input.language ?? "en",
      currency: input.currency ?? "USD",
    },
    settings: { ...page },
    theme: structuredClone(DEFAULT_THEME),
    slides: [createBlankSlide("Cover")],
  });
}

export function orientationOf(doc: CatalogDocument): "portrait" | "landscape" {
  return doc.settings.height > doc.settings.width ? "portrait" : "landscape";
}

/** Resolve "token:name" colors/fonts against the theme. */
export function resolveToken(doc: CatalogDocument, value: string, kind: "colors" | "fonts" = "colors"): string {
  if (!value.startsWith("token:")) return value;
  return doc.theme[kind][value.slice(6)] ?? value;
}

/** Rewrite every asset reference in a document (in place). */
export function remapAssetIds(doc: CatalogDocument, remap: Map<string, string>) {
  const m = (id: string | undefined) => (id ? (remap.get(id) ?? id) : id);
  for (const a of doc.assets) a.id = m(a.id)!;
  for (const p of doc.products) p.imageAssetIds = p.imageAssetIds.map((id) => m(id)!);
  for (const s of doc.slides) {
    if (s.background.kind === "image") s.background.assetId = m(s.background.assetId)!;
    for (const el of s.elements) {
      if (el.type === "image") el.content.assetId = m(el.content.assetId)!;
      if (el.type === "video") {
        el.content.assetId = m(el.content.assetId);
        el.content.posterAssetId = m(el.content.posterAssetId);
      }
    }
  }
}

/**
 * Deep copy with fresh ids for the catalog, slides, elements and assets.
 * `assetIdMap` maps old asset ids to new ones so stored binaries can be copied.
 */
export function duplicateCatalog(doc: CatalogDocument, title?: string): CatalogDocument {
  return duplicateCatalogWithAssets(doc, title).document;
}

export function duplicateCatalogWithAssets(doc: CatalogDocument, title?: string): { document: CatalogDocument; assetIdMap: Map<string, string> } {
  const copy = structuredClone(doc);
  copy.id = createId("cat");
  copy.revision = 0;
  copy.metadata.title = title ?? `${doc.metadata.title} (copy)`;
  const assetIdMap = new Map(copy.assets.map((a) => [a.id, createId("ast")] as const));
  remapAssetIds(copy, assetIdMap);
  for (const slide of copy.slides) {
    slide.id = createId("sld");
    const groupIds = new Map<string, string>();
    for (const el of slide.elements) {
      el.id = createId("el");
      for (const a of el.animations) a.id = createId("anim");
      if (el.groupId) {
        if (!groupIds.has(el.groupId)) groupIds.set(el.groupId, createId("grp"));
        el.groupId = groupIds.get(el.groupId);
      }
    }
  }
  return { document: copy, assetIdMap };
}
