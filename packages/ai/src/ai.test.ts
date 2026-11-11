import { expect, test } from "bun:test";
import { createCatalog, parseCatalogDocument, type Product } from "@Kavero/catalog-engine";

import { AiError, MockProvider, generateCatalog, proposeEdit, providerFromEnv } from "./index";

const products: Product[] = [
  { id: "p1", name: "Weekender Bag", price: 640, currency: "EUR", category: "Bags", imageAssetIds: [], attributes: {} },
  { id: "p2", name: "Tote", price: 320, category: "Bags", imageAssetIds: [], attributes: {} },
  { id: "p3", name: "Card Holder", price: 85, category: "Small leather goods", imageAssetIds: [], attributes: {} },
  { id: "p4", name: "Belt", price: 120, category: "Accessories", imageAssetIds: [], attributes: {} },
];

test("offline planner builds a valid, editable catalog", async () => {
  const r = await generateCatalog(null, { brief: "Autumn leather goods catalog for our boutique", products, page: "16:9" });
  expect(r.source).toBe("offline");
  expect(parseCatalogDocument(r.document).ok).toBe(true);
  const kinds = r.plan.sections.map((s) => s.kind);
  expect(kinds[0]).toBe("cover");
  expect(kinds.at(-1)).toBe("closing");
  expect(kinds.filter((k) => k === "category")).toHaveLength(3);
  // Every product appears somewhere.
  const shown = new Set(r.plan.sections.flatMap((s) => s.productIds ?? []));
  for (const p of products) expect(shown.has(p.id)).toBe(true);
  expect(r.document.slides.every((s) => s.elements.length > 0)).toBe(true);
});

test("offline planner works with no products and in portrait", async () => {
  const r = await generateCatalog(null, { brief: "", products: [], page: "a4-portrait" });
  expect(parseCatalogDocument(r.document).ok).toBe(true);
  expect(r.document.settings.height).toBeGreaterThan(r.document.settings.width);
});

test("AI plan is normalised: unknown products dropped, big grids split, cover/closing added", async () => {
  const mock = new MockProvider([{
    title: "Leather 2027",
    templateId: "does-not-exist",
    sections: [
      { kind: "products", heading: "All", productIds: ["p1", "p2", "p3", "p4", "p1", "p2", "p3", "ghost"] },
      { kind: "product-detail", heading: "Ghost", productIds: ["ghost"] },
    ],
  }]);
  const r = await generateCatalog(mock, { brief: "luxury leather", products, language: "en" });
  expect(r.source).toBe("ai");
  const kinds = r.plan.sections.map((s) => s.kind);
  expect(kinds).toEqual(["cover", "products", "products", "closing"]);
  expect(r.plan.sections.flatMap((s) => s.productIds ?? [])).not.toContain("ghost");
  expect(parseCatalogDocument(r.document).ok).toBe(true);
  expect(mock.calls[0]!.prompt).toContain("p1 | Weekender Bag | Bags | 640 EUR");
});

test("AI edits become validated commands; invalid ops are skipped", async () => {
  const doc = createCatalog({ title: "T" });
  const slideId = doc.slides[0]!.id;
  const mock = new MockProvider([{
    summary: "Add a tagline and darken the background",
    ops: [
      { op: "add_text", text: "Made by hand", x: 100, y: 600, width: 800, height: 80, fontSize: 40 },
      { op: "set_background", color: "#111111" },
      { op: "delete_element", elementId: "does-not-exist" },
      { op: "set_theme_color", themeColor: "primary", color: "not-a-color" },
      { op: "add_slide", name: "Contact" },
      { op: "add_text", slideId: "Contact", text: "hello@shop.test", x: 100, y: 100, width: 600, height: 60 },
    ],
  }]);
  const r = await proposeEdit(mock, doc, slideId, "make it moodier");
  expect(r.commands.map((c) => c.type)).toEqual(["element.add", "slide.update", "slide.add", "element.add"]);
  expect(r.skipped).toHaveLength(2);
  expect(r.summary).toContain("tagline");
});

test("AI edit planning rejects incompatible targets and omits no-op changes", async () => {
  const doc = createCatalog({ title: "T" });
  const slide = doc.slides[0]!;

  const mock = new MockProvider([{
    summary: "Try a few changes",
    ops: [
      { op: "set_fill", elementId: "missing-element", color: "#111111" },
      { op: "set_text", elementId: "missing-element", text: "Hello" },
      { op: "set_theme_color", themeColor: "primary", color: doc.theme.colors.primary },
    ],
  }]);

  const result = await proposeEdit(mock, doc, slide.id, "try a few changes");
  expect(result.commands).toHaveLength(0);
  expect(result.skipped).toHaveLength(3);
  expect(result.skipped.join(" ")).toContain("element not found");
  expect(result.skipped.join(" ")).toContain("would not change the catalog");
});

test("editing without a provider is a clear error", async () => {
  const doc = createCatalog({ title: "T" });
  await expect(proposeEdit(null, doc, doc.slides[0]!.id, "x")).rejects.toBeInstanceOf(AiError);
});

test("provider selection from env", () => {
  expect(providerFromEnv({})).toBeNull();
  expect(providerFromEnv({ ANTHROPIC_API_KEY: "k" })?.model).toBe("claude-opus-5-5");
  expect(providerFromEnv({ AI_BASE_URL: "http://localhost:11434/v1", AI_MODEL: "llama3.2" })?.id).toBe("openai-compatible");
  expect(providerFromEnv({ AI_PROVIDER: "none", ANTHROPIC_API_KEY: "k" })).toBeNull();
});
