import { createCatalog, createId, type CreateCatalogInput } from "./document";
import { catalogElementSchema, type CatalogDocument, type CatalogElement, type CatalogSlide } from "./schema";

export interface CatalogTemplate {
  id: string;
  name: string;
  description: string;
  category: "general" | "fashion" | "electronics" | "furniture";
  theme: CatalogDocument["theme"];
  build: (doc: CatalogDocument) => CatalogSlide[];
}

const text = (x: number, y: number, w: number, h: number, value: string, style: Record<string, unknown> = {}): CatalogElement =>
  catalogElementSchema.parse({
    id: createId("el"), type: "text", position: { x, y, width: w, height: h, rotation: 0 },
    content: { paragraphs: [[{ text: value }]] }, style,
  });

const rect = (x: number, y: number, w: number, h: number, fill: string): CatalogElement =>
  catalogElementSchema.parse({ id: createId("el"), type: "shape", position: { x, y, width: w, height: h, rotation: 0 }, content: { shape: "rect" }, style: { fill } });

const slide = (name: string, elements: CatalogElement[], background = "token:background"): CatalogSlide => ({
  id: createId("sld"), name, background: { kind: "color", color: background }, elements,
  transition: { type: "fade", durationMs: 500, delayMs: 0, easing: "ease-in-out" },
});

/** Positions are proportional so templates fit any page size. */
function standardSlides(doc: CatalogDocument): CatalogSlide[] {
  const { width: W, height: H } = doc.settings;
  const m = Math.round(Math.min(W, H) * 0.07);
  const title = doc.metadata.title;
  return [
    slide("Cover", [
      text(m, H * 0.38, W - 2 * m, H * 0.16, title, { fontSize: Math.round(H * 0.09), fontWeight: 700, fontFamily: "token:heading" }),
      text(m, H * 0.56, W - 2 * m, H * 0.08, doc.metadata.description ?? "Collection", { fontSize: Math.round(H * 0.035), color: "token:muted" }),
    ]),
    slide("Category", [
      rect(0, 0, W * 0.4, H, "token:accent"),
      text(W * 0.4 + m, H * 0.42, W * 0.6 - 2 * m, H * 0.14, "Category name", { fontSize: Math.round(H * 0.07), fontWeight: 700, fontFamily: "token:heading" }),
    ]),
    slide("Products", [
      text(m, m, W - 2 * m, H * 0.1, "Featured products", { fontSize: Math.round(H * 0.05), fontWeight: 700, fontFamily: "token:heading" }),
      catalogElementSchema.parse({
        id: createId("el"), type: "product-grid", position: { x: m, y: m + H * 0.14, width: W - 2 * m, height: H - 2 * m - H * 0.14, rotation: 0 },
        content: { products: [], columns: W > H ? 3 : 2 },
      }),
    ]),
    slide("Closing", [
      text(m, H * 0.42, W - 2 * m, H * 0.12, "Thank you", { fontSize: Math.round(H * 0.08), fontWeight: 700, align: "center", color: "token:on-primary", fontFamily: "token:heading" }),
    ], "token:primary"),
  ];
}

export const TEMPLATES: CatalogTemplate[] = [
  {
    id: "minimal", name: "Minimal", description: "Clean white pages with bold type.", category: "general",
    theme: { colors: { background: "#ffffff", text: "#111111", muted: "#6b7280", primary: "#111111", "on-primary": "#ffffff", accent: "#f3f4f6" }, fonts: { heading: "Inter", body: "Inter" } },
    build: standardSlides,
  },
  {
    id: "dark-luxury", name: "Dark luxury", description: "Black and gold, for premium products.", category: "fashion",
    theme: { colors: { background: "#0b0b0c", text: "#f5f1e8", muted: "#a8a29e", primary: "#c9a24b", "on-primary": "#0b0b0c", accent: "#1c1917" }, fonts: { heading: "Playfair Display", body: "Inter" } },
    build: standardSlides,
  },
  {
    id: "tech", name: "Tech", description: "Cool blues for electronics and gadgets.", category: "electronics",
    theme: { colors: { background: "#f8fafc", text: "#0f172a", muted: "#64748b", primary: "#2563eb", "on-primary": "#ffffff", accent: "#dbeafe" }, fonts: { heading: "Space Grotesk", body: "Inter" } },
    build: standardSlides,
  },
  {
    id: "natural", name: "Natural", description: "Warm earth tones for home and furniture.", category: "furniture",
    theme: { colors: { background: "#faf7f2", text: "#3f3a33", muted: "#8a8175", primary: "#6b7f5e", "on-primary": "#ffffff", accent: "#e9e1d3" }, fonts: { heading: "DM Serif Display", body: "Inter" } },
    build: standardSlides,
  },
];

export function createFromTemplate(templateId: string, input: CreateCatalogInput): CatalogDocument {
  const template = TEMPLATES.find((t) => t.id === templateId);
  if (!template) throw new Error(`Unknown template "${templateId}"`);
  const doc = createCatalog(input);
  doc.theme = structuredClone(template.theme);
  doc.slides = template.build(doc);
  return doc;
}
