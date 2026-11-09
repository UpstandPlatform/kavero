import {
  catalogElementSchema,
  createFromTemplate,
  createId,
  parseCatalogDocument,
  type CatalogDocument,
  type CatalogElement,
  type CatalogSlide,
  type PagePreset,
  type Product,
} from "@Kavero/catalog-engine";

import type { CatalogPlan, PlanSection } from "./plan";

export interface BuildOptions {
  products: Product[];
  page?: PagePreset | { width: number; height: number };
  language?: string;
  currency?: string;
  description?: string;
}

type Box = { x: number; y: number; width: number; height: number };

function el(type: CatalogElement["type"], box: Box, rest: Record<string, unknown>): CatalogElement {
  return catalogElementSchema.parse({ id: createId("el"), type, position: { ...box, rotation: 0 }, ...rest });
}
const text = (box: Box, value: string, style: Record<string, unknown>, animations: unknown[] = []) =>
  el("text", box, { content: { paragraphs: value.split("\n").map((line) => [{ text: line }]) }, style, animations });
const rect = (box: Box, fill: string, radius = 0) => el("shape", box, { content: { shape: "rect" }, style: { fill, borderRadius: radius } });
const fadeUp = (delayMs: number) => ({ id: createId("anim"), category: "entrance", preset: "slide", direction: "up", trigger: "on-enter", startMs: delayMs, durationMs: 700, delayMs: 0, easing: "ease-out" });

/** Deterministic layouts for each plan section; proportional so any page size works. */
function layoutSection(s: PlanSection, doc: CatalogDocument, index: number): CatalogSlide {
  const { width: W, height: H } = doc.settings;
  const portrait = H > W;
  const m = Math.round(Math.min(W, H) * 0.07);
  const hSize = Math.round(Math.min(W, H) * 0.075);
  const bSize = Math.max(14, Math.round(Math.min(W, H) * 0.026));
  const heading = (box: Box, size = hSize, extra: Record<string, unknown> = {}, anim: unknown[] = []) =>
    text(box, s.heading, { fontFamily: "token:heading", fontSize: size, fontWeight: 700, lineHeight: 1.1, ...extra }, anim);
  const body = (box: Box, extra: Record<string, unknown> = {}) => (s.body ? [text(box, s.body, { fontSize: bSize, color: "token:muted", lineHeight: 1.45, ...extra })] : []);
  const ids = s.productIds ?? [];
  const elements: CatalogElement[] = [];
  let background = "token:background";

  switch (s.kind) {
    case "cover":
      elements.push(rect({ x: 0, y: 0, width: Math.round(W * 0.012), height: H }, "token:primary"));
      elements.push(heading({ x: m, y: H * 0.36, width: W - 2 * m, height: hSize * 2.6 }, Math.round(hSize * 1.35), {}, [fadeUp(150)]));
      if (s.body) elements.push(text({ x: m, y: H * 0.36 + hSize * 2.8, width: W * 0.7, height: bSize * 4 }, s.body, { fontSize: Math.round(bSize * 1.3), color: "token:muted" }, [fadeUp(450)]));
      break;
    case "intro":
      elements.push(heading({ x: m, y: m, width: W - 2 * m, height: hSize * 1.4 }));
      elements.push(...body({ x: m, y: m + hSize * 1.8, width: portrait ? W - 2 * m : W * 0.6, height: H - 2 * m - hSize * 1.8 }, { color: "token:text", fontSize: Math.round(bSize * 1.15) }));
      break;
    case "category":
      if (portrait) elements.push(rect({ x: 0, y: 0, width: W, height: H * 0.45 }, "token:accent"));
      else elements.push(rect({ x: 0, y: 0, width: W * 0.4, height: H }, "token:accent"));
      elements.push(heading(portrait ? { x: m, y: H * 0.55, width: W - 2 * m, height: hSize * 2.4 } : { x: W * 0.4 + m, y: H * 0.38, width: W * 0.6 - 2 * m, height: hSize * 2.4 }, Math.round(hSize * 1.1), {}, [fadeUp(100)]));
      elements.push(...body(portrait ? { x: m, y: H * 0.55 + hSize * 2.6, width: W - 2 * m, height: bSize * 3 } : { x: W * 0.4 + m, y: H * 0.38 + hSize * 2.6, width: W * 0.6 - 2 * m, height: bSize * 3 }));
      break;
    case "products": {
      elements.push(heading({ x: m, y: m, width: W - 2 * m, height: hSize * 1.3 }, Math.round(hSize * 0.75)));
      const cols = ids.length <= 2 ? Math.max(1, ids.length) : portrait ? 2 : 3;
      elements.push(el("product-grid", { x: m, y: m + hSize * 1.6, width: W - 2 * m, height: H - 2 * m - hSize * 1.6 }, { content: { columns: cols, products: ids.map((productId) => ({ productId })) }, style: { gap: Math.round(m * 0.5) } }));
      break;
    }
    case "product-detail": {
      const half = portrait ? { x: m, y: m, width: W - 2 * m, height: H * 0.5 } : { x: m, y: m, width: W * 0.45, height: H - 2 * m };
      elements.push(el("product", half, { content: { productId: ids[0] }, style: { showDescription: false, showPrice: false } }));
      const col = portrait ? { x: m, y: H * 0.5 + m * 1.5, width: W - 2 * m } : { x: W * 0.45 + m * 2, y: H * 0.25, width: W * 0.55 - m * 3 };
      elements.push(heading({ ...col, height: hSize * 2.4 }, Math.round(hSize * 0.95), {}, [fadeUp(150)]));
      const product = doc.products.find((p) => p.id === ids[0]);
      const price = product?.price !== undefined ? new Intl.NumberFormat(doc.metadata.language, { style: "currency", currency: product.currency ?? doc.metadata.currency }).format(product.price) : null;
      if (s.body) elements.push(text({ ...col, y: col.y + hSize * 2.6, height: bSize * 6 }, s.body, { fontSize: bSize, color: "token:muted", lineHeight: 1.45 }));
      if (price) elements.push(text({ ...col, y: col.y + hSize * 2.6 + (s.body ? bSize * 7 : 0), height: hSize }, price, { fontSize: Math.round(hSize * 0.6), fontWeight: 700, color: "token:primary" }));
      break;
    }
    case "comparison": {
      elements.push(heading({ x: m, y: m, width: W - 2 * m, height: hSize * 1.3 }, Math.round(hSize * 0.75)));
      const n = Math.max(1, Math.min(3, ids.length));
      const gap = m * 0.6;
      const cw = (W - 2 * m - gap * (n - 1)) / n;
      ids.slice(0, 3).forEach((id, i) => {
        const box = { x: m + i * (cw + gap), y: m + hSize * 1.7, width: cw, height: H - 2 * m - hSize * 1.7 };
        elements.push(rect(box, "token:accent", 12));
        elements.push(el("product", { x: box.x + gap * 0.5, y: box.y + gap * 0.5, width: box.width - gap, height: box.height - gap }, { content: { productId: id }, animations: [fadeUp(150 + i * 150)] }));
      });
      break;
    }
    case "closing":
      background = "token:primary";
      elements.push(heading({ x: m, y: H * 0.38, width: W - 2 * m, height: hSize * 1.6 }, Math.round(hSize * 1.1), { align: "center", color: "token:on-primary" }, [fadeUp(100)]));
      elements.push(...body({ x: m, y: H * 0.38 + hSize * 1.9, width: W - 2 * m, height: bSize * 3 }, { align: "center", color: "token:on-primary" }));
      break;
  }

  return {
    id: createId("sld"),
    name: s.heading.slice(0, 60) || s.kind,
    background: { kind: "color", color: background },
    elements: elements.map((e, z) => ({ ...e, zIndex: z })),
    transition: index === 0 ? undefined : { type: s.kind === "category" ? "push" : "fade", durationMs: 600, delayMs: 0, easing: "ease-in-out", direction: "left" },
  };
}

/** Turn a plan into a validated, fully editable catalog document. */
export function buildCatalog(plan: CatalogPlan, opts: BuildOptions): CatalogDocument {
  const doc = createFromTemplate(plan.templateId, {
    title: plan.title,
    description: plan.subtitle ?? opts.description,
    page: opts.page ?? "16:9",
    language: opts.language,
    currency: opts.currency,
  });
  doc.products = structuredClone(opts.products);
  doc.slides = plan.sections.map((s, i) => layoutSection(i === 0 && !s.body && plan.subtitle ? { ...s, body: plan.subtitle } : s, doc, i));
  const res = parseCatalogDocument(doc);
  if (!res.ok) throw new Error(`Generated catalog failed validation: ${res.issues.slice(0, 3).map((i) => `${i.path} ${i.message}`).join("; ")}`);
  return res.document;
}
