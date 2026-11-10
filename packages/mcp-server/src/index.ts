import { AiService } from "@Kavero/api/services/ai-service";
import { CatalogService } from "@Kavero/api/services/catalog-service";
import { PublicationService, slugify } from "@Kavero/api/services/publication-service";
import { audit, type Scope, type TokenPrincipal } from "@Kavero/api/services/token-service";
import {
  PAGE_PRESETS,
  PRODUCT_AVAILABILITY,
  TEMPLATES,
  createCatalog,
  createFromTemplate,
  createId,
  duplicateCatalog,
  safeFileName,
  type CatalogDocument,
  type CatalogElement,
} from "@Kavero/catalog-engine";
import type { Database } from "@Kavero/db";
import type { EditorCommand, NewElement } from "@Kavero/editor-core";
import type { LlmProvider } from "@Kavero/ai";
import { exportPptx } from "@Kavero/export-pptx";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

export interface McpHost {
  /** PNG of a slide in its finished state (headless Chrome). Optional. */
  renderPreview?: (doc: CatalogDocument, slideIndex: number) => Promise<Uint8Array>;
  /** Absolute URL of a published catalog. */
  publicUrl: (slug: string) => string;
  /** Link that opens a catalog in the Kavero editor (pulls it into the browser if needed). */
  editorUrl?: (documentId: string) => string;
  /** Store raw image bytes (base64 uploads) like importImage does for URLs. Optional. */
  importImageData?: (catalogRowId: string, bytes: Uint8Array, mimeType: string) => Promise<{ id: string; mimeType: string; bytes: number; hash: string; width?: number; height?: number }>;
  /**
   * Download an image from a public URL into a cloud catalog's storage (with
   * SSRF protection). Returns the asset to add to the document. Optional.
   */
  importImage?: (catalogRowId: string, url: string, name: string) => Promise<{ id: string; mimeType: string; bytes: number; hash: string; width?: number; height?: number }>;
  /** Configured LLM for catalog_generate; null uses the offline planner. */
  ai?: LlmProvider | null;
  /** PDF of a catalog (headless Chrome). Optional. */
  renderPdf?: (doc: CatalogDocument) => Promise<Uint8Array>;
  /** Image/font files of a cloud catalog as data: URLs, for exporters. */
  loadAssets?: (doc: CatalogDocument) => Promise<Record<string, string>>;
  /** Remove stored files (storage keys) of a deleted catalog. Optional. */
  deleteObjects?: (storageKeys: string[]) => Promise<void>;
  /**
   * Store a font file in a cloud catalog, from a public https URL (SSRF-protected,
   * <= 15 MB) or raw bytes. The file type is checked from its contents. Optional.
   */
  importFont?: (catalogRowId: string, source: { url: string } | { bytes: Uint8Array }) => Promise<{ id: string; mimeType: string; bytes: number; hash: string }>;
  /** Faces of a Google Fonts family (complete TTF files on fonts.gstatic.com). Optional. */
  googleFontFaces?: (family: string, weights: number[], italic: boolean) => Promise<{ faces: { weight: number; style: "normal" | "italic"; url: string }[]; missingWeights: number[] }>;
}

const MAX_EXPORT_BYTES = 25 * 1024 * 1024;

const ELEMENT_HELP = `Element JSON (positions in document pixels; see catalog_get for page size):
- text:    {"type":"text","position":{"x":80,"y":80,"width":800,"height":120},"content":{"paragraphs":[[{"text":"Hello","bold":true}]]},"style":{"fontSize":64,"fontWeight":700,"color":"token:text","fontFamily":"token:heading","align":"left"}}
- shape:   {"type":"shape","position":{...},"content":{"shape":"rect|ellipse|triangle|line|arrow"},"style":{"fill":"token:primary","borderRadius":12}}
- image:   {"type":"image","position":{...},"content":{"assetId":"ast_..."},"style":{"fit":"cover"}}  (assetId must exist in the catalog)
- product: {"type":"product","position":{...},"content":{"productId":"prd_..."}}
- product-grid: {"type":"product-grid","position":{...},"content":{"columns":3,"products":[{"productId":"prd_..."}]}}
- button:  {"type":"button","position":{...},"content":{"label":"Shop now","href":"https://..."}}
- html:    {"type":"html","position":{...},"content":{"html":"<h2>Hi</h2>","css":"h2{color:var(--kv-primary)}"}}  (scripts are removed)
Colors may be hex or theme tokens: token:background, token:text, token:muted, token:primary, token:on-primary, token:accent.
Text style: align "start" | "center" | "end" (start = right in RTL catalogs such as language "fa"/"ar"); direction "auto" (default, per paragraph) | "rtl" | "ltr" (use "ltr" for phone numbers or codes inside RTL slides). Do not insert Unicode bidi control characters.
Images, logos and background photos: add the file with asset_import first, then use its assetId (image element, or slide background {"kind":"image","assetId":...}).`;

const id = z.string().min(1).max(100);
const positionShape = z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive(), rotation: z.number().optional() });

type Ctx = { db: Database; principal: TokenPrincipal; host: McpHost };

const ok = (data: unknown, extra: CallToolResult["content"] = []): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }, ...extra],
  structuredContent: typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : { result: data },
});
const fail = (message: string): CallToolResult => ({ isError: true, content: [{ type: "text", text: message }] });

/** Compact, agent-friendly outline of a catalog (ids + text, no styling noise). */
export function outline(doc: CatalogDocument) {
  const text = (el: CatalogElement) =>
    el.type === "text" ? el.content.paragraphs.map((p) => p.map((r) => r.text).join("")).join(" / ").slice(0, 120)
    : el.type === "button" ? el.content.label
    : el.type === "html" ? el.content.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80)
    : el.type === "product" ? `product ${el.content.productId}`
    : el.type === "product-grid" ? `${el.content.products.length} products`
    : undefined;
  return {
    id: doc.id,
    title: doc.metadata.title,
    page: { width: doc.settings.width, height: doc.settings.height },
    theme: doc.theme,
    products: doc.products.map((p) => ({
      id: p.id, name: p.name, price: p.price, currency: p.currency, sku: p.sku, brand: p.brand, category: p.category,
      compareAtPrice: p.compareAtPrice, badge: p.badge, availability: p.availability, images: p.imageAssetIds.length || undefined,
    })),
    assets: doc.assets.map((a) => ({ id: a.id, kind: a.kind, name: a.name, ...(a.kind === "font" ? { family: a.family, weight: a.fontWeight ?? 400, style: a.fontStyle ?? "normal" } : {}) })),
    slides: doc.slides.map((s, i) => ({
      index: i, id: s.id, name: s.name, transition: s.transition?.type,
      elements: s.elements.map((e) => ({ id: e.id, type: e.type, position: e.position, text: text(e), animations: e.animations.length || undefined })),
    })),
  };
}

/** imageUrl first (the primary image), then imageUrls, without duplicates. */
function productImageUrls(p: { imageUrl?: string; imageUrls?: string[] }): string[] {
  return [...new Set([p.imageUrl, ...(p.imageUrls ?? [])].filter((u): u is string => !!u))];
}

const GENERIC_FONTS = new Set(["system-ui", "sans-serif", "serif", "monospace", "cursive", "fantasy"]);

/** Every font family a catalog uses or stores, where it's used, and where it loads from. */
export function fontSummary(doc: CatalogDocument) {
  type Entry = { family: string; themeRoles: string[]; textElements: number; slides: Set<number>; files: { assetId: string; weight: number; style: string; source?: string; bytes?: number }[] };
  const families = new Map<string, Entry>();
  const entry = (family: string) => {
    let e = families.get(family);
    if (!e) families.set(family, (e = { family, themeRoles: [], textElements: 0, slides: new Set(), files: [] }));
    return e;
  };
  for (const [role, family] of Object.entries(doc.theme.fonts)) if (family) entry(family).themeRoles.push(role);
  doc.slides.forEach((s, i) => {
    for (const el of s.elements) {
      if (el.type !== "text") continue;
      const f = el.style.fontFamily.startsWith("token:") ? doc.theme.fonts[el.style.fontFamily.slice(6)] : el.style.fontFamily;
      if (!f) continue;
      const e = entry(f);
      e.textElements++;
      e.slides.add(i);
    }
  });
  for (const a of doc.assets) if (a.kind === "font" && a.family) entry(a.family).files.push({ assetId: a.id, weight: a.fontWeight ?? 400, style: a.fontStyle ?? "normal", source: a.fontSource, bytes: a.bytes });
  return {
    theme: doc.theme.fonts,
    families: [...families.values()].map((f) => ({
      family: f.family,
      loadedFrom: f.files.length ? "catalog files" : GENERIC_FONTS.has(f.family) ? "system" : "Google Fonts (by name)",
      themeRoles: f.themeRoles,
      textElements: f.textElements,
      slides: [...f.slides].map((i) => i + 1),
      files: f.files.sort((a, b) => a.weight - b.weight || a.style.localeCompare(b.style)),
    })),
  };
}

/**
 * Kavero's MCP server for one authenticated principal. Every tool goes through
 * the same services (and validation) as the web app.
 */
export function createKaveroMcpServer({ db, principal, host }: Ctx) {
  const server = new McpServer({ name: "kavero", version: "0.1.0" }, { instructions: "Create and edit Kavero product catalogs: slides with text, images, products, shapes and HTML; themes, transitions, animations; previews and website publishing. Call catalog_get first to see ids and page size." });
  const catalogs = new CatalogService(db);
  const pubs = new PublicationService(db);
  const uid = principal.userId;

  /** Scope check + audit + error mapping around every tool. */
  function guard<A extends Record<string, unknown>>(name: string, scope: Scope, fn: (args: A) => Promise<CallToolResult>) {
    return async (args: A): Promise<CallToolResult> => {
      const target = typeof args.catalogId === "string" ? args.catalogId : null;
      if (!principal.scopes.includes(scope)) {
        await audit(db, { userId: uid, tokenId: principal.tokenId, action: `mcp:${name}`, target, outcome: "denied", details: { missingScope: scope } });
        return fail(`This token doesn't have the "${scope}" permission. Create a token with it in Kavero settings.`);
      }
      try {
        const result = await fn(args);
        await audit(db, { userId: uid, tokenId: principal.tokenId, action: `mcp:${name}`, target, outcome: result.isError ? "error" : "ok" });
        return result;
      } catch (e) {
        const message = e instanceof TRPCError || e instanceof Error ? e.message : "Unexpected error";
        await audit(db, { userId: uid, tokenId: principal.tokenId, action: `mcp:${name}`, target, outcome: "error", details: { message } });
        return fail(message);
      }
    };
  }

  const edit = async (catalogId: string, commands: EditorCommand[]) => {
    const r = await catalogs.applyCommands(uid, catalogId, commands);
    return { catalogId: r.id, revision: r.revision, createdIds: r.createdIds };
  };

  // ---------- Catalogs ----------

  server.registerTool("catalog_list", {
    title: "List catalogs", description: "List the user's cloud catalogs.", annotations: { readOnlyHint: true },
  }, guard("catalog_list", "catalogs:read", async () => ok({ catalogs: (await catalogs.list(uid)).map((c) => ({ catalogId: c.id, title: c.title, slides: c.slideCount, revision: c.revision, updatedAt: c.updatedAt, workspace: c.workspaceName, role: c.role })) })));

  server.registerTool("catalog_get", {
    title: "Get catalog", description: "Outline of a catalog: page size, theme, products, assets and every slide's elements with ids. Set full=true for the complete JSON document.",
    inputSchema: { catalogId: id, full: z.boolean().optional() }, annotations: { readOnlyHint: true },
  }, guard("catalog_get", "catalogs:read", async ({ catalogId, full }) => {
    const r = await catalogs.get(uid, catalogId);
    return ok({ catalogId: r.id, revision: r.revision, editorUrl: host.editorUrl?.(r.document.id), ...(full ? { document: r.document } : outline(r.document)) });
  }));

  server.registerTool("catalog_create", {
    title: "Create catalog",
    description: `Create a cloud catalog, blank or from a template (${TEMPLATES.map((t) => `${t.id}: ${t.description}`).join("; ")}).`,
    inputSchema: {
      title: z.string().min(1).max(200), description: z.string().max(500).optional(),
      template: z.enum(["blank", ...TEMPLATES.map((t) => t.id)] as [string, ...string[]]).optional(),
      page: z.enum(Object.keys(PAGE_PRESETS) as [string, ...string[]]).optional(),
      language: z.string().max(10).optional(), currency: z.string().length(3).optional(),
      workspaceId: z.string().max(100).optional().describe("Create inside this workspace (see catalog_list); default: personal"),
    },
  }, guard("catalog_create", "catalogs:write", async (a) => {
    const input = { title: a.title, description: a.description, language: a.language, currency: a.currency?.toUpperCase(), page: a.page as keyof typeof PAGE_PRESETS | undefined };
    const doc = a.template && a.template !== "blank" ? createFromTemplate(a.template, input) : createCatalog(input);
    const r = await catalogs.create(uid, doc, a.workspaceId);
    return ok({ catalogId: r.id, revision: r.revision, editorUrl: host.editorUrl?.(doc.id), slideIds: doc.slides.map((s) => s.id), page: { width: doc.settings.width, height: doc.settings.height } });
  }));

  server.registerTool("catalog_update", {
    title: "Update catalog details", description: "Change title, description, language or currency.",
    inputSchema: { catalogId: id, title: z.string().min(1).max(200).optional(), description: z.string().max(500).optional(), language: z.string().max(10).optional(), currency: z.string().length(3).optional() },
  }, guard("catalog_update", "catalogs:write", async ({ catalogId, ...changes }) => ok(await edit(catalogId, [{ type: "catalog.updateMetadata", changes: { ...changes, currency: changes.currency?.toUpperCase() } }]))));

  server.registerTool("catalog_delete", {
    title: "Delete catalog", description: "Permanently delete a cloud catalog and its published website. Ask the user first, then pass confirm: true.",
    inputSchema: { catalogId: id, confirm: z.literal(true).describe("Must be true; confirms the user approved this deletion") },
    annotations: { destructiveHint: true },
  }, guard("catalog_delete", "catalogs:delete", async ({ catalogId }) => {
    const { storageKeys } = await catalogs.delete(uid, catalogId);
    await host.deleteObjects?.(storageKeys).catch(() => undefined);
    return ok({ deleted: catalogId });
  }));

  server.registerTool("catalog_duplicate", {
    title: "Duplicate catalog", description: "Copy a catalog (new ids). Images are not copied yet; image elements in the copy show placeholders.",
    inputSchema: { catalogId: id, title: z.string().max(200).optional() },
  }, guard("catalog_duplicate", "catalogs:write", async ({ catalogId, title }) => {
    const { document } = await catalogs.get(uid, catalogId);
    const copy = duplicateCatalog(document, title);
    const r = await catalogs.create(uid, copy);
    return ok({ catalogId: r.id, title: copy.metadata.title });
  }));

  server.registerTool("catalog_apply_theme", {
    title: "Apply theme", description: "Apply a template's colors and fonts, and/or set individual theme colors (hex) and fonts.",
    inputSchema: {
      catalogId: id, template: z.enum(TEMPLATES.map((t) => t.id) as [string, ...string[]]).optional(),
      colors: z.record(z.string(), z.string().regex(/^#[0-9a-fA-F]{6}$/)).optional(), fonts: z.record(z.string(), z.string().max(80)).optional(),
    },
  }, guard("catalog_apply_theme", "catalogs:write", async ({ catalogId, template, colors, fonts }) => {
    const base = template ? TEMPLATES.find((t) => t.id === template)!.theme : { colors: {}, fonts: {} };
    return ok(await edit(catalogId, [{ type: "catalog.updateTheme", theme: { colors: { ...base.colors, ...colors }, fonts: { ...base.fonts, ...fonts } } }]));
  }));

  // ---------- Slides ----------

  const background = z.union([
    z.object({ kind: z.literal("color"), color: z.string() }),
    z.object({ kind: z.literal("gradient"), from: z.string(), to: z.string(), angle: z.number().optional() }),
    z.object({ kind: z.literal("image"), assetId: id }),
  ]);

  server.registerTool("slide_create", {
    title: "Add slide", description: "Add an empty slide (default: at the end).",
    inputSchema: { catalogId: id, name: z.string().max(100).optional(), index: z.number().int().min(0).optional(), background: background.optional() },
  }, guard("slide_create", "catalogs:write", async ({ catalogId, name, index, background: bg }) =>
    ok(await edit(catalogId, [{ type: "slide.add", index, slide: { name: name ?? "Slide", ...(bg ? { background: bg as never } : {}) } }]))));

  server.registerTool("slide_update", {
    title: "Update slide", description: "Rename a slide, change its background or its duration (ms) in playback/video.",
    inputSchema: { catalogId: id, slideId: id, name: z.string().max(100).optional(), background: background.optional(), durationMs: z.number().int().min(500).max(600_000).optional() },
  }, guard("slide_update", "catalogs:write", async ({ catalogId, slideId, ...changes }) =>
    ok(await edit(catalogId, [{ type: "slide.update", slideId, changes: changes as never }]))));

  server.registerTool("slide_delete", {
    title: "Delete slide", description: "Remove a slide (a catalog keeps at least one).", inputSchema: { catalogId: id, slideId: id }, annotations: { destructiveHint: true },
  }, guard("slide_delete", "catalogs:write", async ({ catalogId, slideId }) => ok(await edit(catalogId, [{ type: "slide.delete", slideId }]))));

  server.registerTool("slide_reorder", {
    title: "Move slide", description: "Move a slide to a new 0-based position.", inputSchema: { catalogId: id, slideId: id, toIndex: z.number().int().min(0) },
  }, guard("slide_reorder", "catalogs:write", async ({ catalogId, slideId, toIndex }) => ok(await edit(catalogId, [{ type: "slide.move", slideId, toIndex }]))));

  // ---------- Elements ----------

  server.registerTool("slide_add_element", {
    title: "Add element", description: `Add one or more elements to a slide.\n${ELEMENT_HELP}`,
    inputSchema: { catalogId: id, slideId: id, elements: z.array(z.object({ type: z.string(), position: positionShape }).passthrough()).min(1).max(50) },
  }, guard("slide_add_element", "catalogs:write", async ({ catalogId, slideId, elements }) =>
    ok(await edit(catalogId, elements.map((element) => ({ type: "element.add" as const, slideId, element: { rotation: 0, ...element, position: { rotation: 0, ...element.position } } as unknown as NewElement }))))));

  server.registerTool("slide_update_element", {
    title: "Update element", description: "Deep-merge changes into an element, e.g. {\"style\":{\"fontSize\":48}} or {\"position\":{\"x\":100}} or {\"content\":{\"paragraphs\":[[{\"text\":\"New\"}]]}}. Arrays are replaced, not merged.",
    inputSchema: { catalogId: id, elementId: id, changes: z.record(z.string(), z.unknown()) },
  }, guard("slide_update_element", "catalogs:write", async ({ catalogId, elementId, changes }) => {
    const { position, ...rest } = changes as { position?: Record<string, number> };
    const commands: EditorCommand[] = [];
    if (position) commands.push({ type: "element.move", elementId, position });
    if (Object.keys(rest).length) commands.push({ type: "element.update", elementId, changes: rest });
    return ok(await edit(catalogId, commands));
  }));

  server.registerTool("slide_remove_element", {
    title: "Remove element", description: "Delete an element.", inputSchema: { catalogId: id, elementId: id }, annotations: { destructiveHint: true },
  }, guard("slide_remove_element", "catalogs:write", async ({ catalogId, elementId }) => ok(await edit(catalogId, [{ type: "element.delete", elementId }]))));

  // ---------- Motion ----------

  server.registerTool("catalog_set_transition", {
    title: "Set slide transition", description: "Transition played when this slide appears (none removes it).",
    inputSchema: { catalogId: id, slideId: id, type: z.enum(["none", "fade", "morph", "slide", "push", "zoom", "wipe", "flip"]), durationMs: z.number().int().min(100).max(10_000).optional(), direction: z.enum(["left", "right", "up", "down"]).optional() },
  }, guard("catalog_set_transition", "catalogs:write", async ({ catalogId, slideId, type, durationMs, direction }) =>
    ok(await edit(catalogId, [{ type: "slide.setTransition", slideId, transition: type === "none" ? null : { type, durationMs, direction } }]))));

  server.registerTool("catalog_animate_element", {
    title: "Animate element", description: "Add an animation to an element. Triggers: on-enter (with slide), after-previous, with-previous.",
    inputSchema: {
      catalogId: id, elementId: id,
      category: z.enum(["entrance", "exit", "emphasis"]), preset: z.enum(["fade", "slide", "scale", "bounce", "rotate", "blur", "float", "pulse"]),
      trigger: z.enum(["on-enter", "after-previous", "with-previous"]).optional(), durationMs: z.number().int().min(50).max(60_000).optional(),
      delayMs: z.number().int().min(0).max(60_000).optional(), direction: z.enum(["left", "right", "up", "down"]).optional(),
    },
  }, guard("catalog_animate_element", "catalogs:write", async ({ catalogId, elementId, ...animation }) =>
    ok(await edit(catalogId, [{ type: "element.addAnimation", elementId, animation }]))));

  // ---------- Products ----------

  const productInput = z.object({
    id: z.string().max(100).optional(), name: z.string().min(1).max(200), description: z.string().max(2000).optional(),
    subtitle: z.string().max(200).optional().describe("Short tagline shown under the name"),
    brand: z.string().max(100).optional(),
    sku: z.string().max(100).optional(), price: z.number().optional(), currency: z.string().length(3).optional(),
    compareAtPrice: z.number().nonnegative().optional().describe("Original price; shown struck through when higher than price"),
    unit: z.string().max(30).optional().describe('Shown after the price, e.g. "per m²" or "/ kg"'),
    badge: z.string().max(30).optional().describe('Short label over the photo, e.g. "New", "Sale"'),
    availability: z.enum(PRODUCT_AVAILABILITY).optional(),
    rating: z.number().min(0).max(5).optional(),
    tags: z.array(z.string().max(50)).max(30).optional().describe("Search keywords; not shown on cards"),
    url: z.string().url().optional(), category: z.string().max(100).optional(),
    attributes: z.record(z.string(), z.string()).optional().describe("Specs as label → value, in display order"),
    imageUrl: z.string().url().optional().describe("Public https image URL; downloaded and stored with the catalog (becomes the primary image)"),
    imageUrls: z.array(z.string().url()).max(10).optional().describe("More public https image URLs (gallery), after imageUrl"),
  });

  server.registerTool("catalog_import_products", {
    title: "Import products",
    description: "Add or update products in a catalog (matching on id), with optional image URLs that Kavero downloads and stores. Optionally add slides with product grids: one slide per category, or one slide for all (max 6 products per slide).",
    inputSchema: { catalogId: id, products: z.array(productInput).min(1).max(500), addSlides: z.enum(["none", "single", "per-category"]).optional(), columns: z.number().int().min(1).max(6).optional(), source: z.string().max(100).optional() },
  }, guard("catalog_import_products", "catalogs:write", async ({ catalogId, products, addSlides = "none", columns = 3, source }) => {
    // Check edit rights before storing any files, not only when the edit is applied.
    await catalogs.access(uid, catalogId, "write");
    const { id: rowId, document } = await catalogs.get(uid, catalogId);
    const ids = products.map((p) => p.id ?? createId("prd"));
    const commands: EditorCommand[] = [];
    const warnings: string[] = [];
    const imageFor = new Map<number, string[]>();
    if (host.importImage) {
      const wanted = products.flatMap((p, i) => productImageUrls(p).map((url) => ({ i, url }))).slice(0, 60);
      for (const { i, url } of wanted) {
        try {
          const asset = await host.importImage(rowId, url, products[i]!.name);
          if (!document.assets.some((a) => a.id === asset.id) && !commands.some((c) => c.type === "asset.add" && c.asset.id === asset.id)) {
            commands.push({ type: "asset.add", asset: { id: asset.id, kind: "image", mimeType: asset.mimeType, name: products[i]!.name, uri: `cloud://${asset.id}`, bytes: asset.bytes, hash: asset.hash, width: asset.width, height: asset.height } });
          }
          const list = imageFor.get(i) ?? [];
          if (!list.includes(asset.id)) imageFor.set(i, [...list, asset.id]);
        } catch (e) {
          warnings.push(`${products[i]!.name}: image not imported (${(e as Error).message})`);
        }
      }
    } else if (products.some((p) => productImageUrls(p).length)) warnings.push("Image import isn't available on this server");
    products.forEach((p, i) => {
      const { imageUrl: _u, imageUrls: _us, ...rest } = p;
      const existing = document.products.find((x) => x.id === ids[i]);
      commands.push({ type: "product.upsert", product: { ...rest, id: ids[i], currency: p.currency?.toUpperCase(), source, imageAssetIds: imageFor.get(i) ?? existing?.imageAssetIds ?? [] } });
    });
    if (addSlides !== "none") {
      const groups = new Map<string, string[]>();
      products.forEach((p, i) => {
        const key = addSlides === "per-category" ? (p.category ?? "Products") : "Products";
        groups.set(key, [...(groups.get(key) ?? []), ids[i]!]);
      });
      const { width: W, height: H } = document.settings;
      const m = Math.round(Math.min(W, H) * 0.07);
      for (const [name, all] of groups) for (let k = 0; k < all.length; k += 6) {
        const pids = all.slice(k, k + 6);
        const slideId = createId("sld");
        commands.push({ type: "slide.add", slide: { id: slideId, name } });
        commands.push({ type: "element.add", slideId, element: { type: "text", position: { x: m, y: m, width: W - 2 * m, height: H * 0.1, rotation: 0 }, content: { paragraphs: [[{ text: name }]] }, style: { fontSize: Math.round(H * 0.05), fontWeight: 700, fontFamily: "token:heading" } } as unknown as NewElement });
        commands.push({ type: "element.add", slideId, element: { type: "product-grid", position: { x: m, y: m + H * 0.14, width: W - 2 * m, height: H - 2 * m - H * 0.14, rotation: 0 }, content: { columns, products: pids.map((productId) => ({ productId })) } } as unknown as NewElement });
      }
    }
    const r = await edit(catalogId, commands);
    return ok({ ...r, productIds: ids, imagesImported: imageFor.size, warnings });
  }));

  // ---------- Assets ----------

  server.registerTool("asset_import", {
    title: "Import image",
    description: "Add an image (cover photo, background, logo, illustration) to a catalog from a public https URL or base64 data. Returns the assetId plus width/height; then place it with slide_add_element ({\"type\":\"image\",\"content\":{\"assetId\":...}}) or slide_update ({\"background\":{\"kind\":\"image\",\"assetId\":...}}).",
    inputSchema: {
      catalogId: id,
      url: z.string().url().optional().describe("Public http(s) image URL"),
      data: z.string().max(20_000_000).optional().describe("Base64 image bytes (PNG, JPEG, GIF, WebP), for agents without a public URL"),
      mimeType: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]).optional().describe("Required with data"),
      name: z.string().min(1).max(120).describe("Human-readable name, e.g. 'Cover photo'"),
    },
  }, guard("asset_import", "catalogs:write", async ({ catalogId, url, data, mimeType, name }) => {
    if (!!url === !!data) return fail("Pass either url or data (base64), not both.");
    await catalogs.access(uid, catalogId, "write");
    const { id: rowId, document } = await catalogs.get(uid, catalogId);
    let asset;
    if (url) {
      if (!host.importImage) return fail("Image import isn't available on this server.");
      asset = await host.importImage(rowId, url, name);
    } else {
      if (!host.importImageData) return fail("Uploading image data isn't available on this server.");
      if (!mimeType) return fail("mimeType is required with data.");
      const bytes = Uint8Array.from(Buffer.from(data!.replace(/^data:[^,]*,/, ""), "base64"));
      if (!bytes.byteLength) return fail("The data is empty or not valid base64.");
      asset = await host.importImageData(rowId, bytes, mimeType);
    }
    const commands: EditorCommand[] = document.assets.some((a) => a.id === asset.id)
      ? []
      : [{ type: "asset.add", asset: { id: asset.id, kind: "image", mimeType: asset.mimeType, name, uri: `cloud://${asset.id}`, bytes: asset.bytes, hash: asset.hash, width: asset.width, height: asset.height } }];
    if (commands.length) await edit(catalogId, commands);
    return ok({ assetId: asset.id, width: asset.width, height: asset.height, mimeType: asset.mimeType, alreadyPresent: !commands.length });
  }));

  // ---------- Fonts ----------

  const weightsSchema = z.array(z.number().int().min(100).max(900).refine((w) => w % 100 === 0, "Weights are 100, 200 … 900")).min(1).max(9);
  const applyToSchema = z.enum(["heading", "body", "both"]).optional().describe("Also make this the theme's heading font, body font, or both");
  const badFamily = (family: string) => /["\\<>{};]/.test(family) ? "The family name can't contain quotes, backslashes, angle brackets, braces or semicolons." : null;
  const cleanFamily = (family: string) => family.trim().replace(/\s+/g, " ");
  const themeFonts = (family: string, roles?: "heading" | "body" | "both"): EditorCommand[] =>
    roles ? [{ type: "catalog.updateTheme", theme: { fonts: { ...(roles !== "body" ? { heading: family } : {}), ...(roles !== "heading" ? { body: family } : {}) } } }] : [];
  const fontAsset = (stored: { id: string; mimeType: string; bytes: number; hash: string }, face: { family: string; weight: number; style: "normal" | "italic"; source: "upload" | "google"; name: string }): EditorCommand => ({
    type: "asset.add",
    asset: { id: stored.id, kind: "font", mimeType: stored.mimeType, name: face.name, uri: `cloud://${stored.id}`, bytes: stored.bytes, hash: stored.hash, family: face.family, fontWeight: face.weight, fontStyle: face.style, fontSource: face.source },
  });
  const faceName = (family: string, weight: number, style: string) => `${family} ${weight}${style === "italic" ? " Italic" : ""}`;

  server.registerTool("font_list", {
    title: "List fonts",
    description: "Fonts of a catalog: the theme's heading/body fonts, font files stored in the catalog (family, weight, style, assetId), families loaded from Google Fonts by name, and how many text elements use each family.",
    inputSchema: { catalogId: id },
    annotations: { readOnlyHint: true },
  }, guard("font_list", "catalogs:read", async ({ catalogId }) => {
    const { document: doc } = await catalogs.get(uid, catalogId);
    return ok(fontSummary(doc));
  }));

  server.registerTool("font_add_google", {
    title: "Add Google font",
    description: "Add a Google Fonts family (exact name from fonts.google.com, e.g. \"Playfair Display\", \"Vazirmatn\", \"Noto Sans Arabic\"). With embed=true (default) the complete font files are stored in the catalog, so PDF, video, image and offline HTML exports never depend on Google and every script (Latin, Persian, Arabic…) is covered. Set applyTo to make it the heading and/or body font; use font_apply for single text elements.",
    inputSchema: {
      catalogId: id,
      family: z.string().min(1).max(80),
      weights: weightsSchema.optional().describe("Default [400, 600, 700]. Weights the family doesn't have are skipped."),
      italic: z.boolean().optional().describe("Also add italic faces (default false)"),
      embed: z.boolean().optional().describe("Store the font files in the catalog (default true). false = load from Google Fonts by name when the catalog is shown."),
      applyTo: applyToSchema,
    },
  }, guard("font_add_google", "catalogs:write", async ({ catalogId, family, weights = [400, 600, 700], italic = false, embed = true, applyTo }) => {
    if (!host.googleFontFaces) return fail("Google Fonts aren't available on this server.");
    if (embed && !host.importFont) return fail("Storing font files isn't available on this server. Use embed=false.");
    await catalogs.access(uid, catalogId, "write");
    const { id: rowId, document } = await catalogs.get(uid, catalogId);
    const name = cleanFamily(family);
    const { faces, missingWeights } = await host.googleFontFaces(name, [...new Set(weights)].sort((a, b) => a - b), italic);
    const commands: EditorCommand[] = [];
    const added: { assetId: string; weight: number; style: string }[] = [];
    if (embed) {
      for (const face of faces) {
        const stored = await host.importFont!(rowId, { url: face.url });
        if (document.assets.some((a) => a.id === stored.id) || added.some((a) => a.assetId === stored.id)) continue;
        commands.push(fontAsset(stored, { family: name, weight: face.weight, style: face.style, source: "google", name: faceName(name, face.weight, face.style) }));
        added.push({ assetId: stored.id, weight: face.weight, style: face.style });
      }
    }
    commands.push(...themeFonts(name, applyTo));
    const r = commands.length ? await edit(catalogId, commands) : null;
    return ok({
      ...(r ?? { catalogId }),
      family: name,
      embedded: embed,
      faces: faces.map((f) => ({ weight: f.weight, style: f.style })),
      added,
      missingWeights: missingWeights.length ? missingWeights : undefined,
      theme: applyTo ? { ...document.theme.fonts, ...(applyTo !== "body" ? { heading: name } : {}), ...(applyTo !== "heading" ? { body: name } : {}) } : document.theme.fonts,
      note: embed
        ? `Stored in the catalog. Use "${name}" as fontFamily on text elements (font_apply), or applyTo for the theme.`
        : `Loaded from Google Fonts by name when the catalog is shown. Use "${name}" as fontFamily (font_apply).`,
    });
  }));

  server.registerTool("font_upload", {
    title: "Upload font file",
    description: "Store a font file (TTF, OTF, WOFF or WOFF2, up to 15 MB) in a catalog from a public https URL or base64 data, for brand or licensed fonts that aren't on Google Fonts. Each call adds one face: give the family name text should use and the weight/style this file provides. Only upload fonts whose license allows embedding.",
    inputSchema: {
      catalogId: id,
      family: z.string().min(1).max(80).describe("Family name text elements will use, e.g. \"Acme Sans\""),
      url: z.string().url().optional().describe("Public https URL of the font file"),
      data: z.string().max(21_000_000).optional().describe("Base64 font bytes, for agents without a public URL"),
      weight: z.number().int().min(100).max(900).optional().describe("Weight this file provides (default 400)"),
      style: z.enum(["normal", "italic"]).optional(),
      name: z.string().max(120).optional().describe("Label shown in the editor (default \"<family> <weight>\")"),
      applyTo: applyToSchema,
    },
  }, guard("font_upload", "catalogs:write", async ({ catalogId, family, url, data, weight = 400, style = "normal", name, applyTo }) => {
    if (!!url === !!data) return fail("Pass either url or data (base64), not both.");
    const bad = badFamily(family);
    if (bad) return fail(bad);
    if (!host.importFont) return fail("Storing font files isn't available on this server.");
    await catalogs.access(uid, catalogId, "write");
    const { id: rowId, document } = await catalogs.get(uid, catalogId);
    const fam = cleanFamily(family);
    let stored;
    if (url) stored = await host.importFont(rowId, { url });
    else {
      const bytes = Uint8Array.from(Buffer.from(data!.replace(/^data:[^,]*,/, ""), "base64"));
      if (!bytes.byteLength) return fail("The data is empty or not valid base64.");
      stored = await host.importFont(rowId, { bytes });
    }
    const existing = document.assets.find((a) => a.id === stored.id);
    const commands: EditorCommand[] = existing ? [] : [fontAsset(stored, { family: fam, weight, style, source: "upload", name: name?.trim() || faceName(fam, weight, style) })];
    commands.push(...themeFonts(existing?.family ?? fam, applyTo));
    const r = commands.length ? await edit(catalogId, commands) : null;
    return ok({ ...(r ?? { catalogId }), assetId: stored.id, family: existing?.family ?? fam, weight: existing?.fontWeight ?? weight, style: existing?.fontStyle ?? style, mimeType: stored.mimeType, bytes: stored.bytes, alreadyPresent: !!existing });
  }));

  server.registerTool("font_apply", {
    title: "Apply font",
    description: "Use a font family as the theme's heading and/or body font (every element using token:heading / token:body follows), and/or on specific text elements, optionally with a weight. Works with fonts added by font_add_google / font_upload and with any Google Fonts family name.",
    inputSchema: {
      catalogId: id,
      family: z.string().min(1).max(80),
      theme: z.enum(["heading", "body", "both"]).optional().describe("Theme role(s) to set"),
      elementIds: z.array(id).max(200).optional().describe("Text elements to change"),
      weight: z.number().int().min(100).max(900).optional().describe("Font weight for those elements"),
    },
  }, guard("font_apply", "catalogs:write", async ({ catalogId, family, theme, elementIds = [], weight }) => {
    if (!theme && !elementIds.length) return fail("Pass theme and/or elementIds.");
    const bad = badFamily(family);
    if (bad) return fail(bad);
    const fam = cleanFamily(family);
    const { document } = await catalogs.get(uid, catalogId);
    const elements = new Map(document.slides.flatMap((s) => s.elements).map((e) => [e.id, e]));
    const notText = elementIds.filter((eid) => elements.get(eid)?.type !== "text");
    if (notText.length) return fail(`These aren't text elements of this catalog: ${notText.join(", ")}`);
    const commands: EditorCommand[] = [
      ...themeFonts(fam, theme),
      ...elementIds.map((elementId): EditorCommand => ({ type: "element.update", elementId, changes: { style: { fontFamily: fam, ...(weight ? { fontWeight: weight } : {}) } } })),
    ];
    const r = await edit(catalogId, commands);
    const stored = document.assets.some((a) => a.kind === "font" && a.family === fam);
    return ok({
      ...r, family: fam, theme: theme ?? null, elements: elementIds.length,
      ...(stored ? {} : { note: "No font file for this family is stored in the catalog, so it loads from Google Fonts by name (or a system font is used). Use font_add_google or font_upload to embed it." }),
    });
  }));

  server.registerTool("font_remove", {
    title: "Remove font",
    description: "Remove font files from a catalog: every face of a family, or one face by assetId. Text keeps its fontFamily and then loads it from Google Fonts by name if the family exists there, otherwise a system font is used. The response says where the family is still used.",
    inputSchema: { catalogId: id, family: z.string().max(80).optional(), assetId: id.optional() },
  }, guard("font_remove", "catalogs:write", async ({ catalogId, family, assetId }) => {
    if (!!family === !!assetId) return fail("Pass either family or assetId.");
    const { document } = await catalogs.get(uid, catalogId);
    const targets = document.assets.filter((a) => a.kind === "font" && (assetId ? a.id === assetId : a.family === cleanFamily(family!)));
    if (!targets.length) return fail(assetId ? `No font file "${assetId}" in this catalog.` : `No font files for "${family}" in this catalog. font_list shows what's stored.`);
    const r = await edit(catalogId, targets.map((a): EditorCommand => ({ type: "asset.remove", assetId: a.id })));
    const fam = targets[0]!.family!;
    const remaining = document.assets.filter((a) => a.kind === "font" && a.family === fam && !targets.includes(a)).length;
    const usage = fontSummary(document).families.find((f) => f.family === fam);
    return ok({
      ...r,
      removed: targets.map((a) => ({ assetId: a.id, weight: a.fontWeight ?? 400, style: a.fontStyle ?? "normal" })),
      remainingFiles: remaining,
      stillUsedBy: usage && (usage.themeRoles.length || usage.textElements) ? { themeRoles: usage.themeRoles, textElements: usage.textElements } : undefined,
    });
  }));


  // ---------- AI generation ----------

  server.registerTool("catalog_generate", {
    title: "Generate catalog",
    description: "Plan and build a complete, editable catalog from a brief and products (cover, categories, product grids, featured product, comparison, closing). Uses Kavero's configured AI model, or its built-in planner when none is configured. Product imageUrl values are downloaded and stored.",
    inputSchema: {
      brief: z.string().max(4000),
      products: z.array(productInput).max(500).optional(),
      template: z.enum(TEMPLATES.map((t) => t.id) as [string, ...string[]]).optional(),
      page: z.enum(Object.keys(PAGE_PRESETS) as [string, ...string[]]).optional(),
      language: z.string().max(10).optional(), currency: z.string().length(3).optional(),
      workspaceId: z.string().max(100).optional(),
    },
  }, guard("catalog_generate", "catalogs:write", async (a) => {
    const products = (a.products ?? []).map((p) => ({ ...p, id: p.id ?? createId("prd"), currency: p.currency?.toUpperCase(), imageAssetIds: [] as string[], attributes: p.attributes ?? {} }));
    // Same per-user rate limit and AI job log as the web app.
    const result = await new AiService(db, host.ai ?? null).generate(uid, {
      brief: a.brief, products: products.map(({ imageUrl: _u, imageUrls: _us, ...p }) => p), templateId: a.template,
      page: a.page as keyof typeof PAGE_PRESETS | undefined, language: a.language, currency: a.currency?.toUpperCase(),
    });
    const created = await catalogs.create(uid, result.document, a.workspaceId);
    const warnings: string[] = [];
    const withImages = products.filter((p) => productImageUrls(p).length);
    if (withImages.length && host.importImage) {
      const commands: EditorCommand[] = [];
      let budget = 60;
      for (const p of withImages) {
        const imageAssetIds: string[] = [];
        for (const url of productImageUrls(p)) {
          if (budget-- <= 0) break;
          try {
            const asset = await host.importImage(created.id, url, p.name);
            if (!commands.some((c) => c.type === "asset.add" && c.asset.id === asset.id)) {
              commands.push({ type: "asset.add", asset: { id: asset.id, kind: "image", mimeType: asset.mimeType, name: p.name, uri: `cloud://${asset.id}`, bytes: asset.bytes, hash: asset.hash, width: asset.width, height: asset.height } });
            }
            if (!imageAssetIds.includes(asset.id)) imageAssetIds.push(asset.id);
          } catch (e) {
            warnings.push(`${p.name}: image not imported (${(e as Error).message})`);
          }
        }
        if (imageAssetIds.length) commands.push({ type: "product.upsert", product: { id: p.id, name: p.name, imageAssetIds } });
      }
      if (commands.length) await catalogs.applyCommands(uid, created.id, commands);
    }
    return ok({
      catalogId: created.id, editorUrl: host.editorUrl?.(result.document.id), source: result.source, model: result.model, template: result.plan.templateId,
      slides: result.document.slides.map((s, i) => ({ index: i, id: s.id, name: s.name })), warnings,
    });
  }));

  // ---------- Exports ----------

  const fileResult = (name: string, mimeType: string, bytes: Uint8Array, note: string): CallToolResult => {
    if (bytes.byteLength > MAX_EXPORT_BYTES) return fail("The exported file is larger than 25 MB; export it from the Kavero app instead.");
    return {
      content: [
        { type: "resource", resource: { uri: `kavero://exports/${encodeURIComponent(name)}`, mimeType, blob: Buffer.from(bytes).toString("base64") } },
        { type: "text", text: `${name} (${(bytes.byteLength / 1024).toFixed(0)} KB). ${note}` },
      ],
    };
  };
  const fileName = (doc: CatalogDocument, ext: string) => safeFileName(doc.metadata.title, ext);

  server.registerTool("catalog_export_pdf", {
    title: "Export PDF", description: "Export the catalog as a print-ready PDF (one page per slide). Returned as an embedded file.",
    inputSchema: { catalogId: id }, annotations: { readOnlyHint: true },
  }, guard("catalog_export_pdf", "catalogs:read", async ({ catalogId }) => {
    if (!host.renderPdf) return fail("PDF export isn't available on this server (no Chrome).");
    const { document } = await catalogs.get(uid, catalogId);
    return fileResult(fileName(document, "pdf"), "application/pdf", await host.renderPdf(document), "Animations are shown in their finished state.");
  }));

  server.registerTool("catalog_export_pptx", {
    title: "Export PowerPoint", description: "Export the catalog as an editable PowerPoint file (text, shapes and images stay editable). Returned as an embedded file with compatibility notes.",
    inputSchema: { catalogId: id }, annotations: { readOnlyHint: true },
  }, guard("catalog_export_pptx", "catalogs:read", async ({ catalogId }) => {
    const { document } = await catalogs.get(uid, catalogId);
    const assets = host.loadAssets ? await host.loadAssets(document) : {};
    const { data, warnings } = await exportPptx<Uint8Array>(document, { assets, outputType: "uint8array" });
    return fileResult(fileName(document, "pptx"), "application/vnd.openxmlformats-officedocument.presentationml.presentation", data, warnings.join(" ") || "No compatibility issues.");
  }));

  // ---------- Preview & publishing ----------

  server.registerTool("catalog_preview", {
    title: "Preview slide", description: "Render a slide (finished state) as a PNG image so you can check the layout.",
    inputSchema: { catalogId: id, slideIndex: z.number().int().min(0).optional() }, annotations: { readOnlyHint: true },
  }, guard("catalog_preview", "catalogs:read", async ({ catalogId, slideIndex = 0 }) => {
    if (!host.renderPreview) return fail("Previews aren't available on this server (no Chrome).");
    const { document } = await catalogs.get(uid, catalogId);
    if (!document.slides[slideIndex]) return fail(`Slide index out of range (0–${document.slides.length - 1})`);
    const png = await host.renderPreview(document, slideIndex);
    return { content: [{ type: "image", data: Buffer.from(png).toString("base64"), mimeType: "image/png" }, { type: "text", text: `Slide ${slideIndex + 1} of ${document.slides.length}: ${document.slides[slideIndex]!.name}` }] };
  }));

  server.registerTool("catalog_publish", {
    title: "Publish website",
    description: "Publish (or update) the catalog as a website. unlisted = anyone with the link; public = indexable; private = owner only. Password-protected publishing is set in the Kavero app.",
    inputSchema: { catalogId: id, visibility: z.enum(["public", "unlisted", "private"]).optional(), slug: z.string().max(80).optional() },
  }, guard("catalog_publish", "publish", async ({ catalogId, visibility, slug }) => {
    const status = await pubs.status(uid, catalogId);
    const r = await pubs.publish(uid, {
      catalogId, slug: slug ?? status.publication?.slug ?? status.suggestedSlug,
      visibility: visibility ?? (status.publication?.visibility === "password" ? "password" : (status.publication?.visibility as "public" | "unlisted" | "private" | undefined) ?? "unlisted"),
    });
    return ok({ url: host.publicUrl(r.slug), slug: r.slug, version: r.version, missingFiles: r.missingFiles });
  }));

  server.registerTool("catalog_unpublish", {
    title: "Unpublish website", description: "Take the catalog's website offline.", inputSchema: { catalogId: id }, annotations: { destructiveHint: true },
  }, guard("catalog_unpublish", "publish", async ({ catalogId }) => ok(await pubs.unpublish(uid, catalogId))));

  return server;
}

export { slugify };
