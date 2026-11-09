import { expect, test } from "bun:test";
import { checkExportCompatibility, createCatalog, duplicateCatalog, parseCatalogDocument } from "./index";

test("createCatalog produces a valid document", () => {
  const doc = createCatalog({ title: "Summer 2027", page: "a4-portrait" });
  const res = parseCatalogDocument(JSON.parse(JSON.stringify(doc)));
  expect(res.ok).toBe(true);
  expect(doc.slides).toHaveLength(1);
});

test("rejects duplicate ids and future versions", () => {
  const doc = createCatalog({ title: "X" });
  doc.slides.push({ ...doc.slides[0]! });
  expect(parseCatalogDocument(doc).ok).toBe(false);
  expect(parseCatalogDocument({ ...createCatalog({ title: "Y" }), schemaVersion: 99 }).ok).toBe(false);
});

test("warns on missing assets and PDF animations", () => {
  const doc = createCatalog({ title: "X" });
  doc.slides[0]!.elements.push({
    id: "el_1", type: "image", position: { x: 0, y: 0, width: 10, height: 10, rotation: 0 },
    zIndex: 0, locked: false, hidden: false, opacity: 1, content: { assetId: "nope", alt: "" },
    style: { fit: "cover", borderRadius: 0 },
    animations: [{ id: "a1", category: "entrance", preset: "fade", trigger: "on-enter", startMs: 0, durationMs: 500, delayMs: 0, easing: "ease-out" }],
  });
  const res = parseCatalogDocument(doc);
  expect(res.ok && res.warnings.length).toBe(1);
  expect(checkExportCompatibility(doc, "pdf")).toHaveLength(1);
});

test("duplicateCatalog gives fresh ids", () => {
  const doc = createCatalog({ title: "X" });
  const copy = duplicateCatalog(doc);
  expect(copy.id).not.toBe(doc.id);
  expect(copy.slides[0]!.id).not.toBe(doc.slides[0]!.id);
});

test("every template produces a valid document", async () => {
  const { TEMPLATES, createFromTemplate } = await import("./templates");
  for (const t of TEMPLATES) {
    for (const page of ["a4-portrait", "16:9"] as const) {
      const doc = createFromTemplate(t.id, { title: "T", page });
      const res = parseCatalogDocument(JSON.parse(JSON.stringify(doc)));
      if (!res.ok) console.error(t.id, page, res.issues);
      expect(res.ok).toBe(true);
      expect(res.ok && res.warnings).toEqual([]);
      expect(doc.slides.length).toBeGreaterThanOrEqual(6);
      // Ids unique across slides, elements and animations
      const ids = doc.slides.flatMap((s) => [s.id, ...s.elements.flatMap((e) => [e.id, ...e.animations.map((a) => a.id)])]);
      expect(new Set(ids).size).toBe(ids.length);
      // Non-first slides have transitions; cover has entrance animations
      expect(doc.slides.slice(1).every((s) => s.transition && s.transition.type !== "none")).toBe(true);
      expect(doc.slides[0]!.elements.some((e) => e.animations.length > 0)).toBe(true);
      // Everything stays on the page
      for (const s of doc.slides) for (const e of s.elements) {
        expect(Math.min(e.position.x, e.position.y)).toBeGreaterThanOrEqual(0);
        expect(e.position.x + e.position.width).toBeLessThanOrEqual(doc.settings.width + 1);
        expect(e.position.y + e.position.height).toBeLessThanOrEqual(doc.settings.height + 1);
      }
    }
  }
});

test("templates use products when the document has them", async () => {
  const { TEMPLATES } = await import("./templates");
  for (const t of TEMPLATES) {
    const doc = createCatalog({ title: "P", page: "16:9" });
    doc.theme = structuredClone(t.theme);
    doc.products = [1, 2, 3, 4].map((i) => ({ id: `prd_${i}`, name: `Product ${i}`, price: i * 10, imageAssetIds: [], attributes: {} }));
    doc.slides = t.build(doc);
    const res = parseCatalogDocument(JSON.parse(JSON.stringify(doc)));
    expect(res.ok && res.warnings).toEqual([]);
    const els = doc.slides.flatMap((s) => s.elements);
    expect(els.filter((e) => e.type === "product").length).toBeGreaterThanOrEqual(4);
    expect(els.some((e) => e.type === "product-grid" && e.content.products.length > 0)).toBe(true);
  }
});

test("template catalog covers every category and layout family", async () => {
  const { TEMPLATES, TEMPLATE_CATEGORIES, templatesFor } = await import("./templates");
  for (const c of TEMPLATE_CATEGORIES) expect(templatesFor(c).length).toBeGreaterThanOrEqual(1);
  for (const id of ["minimal", "dark-luxury", "tech", "natural"]) expect(TEMPLATES.some((t) => t.id === id)).toBe(true);
  expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
  expect(new Set(TEMPLATES.map((t) => t.layout)).size).toBeGreaterThanOrEqual(3);
  for (const t of TEMPLATES) {
    for (const k of ["background", "text", "muted", "primary", "on-primary", "accent"]) expect(t.theme.colors[k]).toBeTruthy();
    expect(t.theme.fonts.heading && t.theme.fonts.body).toBeTruthy();
  }
});

test("pickTemplate maps free text to a fitting template", async () => {
  const { TEMPLATES, pickTemplate } = await import("./templates");
  const cases: Record<string, string> = {
    "luxury watches": "jewelry", "sofa catalog": "furniture", skincare: "cosmetics", cars: "automotive",
    "apartment listings": "real-estate", "drill machines": "industrial", coffee: "food",
    "summer dresses": "fashion", "wireless headphones": "electronics", "something else": "general",
  };
  for (const [hint, category] of Object.entries(cases)) {
    const t = TEMPLATES.find((x) => x.id === pickTemplate(hint));
    expect(`${hint} -> ${t?.category}`).toBe(`${hint} -> ${category}`);
  }
  expect(pickTemplate("something else")).toBe("minimal");
  expect(pickTemplate("credit cards")).toBe("minimal"); // "car" must not match "cards"
  expect(pickTemplate("tech")).toBe("tech");
});

test("html elements are sanitized", async () => {
  const { sanitizeHtml, sanitizeCss, catalogElementSchema } = await import("./index");
  const dirty = `<div onclick="x()" style="color:red;background:url(javascript:alert(1))">Hi<script>alert(1)</script>
    <a href="javascript:alert(1)">a</a><a href="https://ok.com">b</a><img src=x onerror=alert(1)><iframe src="//evil"></iframe></div>`;
  const clean = sanitizeHtml(dirty);
  expect(clean).not.toMatch(/script|onclick|onerror|javascript|iframe/i);
  expect(clean).toContain('href="https://ok.com"');
  expect(clean).toContain("color:red");
  expect(sanitizeCss("@import url(https://x.com/a.css); .a{color:blue}")).toBe(" .a{color:blue}");
  const el = catalogElementSchema.parse({ id: "e", type: "html", position: { x: 0, y: 0, width: 1, height: 1 }, content: { html: "<b onmouseover=x>ok</b>" } });
  expect(el.type === "html" && el.content.html).toBe("<b>ok</b>");
});
