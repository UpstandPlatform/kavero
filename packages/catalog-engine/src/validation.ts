import { CURRENT_SCHEMA_VERSION, catalogDocumentSchema, type CatalogDocument } from "./schema";
import { PRODUCTS_EXTENSION_ID } from "./products";

export type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

/** migrations[n] upgrades a document from version n to n + 1. */
export const migrations: Record<number, Migration> = {
  // 1: (doc) => ({ ...doc, schemaVersion: 2, ... }),
};

export function migrateDocument(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  let doc = raw as Record<string, unknown>;
  let version = typeof doc.schemaVersion === "number" ? doc.schemaVersion : 1;
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(`Document schema v${version} is newer than this app (v${CURRENT_SCHEMA_VERSION}). Please update Kavero.`);
  }
  while (version < CURRENT_SCHEMA_VERSION) {
    const step = migrations[version];
    if (!step) throw new Error(`No migration from schema v${version}`);
    doc = step(doc);
    version += 1;
  }
  return { ...doc, schemaVersion: CURRENT_SCHEMA_VERSION };
}

export interface ValidationIssue {
  path: string;
  message: string;
  severity: "error" | "warning";
}

export type ParseResult =
  | { ok: true; document: CatalogDocument; warnings: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[] };

/** Migrate, schema-validate, then check cross-references. Use for any untrusted input (files, AI, MCP). */
export function parseCatalogDocument(raw: unknown): ParseResult {
  let migrated: unknown;
  try {
    migrated = migrateDocument(raw);
  } catch (e) {
    return { ok: false, issues: [{ path: "schemaVersion", message: (e as Error).message, severity: "error" }] };
  }
  const result = catalogDocumentSchema.safeParse(migrated);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message, severity: "error" as const })),
    };
  }
  const issues = checkIntegrity(result.data);
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length) return { ok: false, issues };
  return { ok: true, document: result.data, warnings: issues };
}

export function checkIntegrity(doc: CatalogDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  const dup = (id: string, path: string) => {
    if (seen.has(id)) issues.push({ path, message: `Duplicate id "${id}"`, severity: "error" });
    seen.add(id);
  };
  const assetIds = new Set(doc.assets.map((a) => a.id));
  const productIds = new Set(doc.products.map((p) => p.id));
  const missingAsset = (id: string | undefined, path: string) => {
    if (id && !assetIds.has(id)) issues.push({ path, message: `Missing asset "${id}"`, severity: "warning" });
  };
  const missingProduct = (id: string, path: string) => {
    if (!productIds.has(id)) issues.push({ path, message: `Missing product "${id}"`, severity: "warning" });
  };

  const productSeen = new Set<string>();
  doc.products.forEach((p, pi) => {
    const pp = `products.${pi}`;
    if (productSeen.has(p.id)) issues.push({ path: `${pp}.id`, message: `Duplicate product id "${p.id}"`, severity: "warning" });
    productSeen.add(p.id);
    p.imageAssetIds.forEach((a, ai) => missingAsset(a, `${pp}.imageAssetIds.${ai}`));
    if (p.price !== undefined && p.compareAtPrice !== undefined && p.compareAtPrice < p.price) {
      issues.push({ path: `${pp}.compareAtPrice`, message: `"${p.name}": the compare-at price is lower than the price, so no discount is shown`, severity: "warning" });
    }
  });

  doc.slides.forEach((slide, si) => {
    const sp = `slides.${si}`;
    dup(slide.id, `${sp}.id`);
    if (slide.background.kind === "image") missingAsset(slide.background.assetId, `${sp}.background`);
    slide.elements.forEach((el, ei) => {
      const ep = `${sp}.elements.${ei}`;
      dup(el.id, `${ep}.id`);
      el.animations.forEach((a, ai) => dup(a.id, `${ep}.animations.${ai}.id`));
      el.effects.forEach((effect, effectIndex) => dup(effect.id, `${ep}.effects.${effectIndex}.id`));
      switch (el.type) {
        case "image": missingAsset(el.content.assetId, `${ep}.content.assetId`); break;
        case "video": missingAsset(el.content.assetId, `${ep}.content.assetId`); break;
        case "product": missingProduct(el.content.productId, `${ep}.content.productId`); break;
        case "product-grid": el.content.products.forEach((p, pi) => missingProduct(p.productId, `${ep}.content.products.${pi}`)); break;
        case "extension": {
          if (el.extensionId !== PRODUCTS_EXTENSION_ID) break;
          if (typeof el.content.productId === "string") missingProduct(el.content.productId, `${ep}.content.productId`);
          const products = el.content.products;
          if (Array.isArray(products)) products.forEach((product, pi) => {
            if (typeof product === "object" && product !== null && "productId" in product && typeof product.productId === "string") {
              missingProduct(product.productId, `${ep}.content.products.${pi}`);
            }
          });
          break;
        }
      }
    });
  });
  return issues;
}

export type ExportTarget = "pdf" | "pptx" | "web";

/** Features that will be dropped or simplified for a given output. */
export function checkExportCompatibility(doc: CatalogDocument, target: ExportTarget): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const warn = (path: string, message: string) => issues.push({ path, message, severity: "warning" });
  doc.slides.forEach((slide, si) => {
    if (target === "pdf" && slide.transition && slide.transition.type !== "none") {
      warn(`slides.${si}.transition`, "PDF is static; transitions are not exported.");
    }
    if (target === "pptx" && slide.transition && ["morph", "flip"].includes(slide.transition.type)) {
      warn(`slides.${si}.transition`, `"${slide.transition.type}" is approximated with a fade in PowerPoint.`);
    }
    slide.elements.forEach((el, ei) => {
      const p = `slides.${si}.elements.${ei}`;
      if (target === "pdf" && el.animations.length) warn(p, "PDF is static; animations are not exported.");
      if (target === "pdf" && el.type === "video") warn(p, "Videos render as their poster image in PDF.");
      if (target === "pptx" && el.animations.some((a) => a.category === "motion-path" || a.preset === "blur")) {
        warn(p, "Motion paths and blur animations are simplified in PowerPoint.");
      }
      if (target === "pptx" && el.animations.some((a) => a.category === "keyframes" || a.preset === "draw" || a.preset === "erase" || a.preset === "trace")) {
        warn(p, "Keyframe and path draw/erase/trace animations play on the web, in presentations and in video, but not in PowerPoint.");
      }
      if (target === "pptx" && el.effects.length) warn(p, "Shader fills and effects are not exported to PowerPoint yet.");
    });
  });
  return issues;
}
