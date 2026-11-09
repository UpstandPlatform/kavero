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
    const res = parseCatalogDocument(createFromTemplate(t.id, { title: "T", page: "a4-portrait" }));
    expect(res.ok).toBe(true);
  }
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
