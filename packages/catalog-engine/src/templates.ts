import { createCatalog, createId, type CreateCatalogInput } from "./document";
import {
  catalogElementSchema,
  type CatalogDocument,
  type CatalogElement,
  type CatalogSlide,
  type ElementAnimation,
  type Product,
  type SlideTransition,
} from "./schema";

export const TEMPLATE_CATEGORIES = [
  "general", "fashion", "jewelry", "electronics", "furniture",
  "cosmetics", "food", "real-estate", "industrial", "automotive",
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

/** Layout families: how slides are composed, independent of colors and fonts. */
export type TemplateLayout = "editorial" | "grid" | "bold";

export interface CatalogTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  /** Layout family the template is built with. */
  layout: TemplateLayout;
  theme: CatalogDocument["theme"];
  build: (doc: CatalogDocument) => CatalogSlide[];
}

/** Category-specific wording used by the layouts. */
interface TemplateCopy {
  kicker: string;
  categoryName: string;
  categoryLine: string;
  productsTitle: string;
  detailsKicker: string;
  compareTitle: string;
  columns: [string, string, string];
  closing: string;
  closingLine: string;
}

// ---------------------------------------------------------------------------
// Element helpers (every id comes from createId, so ids are unique)
// ---------------------------------------------------------------------------

type Style = Record<string, unknown>;
type Box = { x: number; y: number; w: number; h: number };

const pos = (b: Box) => ({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(Math.max(0, b.w)), height: Math.round(Math.max(0, b.h)), rotation: 0 });

const anim = (preset: ElementAnimation["preset"], delayMs = 0, direction?: ElementAnimation["direction"], durationMs = 700): ElementAnimation => ({
  id: createId("anim"), category: "entrance", preset, trigger: "on-enter", startMs: 0, durationMs, delayMs, easing: "ease-out",
  ...(direction ? { direction } : {}),
});

const text = (b: Box, value: string, style: Style = {}, animations: ElementAnimation[] = []): CatalogElement =>
  catalogElementSchema.parse({
    id: createId("el"), type: "text", position: pos(b),
    content: { paragraphs: value.split("\n").map((line) => [{ text: line }]) },
    style: { fontFamily: "token:body", ...style }, animations,
  });

const shape = (b: Box, fill: string, opts: { shape?: "rect" | "ellipse" | "line"; radius?: number; stroke?: string; strokeWidth?: number } = {}, animations: ElementAnimation[] = []): CatalogElement =>
  catalogElementSchema.parse({
    id: createId("el"), type: "shape", position: pos(b), content: { shape: opts.shape ?? "rect" },
    style: { fill, borderRadius: opts.radius ?? 0, strokeWidth: opts.strokeWidth ?? 0, ...(opts.stroke ? { stroke: opts.stroke } : {}) },
    animations,
  });

const productCard = (b: Box, product: Product, layout: "vertical" | "horizontal" | "overlay", background?: string, radius = 8): CatalogElement =>
  catalogElementSchema.parse({
    id: createId("el"), type: "product", position: pos(b), content: { productId: product.id },
    style: { layout, showPrice: true, showDescription: true, borderRadius: radius, ...(background ? { background } : {}) },
  });

const productGrid = (b: Box, doc: CatalogDocument, columns: number, background?: string, radius = 8): CatalogElement =>
  catalogElementSchema.parse({
    id: createId("el"), type: "product-grid", position: pos(b),
    content: { products: doc.products.slice(0, columns * 2).map((p) => ({ productId: p.id, ...(p.source ? { source: p.source } : {}) })), columns },
    style: { layout: "vertical", showPrice: true, showDescription: true, borderRadius: radius, gap: Math.round(Math.min(b.w, b.h) * 0.03), ...(background ? { background } : {}) },
  });

const slide = (name: string, elements: CatalogElement[], background = "token:background", transition?: SlideTransition): CatalogSlide => ({
  id: createId("sld"), name, background: { kind: "color", color: background }, elements,
  ...(transition ? { transition } : {}),
});

const tr = (type: SlideTransition["type"], direction?: SlideTransition["direction"], durationMs = 600): SlideTransition => ({
  type, durationMs, delayMs: 0, easing: "ease-in-out", ...(direction ? { direction } : {}),
});

/** Shared page metrics, all proportional to the page size. */
function metrics(doc: CatalogDocument) {
  const { width: W, height: H } = doc.settings;
  const u = Math.min(W, H);
  return {
    W, H, u,
    land: W > H,
    m: Math.round(u * 0.07),
    fs: (k: number) => Math.max(8, Math.round(u * k)),
  };
}

const heading = (extra: Style = {}): Style => ({ fontFamily: "token:heading", fontWeight: 700, lineHeight: 1.1, ...extra });
const formatPrice = (doc: CatalogDocument, p: Product) =>
  p.price === undefined ? "" : `${p.price.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${p.currency ?? doc.metadata.currency}`;

/**
 * Product details block: a large single product card when the document has products,
 * otherwise an image placeholder shape plus editable "Product name" text.
 */
function detailBlock(doc: CatalogDocument, image: Box, info: Box, imageFill: string, kicker: string, textColor = "token:text", mutedColor = "token:muted"): CatalogElement[] {
  const { fs } = metrics(doc);
  const p = doc.products[0];
  const out: CatalogElement[] = [];
  if (p) out.push(productCard(image, { ...p }, "overlay", imageFill, 0));
  else out.push(shape(image, imageFill));
  const line = info.h / 10;
  out.push(
    text({ x: info.x, y: info.y, w: info.w, h: line }, kicker.toUpperCase(), { fontSize: fs(0.018), letterSpacing: 3, color: mutedColor, fontWeight: 600 }),
    text({ x: info.x, y: info.y + line * 1.2, w: info.w, h: line * 2.2 }, p?.name ?? "Product name", heading({ fontSize: fs(0.055), color: textColor })),
    text({ x: info.x, y: info.y + line * 3.8, w: info.w, h: line * 3.4 }, p?.description ?? "Describe the materials, craftsmanship and what makes this product stand out.", { fontSize: fs(0.022), lineHeight: 1.5, color: mutedColor }),
    text({ x: info.x, y: info.y + line * 7.6, w: info.w, h: line * 1.4 }, p ? formatPrice(doc, p) || p.sku || "" : "Price", heading({ fontSize: fs(0.04), color: textColor })),
  );
  return out;
}

/**
 * Three-column comparison: product cards when there are 3+ products,
 * otherwise tier columns made of shapes and text.
 */
function comparisonColumns(doc: CatalogDocument, area: Box, copy: TemplateCopy, opts: { card: string; highlight: string; onHighlight: string; radius: number }): CatalogElement[] {
  const { fs, land } = metrics(doc);
  const gap = area.w * 0.04;
  const out: CatalogElement[] = [];
  if (!land) {
    // Portrait: stack the three columns as rows so text stays readable.
    const rowGap = area.h * 0.04;
    const rh = (area.h - 2 * rowGap) / 3;
    for (let i = 0; i < 3; i++) {
      const r = { x: area.x, y: area.y + i * (rh + rowGap), w: area.w, h: rh };
      const p = doc.products.length >= 3 ? doc.products[i] : undefined;
      if (p) { out.push(productCard(r, p, "horizontal", opts.card, opts.radius)); continue; }
      const hi = i === 1;
      out.push(
        shape(r, hi ? opts.highlight : opts.card, { radius: opts.radius }),
        text({ x: r.x + r.w * 0.06, y: r.y + r.h * 0.18, w: r.w * 0.55, h: r.h * 0.3 }, copy.columns[i]!, heading({ fontSize: fs(0.04), color: hi ? opts.onHighlight : "token:text" })),
        text({ x: r.x + r.w * 0.06, y: r.y + r.h * 0.55, w: r.w * 0.55, h: r.h * 0.3 }, "Key features and what is included", { fontSize: fs(0.02), color: hi ? opts.onHighlight : "token:muted" }),
        text({ x: r.x + r.w * 0.62, y: r.y + r.h * 0.32, w: r.w * 0.32, h: r.h * 0.36 }, "Price", heading({ fontSize: fs(0.045), align: "end", color: hi ? opts.onHighlight : "token:text" })),
      );
    }
    return out;
  }
  const cw = (area.w - 2 * gap) / 3;
  for (let i = 0; i < 3; i++) {
    const c = { x: area.x + i * (cw + gap), y: area.y, w: cw, h: area.h };
    const p = doc.products.length >= 3 ? doc.products[i] : undefined;
    if (p) { out.push(productCard(c, p, "vertical", opts.card, opts.radius)); continue; }
    const hi = i === 1;
    const onCol = hi ? opts.onHighlight : "token:text";
    out.push(
      shape(c, hi ? opts.highlight : opts.card, { radius: opts.radius }),
      text({ x: c.x + c.w * 0.1, y: c.y + c.h * 0.1, w: c.w * 0.8, h: c.h * 0.12 }, copy.columns[i]!, heading({ fontSize: fs(0.04), color: onCol })),
      shape({ x: c.x + c.w * 0.1, y: c.y + c.h * 0.26, w: c.w * 0.2, h: Math.max(2, c.h * 0.006) }, hi ? opts.onHighlight : "token:primary"),
      text({ x: c.x + c.w * 0.1, y: c.y + c.h * 0.34, w: c.w * 0.8, h: c.h * 0.3 }, "Feature one\nFeature two\nFeature three", { fontSize: fs(0.022), lineHeight: 1.8, color: hi ? opts.onHighlight : "token:muted" }),
      text({ x: c.x + c.w * 0.1, y: c.y + c.h * 0.74, w: c.w * 0.8, h: c.h * 0.14 }, "Price", heading({ fontSize: fs(0.05), color: onCol })),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Layout families
// ---------------------------------------------------------------------------

/** Editorial: large serif-friendly type, a side color block, generous whitespace. */
function editorialLayout(copy: TemplateCopy) {
  return (doc: CatalogDocument): CatalogSlide[] => {
    const { W, H, m, fs, land } = metrics(doc);
    const title = doc.metadata.title;
    const blockW = land ? W * 0.42 : W;
    const blockH = land ? H : H * 0.46;
    const cx = land ? blockW + m : m;
    const cy = land ? 0 : blockH;
    const cw = land ? W - blockW - 2 * m : W - 2 * m;
    const ch = land ? H : H - blockH;

    const cover = slide("Cover", [
      shape({ x: 0, y: 0, w: blockW, h: blockH }, "token:accent", {}, [anim("slide", 0, land ? "right" : "down", 900)]),
      text({ x: m, y: m, w: blockW - 2 * m, h: H * 0.05 }, copy.kicker.toUpperCase(), { fontSize: fs(0.018), letterSpacing: 4, color: "token:muted", fontWeight: 600 }, [anim("fade", 500)]),
      text({ x: cx, y: cy + ch * 0.3, w: cw, h: ch * 0.3 }, title, heading({ fontSize: fs(0.085), fontWeight: 600 }), [anim("slide", 250, "up", 800)]),
      shape({ x: cx, y: cy + ch * 0.62, w: cw * 0.18, h: Math.max(2, H * 0.003) }, "token:primary"),
      text({ x: cx, y: cy + ch * 0.66, w: cw, h: ch * 0.12 }, doc.metadata.description ?? copy.categoryLine, { fontSize: fs(0.024), color: "token:muted", lineHeight: 1.5 }, [anim("fade", 650)]),
    ]);

    const category = slide("Category", [
      shape({ x: land ? W - blockW : 0, y: land ? 0 : H - blockH, w: blockW, h: blockH }, "token:accent"),
      text({ x: m, y: land ? H * 0.32 : H * 0.14, w: land ? W - blockW - 2 * m : W - 2 * m, h: H * 0.06 }, "01", heading({ fontSize: fs(0.04), color: "token:primary" })),
      text({ x: m, y: land ? H * 0.4 : H * 0.22, w: land ? W - blockW - 2 * m : W - 2 * m, h: H * 0.14 }, copy.categoryName, heading({ fontSize: fs(0.08), fontWeight: 600 })),
      text({ x: m, y: land ? H * 0.56 : H * 0.36, w: land ? W - blockW - 2 * m : W - 2 * m, h: H * 0.1 }, copy.categoryLine, { fontSize: fs(0.024), color: "token:muted", lineHeight: 1.5 }),
    ], "token:background", tr("fade", undefined, 700));

    const top = m + H * 0.12;
    const products = slide("Products", [
      text({ x: m, y: m, w: W - 2 * m, h: H * 0.08 }, copy.productsTitle, heading({ fontSize: fs(0.05), fontWeight: 600 })),
      shape({ x: m, y: m + H * 0.085, w: W - 2 * m, h: Math.max(1, H * 0.0015) }, "token:muted"),
      productGrid({ x: m, y: top, w: W - 2 * m, h: H - top - m }, doc, land ? 3 : 2, "token:background", 0),
    ], "token:background", tr("slide", "left"));

    const imgBox = land ? { x: 0, y: 0, w: W * 0.55, h: H } : { x: 0, y: 0, w: W, h: H * 0.55 };
    const infoBox = land ? { x: W * 0.55 + m, y: H * 0.2, w: W * 0.45 - 2 * m, h: H * 0.6 } : { x: m, y: H * 0.58, w: W - 2 * m, h: H * 0.38 };
    const details = slide("Product details", detailBlock(doc, imgBox, infoBox, "token:accent", copy.detailsKicker), "token:background", tr("fade", undefined, 700));

    const ctop = m + H * 0.16;
    const compare = slide("Comparison", [
      text({ x: m, y: m, w: W - 2 * m, h: H * 0.1 }, copy.compareTitle, heading({ fontSize: fs(0.055), fontWeight: 600, align: "center" })),
      ...comparisonColumns(doc, { x: m, y: ctop, w: W - 2 * m, h: H - ctop - m }, copy, { card: "token:accent", highlight: "token:primary", onHighlight: "token:on-primary", radius: 0 }),
    ], "token:background", tr("slide", "left"));

    const closing = slide("Closing", [
      shape({ x: W * 0.5 - W * 0.04, y: H * 0.36, w: W * 0.08, h: Math.max(2, H * 0.003) }, "token:primary"),
      text({ x: m, y: H * 0.4, w: W - 2 * m, h: H * 0.14 }, copy.closing, heading({ fontSize: fs(0.08), fontWeight: 600, align: "center" })),
      text({ x: m, y: H * 0.56, w: W - 2 * m, h: H * 0.08 }, copy.closingLine, { fontSize: fs(0.024), align: "center", color: "token:muted" }),
    ], "token:accent", tr("fade", undefined, 900));

    return [cover, category, products, details, compare, closing];
  };
}

/** Grid: clean catalog pages, thin rules, rounded cards, structured columns. */
function gridLayout(copy: TemplateCopy) {
  return (doc: CatalogDocument): CatalogSlide[] => {
    const { W, H, m, fs, land } = metrics(doc);
    const rule = Math.max(1, Math.round(H * 0.0015));
    const r = Math.round(Math.min(W, H) * 0.015);

    const tileTop = land ? H * 0.58 : H * 0.6;
    const tileH = H - tileTop - m;
    const tiles = land ? 3 : 2;
    const tg = W * 0.02;
    const tw = (W - 2 * m - (tiles - 1) * tg) / tiles;
    const cover = slide("Cover", [
      text({ x: m, y: m, w: W * 0.5, h: H * 0.04 }, copy.kicker.toUpperCase(), { fontSize: fs(0.018), letterSpacing: 3, fontWeight: 600, color: "token:primary" }, [anim("fade", 0)]),
      text({ x: m, y: H * 0.16, w: W - 2 * m, h: H * 0.24 }, doc.metadata.title, heading({ fontSize: fs(0.09), fontWeight: 800 }), [anim("slide", 150, "up", 800)]),
      text({ x: m, y: H * 0.42, w: (W - 2 * m) * 0.7, h: H * 0.1 }, doc.metadata.description ?? copy.categoryLine, { fontSize: fs(0.024), color: "token:muted", lineHeight: 1.5 }, [anim("fade", 450)]),
      shape({ x: m, y: tileTop - H * 0.03, w: W - 2 * m, h: rule }, "token:muted"),
      ...Array.from({ length: tiles }, (_, i) =>
        shape({ x: m + i * (tw + tg), y: tileTop, w: tw, h: tileH }, i === 0 ? "token:primary" : "token:accent", { radius: r }, [anim("scale", 500 + i * 120, undefined, 600)])),
    ]);

    const category = slide("Category", [
      text({ x: m, y: m, w: W - 2 * m, h: H * 0.04 }, "SECTION 01", { fontSize: fs(0.018), letterSpacing: 3, fontWeight: 600, color: "token:muted" }),
      shape({ x: m, y: m + H * 0.05, w: W - 2 * m, h: rule }, "token:muted"),
      text({ x: m, y: H * 0.3, w: W - 2 * m, h: H * 0.14 }, copy.categoryName, heading({ fontSize: fs(0.09), fontWeight: 800 })),
      text({ x: m, y: H * 0.46, w: (W - 2 * m) * 0.7, h: H * 0.1 }, copy.categoryLine, { fontSize: fs(0.026), color: "token:muted", lineHeight: 1.5 }),
      shape({ x: m, y: H - m - H * 0.02, w: W * 0.12, h: H * 0.02 }, "token:primary", { radius: r }),
    ], "token:background", tr("push", "left"));

    const top = m + H * 0.12;
    const products = slide("Products", [
      text({ x: m, y: m, w: W * 0.6, h: H * 0.07 }, copy.productsTitle, heading({ fontSize: fs(0.045), fontWeight: 800 })),
      text({ x: W * 0.6, y: m + H * 0.015, w: W * 0.4 - m, h: H * 0.05 }, doc.metadata.title, { fontSize: fs(0.018), align: "end", color: "token:muted" }),
      shape({ x: m, y: m + H * 0.085, w: W - 2 * m, h: rule }, "token:muted"),
      productGrid({ x: m, y: top, w: W - 2 * m, h: H - top - m }, doc, land ? 4 : 2, "token:accent", r),
    ], "token:background", tr("push", "left"));

    const panel = land ? { x: m, y: m, w: (W - 2 * m) * 0.55, h: H - 2 * m } : { x: m, y: m, w: W - 2 * m, h: H * 0.5 };
    const info = land ? { x: panel.x + panel.w + W * 0.05, y: H * 0.18, w: W - panel.x - panel.w - W * 0.05 - m, h: H * 0.64 } : { x: m, y: m + panel.h + H * 0.04, w: W - 2 * m, h: H - panel.h - 2 * m - H * 0.04 };
    const detailEls = detailBlock(doc, panel, info, "token:accent", copy.detailsKicker);
    const first = detailEls[0];
    if (first?.type === "shape") first.style.borderRadius = r;
    if (first?.type === "product") first.style.borderRadius = r;
    const details = slide("Product details", detailEls, "token:background", tr("push", "left"));

    const ctop = m + H * 0.14;
    const compare = slide("Pricing", [
      text({ x: m, y: m, w: W - 2 * m, h: H * 0.08 }, copy.compareTitle, heading({ fontSize: fs(0.05), fontWeight: 800 })),
      shape({ x: m, y: m + H * 0.09, w: W - 2 * m, h: rule }, "token:muted"),
      ...comparisonColumns(doc, { x: m, y: ctop, w: W - 2 * m, h: H - ctop - m }, copy, { card: "token:accent", highlight: "token:primary", onHighlight: "token:on-primary", radius: r }),
    ], "token:background", tr("push", "left"));

    const closing = slide("Closing", [
      text({ x: m, y: H * 0.36, w: W - 2 * m, h: H * 0.14 }, copy.closing, heading({ fontSize: fs(0.08), fontWeight: 800, color: "token:on-primary" })),
      text({ x: m, y: H * 0.52, w: W - 2 * m, h: H * 0.08 }, copy.closingLine, { fontSize: fs(0.026), color: "token:on-primary", lineHeight: 1.5 }),
      shape({ x: m, y: H - m - rule, w: W - 2 * m, h: rule }, "token:on-primary"),
    ], "token:primary", tr("fade", undefined, 700));

    return [cover, category, products, details, compare, closing];
  };
}

/** Bold: full-bleed color blocks, oversized type, strong contrast. */
function boldLayout(copy: TemplateCopy) {
  return (doc: CatalogDocument): CatalogSlide[] => {
    const { W, H, u, m, fs, land } = metrics(doc);
    const band = H * 0.08;

    const cover = slide("Cover", [
      shape({ x: 0, y: H - band, w: W, h: band }, "token:accent", {}, [anim("slide", 0, "right", 700)]),
      shape({ x: W - u * 0.62 - m * 0.5, y: land ? m * 0.5 : H * 0.08, w: u * 0.62, h: u * 0.62 }, "token:accent", { shape: "ellipse" }, [anim("scale", 200, undefined, 900)]),
      text({ x: m, y: m, w: W * 0.6, h: H * 0.05 }, copy.kicker.toUpperCase(), { fontSize: fs(0.02), letterSpacing: 4, fontWeight: 700, color: "token:on-primary" }, [anim("fade", 300)]),
      text({ x: m, y: H * 0.45, w: W - 2 * m, h: H * 0.3 }, doc.metadata.title.toUpperCase(), heading({ fontSize: fs(0.11), fontWeight: 800, lineHeight: 1, color: "token:on-primary" }), [anim("slide", 350, "up", 800)]),
      text({ x: m, y: H * 0.76, w: W - 2 * m, h: H * 0.08 }, doc.metadata.description ?? copy.categoryLine, { fontSize: fs(0.026), color: "token:on-primary" }, [anim("fade", 750)]),
    ], "token:primary");

    const split = land ? { x: 0, y: 0, w: W * 0.5, h: H } : { x: 0, y: 0, w: W, h: H * 0.5 };
    const rest = land ? { x: W * 0.5 + m, y: 0, w: W * 0.5 - 2 * m, h: H } : { x: m, y: H * 0.5, w: W - 2 * m, h: H * 0.5 };
    const category = slide("Category", [
      shape(split, "token:primary"),
      text({ x: split.x + m, y: split.y + split.h - m - split.h * 0.45, w: split.w - 2 * m, h: split.h * 0.45 }, "01", heading({ fontSize: fs(0.3), fontWeight: 800, lineHeight: 1, color: "token:on-primary" })),
      text({ x: rest.x, y: rest.y + rest.h * 0.32, w: rest.w, h: rest.h * 0.2 }, copy.categoryName.toUpperCase(), heading({ fontSize: fs(0.075), fontWeight: 800, lineHeight: 1 })),
      text({ x: rest.x, y: rest.y + rest.h * 0.55, w: rest.w, h: rest.h * 0.2 }, copy.categoryLine, { fontSize: fs(0.026), color: "token:muted", lineHeight: 1.5 }),
    ], "token:background", tr("wipe", "left", 700));

    const head = H * 0.18;
    const products = slide("Products", [
      shape({ x: 0, y: 0, w: W, h: head }, "token:primary"),
      text({ x: m, y: head * 0.3, w: W - 2 * m, h: head * 0.5 }, copy.productsTitle.toUpperCase(), heading({ fontSize: fs(0.055), fontWeight: 800, color: "token:on-primary" })),
      productGrid({ x: m, y: head + m * 0.8, w: W - 2 * m, h: H - head - m * 1.8 }, doc, land ? 3 : 2, "token:accent", 0),
    ], "token:background", tr("slide", "up"));

    const imgBox = land ? { x: 0, y: 0, w: W * 0.5, h: H } : { x: 0, y: 0, w: W, h: H * 0.5 };
    const infoBox = land ? { x: W * 0.5 + m, y: H * 0.18, w: W * 0.5 - 2 * m, h: H * 0.64 } : { x: m, y: H * 0.54, w: W - 2 * m, h: H * 0.42 };
    const details = slide("Product details", [
      ...detailBlock(doc, imgBox, infoBox, "token:primary", copy.detailsKicker),
      shape({ x: land ? W * 0.5 : 0, y: land ? H - band : H * 0.5 - band * 0.25, w: land ? W * 0.5 : W, h: band * 0.25 }, "token:accent"),
    ], "token:background", tr("zoom", undefined, 600));

    const ctop = head + m * 0.8;
    const compare = slide("Comparison", [
      shape({ x: 0, y: 0, w: W, h: head }, "token:primary"),
      text({ x: m, y: head * 0.3, w: W - 2 * m, h: head * 0.5 }, copy.compareTitle.toUpperCase(), heading({ fontSize: fs(0.055), fontWeight: 800, color: "token:on-primary" })),
      ...comparisonColumns(doc, { x: m, y: ctop, w: W - 2 * m, h: H - ctop - m }, copy, { card: "token:accent", highlight: "token:primary", onHighlight: "token:on-primary", radius: 0 }),
    ], "token:background", tr("slide", "up"));

    const closing = slide("Closing", [
      shape({ x: 0, y: 0, w: W, h: band }, "token:accent"),
      text({ x: m, y: H * 0.36, w: W - 2 * m, h: H * 0.18 }, copy.closing.toUpperCase(), heading({ fontSize: fs(0.11), fontWeight: 800, lineHeight: 1, color: "token:on-primary" })),
      text({ x: m, y: H * 0.58, w: W - 2 * m, h: H * 0.08 }, copy.closingLine, { fontSize: fs(0.026), color: "token:on-primary" }),
    ], "token:primary", tr("wipe", "up", 700));

    return [cover, category, products, details, compare, closing];
  };
}

const LAYOUTS: Record<TemplateLayout, (copy: TemplateCopy) => (doc: CatalogDocument) => CatalogSlide[]> = {
  editorial: editorialLayout,
  grid: gridLayout,
  bold: boldLayout,
};

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

type TemplateDef = Omit<CatalogTemplate, "build"> & { copy: TemplateCopy };

const DEFS: TemplateDef[] = [
  {
    id: "minimal", name: "Minimal", description: "Clean white pages with bold type, fits any product.", category: "general", layout: "grid",
    theme: { colors: { background: "#ffffff", text: "#111111", muted: "#6b7280", primary: "#111111", "on-primary": "#ffffff", accent: "#f3f4f6" }, fonts: { heading: "Inter", body: "Inter" } },
    copy: { kicker: "Product catalog", categoryName: "Collection", categoryLine: "A curated selection of our best products.", productsTitle: "Featured products", detailsKicker: "Highlight", compareTitle: "Choose your option", columns: ["Basic", "Standard", "Premium"], closing: "Thank you", closingLine: "Get in touch to place your order." },
  },
  {
    id: "studio", name: "Studio", description: "Confident violet color blocks for brands that want to stand out.", category: "general", layout: "bold",
    theme: { colors: { background: "#faf9ff", text: "#1e1b2e", muted: "#6e6a85", primary: "#4c3bcf", "on-primary": "#ffffff", accent: "#e4e0ff" }, fonts: { heading: "Sora", body: "Inter" } },
    copy: { kicker: "New season", categoryName: "Collection", categoryLine: "Everything you need, in one place.", productsTitle: "Our products", detailsKicker: "Spotlight", compareTitle: "Plans and pricing", columns: ["Starter", "Plus", "Pro"], closing: "Let's talk", closingLine: "We are ready when you are." },
  },
  {
    id: "dark-luxury", name: "Dark luxury", description: "Black and gold editorial pages for premium fashion.", category: "fashion", layout: "editorial",
    theme: { colors: { background: "#0b0b0c", text: "#f5f1e8", muted: "#a8a29e", primary: "#c9a24b", "on-primary": "#0b0b0c", accent: "#1c1917" }, fonts: { heading: "Playfair Display", body: "Inter" } },
    copy: { kicker: "The collection", categoryName: "Ready to wear", categoryLine: "Tailored silhouettes in noble fabrics.", productsTitle: "The pieces", detailsKicker: "Signature piece", compareTitle: "Find your fit", columns: ["Essential", "Signature", "Couture"], closing: "Merci", closingLine: "Visit our boutique or order online." },
  },
  {
    id: "atelier", name: "Atelier", description: "High-contrast lookbook with oversized type and a bold red accent.", category: "fashion", layout: "bold",
    theme: { colors: { background: "#ffffff", text: "#0a0a0a", muted: "#737373", primary: "#0a0a0a", "on-primary": "#ffffff", accent: "#e63946" }, fonts: { heading: "Bodoni Moda", body: "Jost" } },
    copy: { kicker: "Lookbook", categoryName: "New arrivals", categoryLine: "The looks defining this season.", productsTitle: "Shop the look", detailsKicker: "Look of the season", compareTitle: "Mix and match", columns: ["Day", "Evening", "Weekend"], closing: "See you soon", closingLine: "Follow us for the next drop." },
  },
  {
    id: "maison", name: "Maison", description: "Ivory, champagne and emerald for fine jewelry and watches.", category: "jewelry", layout: "editorial",
    theme: { colors: { background: "#fbf8f2", text: "#1f2a26", muted: "#8a8478", primary: "#0f5b46", "on-primary": "#fbf8f2", accent: "#efe6d2" }, fonts: { heading: "Cormorant Garamond", body: "Montserrat" } },
    copy: { kicker: "Fine jewelry", categoryName: "Timeless pieces", categoryLine: "Hand-finished in precious metals and stones.", productsTitle: "The collection", detailsKicker: "Masterpiece", compareTitle: "Choose your metal", columns: ["Silver", "Gold", "Platinum"], closing: "Made to last", closingLine: "Book a private appointment." },
  },
  {
    id: "tech", name: "Tech", description: "Cool blues on a clean grid for electronics and gadgets.", category: "electronics", layout: "grid",
    theme: { colors: { background: "#f8fafc", text: "#0f172a", muted: "#64748b", primary: "#2563eb", "on-primary": "#ffffff", accent: "#dbeafe" }, fonts: { heading: "Space Grotesk", body: "Inter" } },
    copy: { kicker: "Product line-up", categoryName: "Devices", categoryLine: "Smart, fast and built for everyday use.", productsTitle: "Line-up", detailsKicker: "Flagship", compareTitle: "Compare models", columns: ["Lite", "Standard", "Pro"], closing: "Upgrade today", closingLine: "Available now from our store and partners." },
  },
  {
    id: "natural", name: "Natural", description: "Warm earth tones and editorial pages for home and furniture.", category: "furniture", layout: "editorial",
    theme: { colors: { background: "#faf7f2", text: "#3f3a33", muted: "#8a8175", primary: "#6b7f5e", "on-primary": "#ffffff", accent: "#e9e1d3" }, fonts: { heading: "DM Serif Display", body: "Inter" } },
    copy: { kicker: "Home collection", categoryName: "Living room", categoryLine: "Natural materials, made to be lived with.", productsTitle: "Furniture", detailsKicker: "Designer's pick", compareTitle: "Choose your finish", columns: ["Oak", "Walnut", "Ash"], closing: "Welcome home", closingLine: "Visit our showroom or order online." },
  },
  {
    id: "glow", name: "Glow", description: "Soft blush and serif type for skincare and cosmetics.", category: "cosmetics", layout: "editorial",
    theme: { colors: { background: "#fff7f5", text: "#3b2a2c", muted: "#9b8487", primary: "#b85c6b", "on-primary": "#ffffff", accent: "#f8e1de" }, fonts: { heading: "Fraunces", body: "DM Sans" } },
    copy: { kicker: "Beauty ritual", categoryName: "Skincare", categoryLine: "Clean formulas for every skin type.", productsTitle: "The ritual", detailsKicker: "Bestseller", compareTitle: "Find your routine", columns: ["Cleanse", "Treat", "Hydrate"], closing: "Glow on", closingLine: "Discover the full range in store and online." },
  },
  {
    id: "harvest", name: "Harvest", description: "Appetising tomato red and cream color blocks for food and drinks.", category: "food", layout: "bold",
    theme: { colors: { background: "#fff8ee", text: "#2b1d14", muted: "#8b7464", primary: "#d9480f", "on-primary": "#fff8ee", accent: "#ffe3c2" }, fonts: { heading: "Archivo Black", body: "Work Sans" } },
    copy: { kicker: "Fresh menu", categoryName: "Specialities", categoryLine: "Made fresh with seasonal ingredients.", productsTitle: "On the menu", detailsKicker: "Chef's choice", compareTitle: "Pick your size", columns: ["Small", "Regular", "Family"], closing: "Bon appétit", closingLine: "Order now for pickup or delivery." },
  },
  {
    id: "estate", name: "Estate", description: "Navy and sand on a structured grid for property listings.", category: "real-estate", layout: "grid",
    theme: { colors: { background: "#fbfaf7", text: "#14213d", muted: "#6b7280", primary: "#14213d", "on-primary": "#fbfaf7", accent: "#ece4d4" }, fonts: { heading: "Libre Baskerville", body: "Manrope" } },
    copy: { kicker: "Property portfolio", categoryName: "Residences", categoryLine: "Selected homes in prime locations.", productsTitle: "Available properties", detailsKicker: "Featured listing", compareTitle: "Compare floor plans", columns: ["1 bedroom", "2 bedrooms", "Penthouse"], closing: "Book a viewing", closingLine: "Our agents are happy to show you around." },
  },
  {
    id: "forge", name: "Forge", description: "Charcoal and safety yellow for industrial products and tools.", category: "industrial", layout: "bold",
    theme: { colors: { background: "#f4f4f2", text: "#1c1c1c", muted: "#6b6b6b", primary: "#1f2124", "on-primary": "#ffc400", accent: "#ffc400" }, fonts: { heading: "Barlow Condensed", body: "Barlow" } },
    copy: { kicker: "Industrial catalog", categoryName: "Equipment", categoryLine: "Built for heavy-duty, everyday performance.", productsTitle: "Product range", detailsKicker: "Technical highlight", compareTitle: "Specifications", columns: ["Compact", "Standard", "Heavy duty"], closing: "Request a quote", closingLine: "Talk to our sales engineers." },
  },
  {
    id: "velocity", name: "Velocity", description: "Dark asphalt with racing red for vehicles and auto parts.", category: "automotive", layout: "bold",
    theme: { colors: { background: "#111214", text: "#f2f2f2", muted: "#9ca3af", primary: "#d00000", "on-primary": "#ffffff", accent: "#26282c" }, fonts: { heading: "Oswald", body: "Inter" } },
    copy: { kicker: "Model range", categoryName: "Line-up", categoryLine: "Performance, comfort and technology.", productsTitle: "The range", detailsKicker: "Featured model", compareTitle: "Choose your trim", columns: ["Base", "Sport", "Performance"], closing: "Take a test drive", closingLine: "Visit your nearest dealer." },
  },
];

export const TEMPLATES: CatalogTemplate[] = DEFS.map(({ copy, ...t }) => ({ ...t, build: LAYOUTS[t.layout](copy) }));

export function templatesFor(category: TemplateCategory): CatalogTemplate[] {
  return TEMPLATES.filter((t) => t.category === category);
}

const KEYWORDS: Record<Exclude<TemplateCategory, "general">, string[]> = {
  fashion: ["fashion", "clothing", "clothes", "apparel", "dress", "shirt", "t-shirt", "jacket", "coat", "shoe", "sneaker", "boot", "bag", "handbag", "lookbook", "wear", "garment", "denim", "jean", "outfit", "streetwear", "couture", "textile"],
  jewelry: ["jewelry", "jewellery", "jewel", "watch", "ring", "necklace", "bracelet", "earring", "diamond", "gold", "silver", "gem", "gemstone", "pendant", "pearl", "timepiece"],
  electronics: ["electronic", "electronics", "gadget", "phone", "smartphone", "laptop", "computer", "tablet", "headphone", "earbud", "speaker", "camera", "tv", "television", "console", "device", "tech", "software", "saas", "monitor", "drone", "wearable"],
  furniture: ["furniture", "sofa", "couch", "chair", "table", "desk", "bed", "lamp", "lighting", "interior", "decor", "home", "kitchen", "wardrobe", "shelf", "cabinet", "rug", "carpet", "mattress", "living room"],
  cosmetics: ["cosmetic", "cosmetics", "skincare", "skin care", "makeup", "make-up", "beauty", "serum", "cream", "lotion", "perfume", "fragrance", "lipstick", "haircare", "shampoo", "spa", "nail"],
  food: ["food", "beverage", "drink", "coffee", "tea", "wine", "beer", "juice", "restaurant", "menu", "bakery", "bread", "cake", "chocolate", "snack", "grocery", "organic", "cafe", "café", "catering", "pizza", "burger", "cheese", "spirit", "cocktail"],
  "real-estate": ["real estate", "real-estate", "property", "properties", "apartment", "flat", "house", "home for sale", "villa", "condo", "listing", "rental", "rent", "realtor", "realty", "estate", "office space", "penthouse", "residence", "residential"],
  industrial: ["industrial", "industry", "machine", "machinery", "drill", "tool", "equipment", "pump", "valve", "motor", "bearing", "hardware", "construction", "manufacturing", "factory", "steel", "pipe", "compressor", "generator", "welding", "safety", "b2b", "spare part"],
  automotive: ["car", "auto", "automotive", "vehicle", "truck", "motorcycle", "motorbike", "bike", "tire", "tyre", "wheel", "dealership", "dealer", "suv", "ev", "electric vehicle", "engine", "auto part", "car part"],
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const KEYWORD_RES = Object.entries(KEYWORDS).map(([category, words]) => ({
  category: category as TemplateCategory,
  // Match whole words with optional plural suffix, e.g. "car" matches "cars" but not "card".
  res: words.map((w) => ({ weight: w.includes(" ") ? 2 : 1, re: new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(w)}(s|es)?(?=$|[^\\p{L}\\p{N}])`, "iu") })),
}));

/** Best-matching template category for free text, or "general". */
export function pickCategory(hint: string): TemplateCategory {
  const text = hint.toLowerCase();
  if ((TEMPLATE_CATEGORIES as readonly string[]).includes(text.trim())) return text.trim() as TemplateCategory;
  let best: TemplateCategory = "general";
  let bestScore = 0;
  for (const { category, res } of KEYWORD_RES) {
    const score = res.reduce((s, { re, weight }) => (re.test(text) ? s + weight : s), 0);
    if (score > bestScore) { best = category; bestScore = score; }
  }
  return best;
}

/** Map free text ("luxury watches", "sofa catalog", "coffee") to the best template id. Defaults to "minimal". */
export function pickTemplate(hint: string): string {
  const trimmed = hint.trim().toLowerCase();
  const direct = TEMPLATES.find((t) => t.id === trimmed);
  if (direct) return direct.id;
  const category = pickCategory(trimmed);
  if (category === "general") {
    if (/\b(luxury|premium|exclusive|elegant)\b/.test(trimmed)) return "dark-luxury";
    return "minimal";
  }
  return templatesFor(category)[0]?.id ?? "minimal";
}

export function createFromTemplate(templateId: string, input: CreateCatalogInput): CatalogDocument {
  const template = TEMPLATES.find((t) => t.id === templateId);
  if (!template) throw new Error(`Unknown template "${templateId}"`);
  const doc = createCatalog(input);
  doc.theme = structuredClone(template.theme);
  doc.slides = template.build(doc);
  return doc;
}
