import { expect, test } from "bun:test";
import { cardDisplay, catalogElementSchema, checkExportCompatibility, createCatalog, discountPercent, duplicateCatalog, formatMoney, matchesProduct, parseCatalogDocument, productSchema, productUsage } from "./index";

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
    effects: [],
  });
  const res = parseCatalogDocument(doc);
  expect(res.ok && res.warnings.length).toBe(1);
  expect(checkExportCompatibility(doc, "pdf")).toHaveLength(1);
});

test("shader effects are bounded references, default safely for older catalogs and warn for PowerPoint", () => {
  const doc = createCatalog({ title: "Effects" });
  doc.slides[0]!.elements.push(catalogElementSchema.parse({
    id: "el_shader", type: "shape", position: { x: 0, y: 0, width: 100, height: 100 },
    content: { shape: "rect" }, style: { fill: "#fff" },
  }));
  doc.slides[0]!.elements[0]!.effects.push({
    id: "fx_1", extensionId: "com.kavero.aurora-fill", effectId: "aurora-fill", type: "shader-fill", parameters: { intensity: 0.32 },
  });
  expect(parseCatalogDocument(doc).ok).toBe(true);
  expect(checkExportCompatibility(doc, "pptx").some((issue) => issue.message.includes("Shader fills"))).toBe(true);

  const legacy = JSON.parse(JSON.stringify(doc)) as { slides: { elements: Record<string, unknown>[] }[] };
  delete legacy.slides[0]!.elements[0]!.effects;
  const parsed = parseCatalogDocument(legacy);
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.document.slides[0]!.elements[0]!.effects).toEqual([]);
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

test("sanitizer is not fooled by nested tags", async () => {
  const { sanitizeHtml } = await import("./index");
  expect(sanitizeHtml("<scr<script>ipt>alert(1)</scr</script>ipt>")).not.toMatch(/<script/i);
  expect(sanitizeHtml('<ifr<iframe>ame src="//evil"></iframe>')).not.toMatch(/<iframe/i);
  expect(sanitizeHtml("<scr<scr<script>ipt>ipt>x")).not.toMatch(/<script/i);
});

test("URL fields only accept safe schemes; page size and slide count are bounded", async () => {
  const { catalogElementSchema, catalogDocumentSchema, createCatalog } = await import("./index");
  const pos = { x: 0, y: 0, width: 1, height: 1 };
  const button = (href: string) => catalogElementSchema.safeParse({ id: "b", type: "button", position: pos, content: { label: "x", href } }).success;
  expect(button("https://shop.test")).toBe(true);
  expect(button("tel:+15551234")).toBe(true);
  expect(button("javascript:alert(1)")).toBe(false);
  const video = (url: string) => catalogElementSchema.safeParse({ id: "v", type: "video", position: pos, content: { url } }).success;
  expect(video("https://cdn.test/a.mp4")).toBe(true);
  expect(video("http://169.254.169.254/latest")).toBe(false);
  expect(video("file:///etc/passwd")).toBe(false);
  const doc = createCatalog({ title: "T" });
  expect(catalogDocumentSchema.safeParse(doc).success).toBe(true);
  expect(catalogDocumentSchema.safeParse({ ...doc, slides: [] }).success).toBe(false);
  expect(catalogDocumentSchema.safeParse({ ...doc, settings: { ...doc.settings, width: 100_000 } }).success).toBe(false);
});

test("private address detection covers embedded IPv4 forms", async () => {
  const { isPrivateAddress, isLoopbackAddress } = await import("./index");
  for (const ip of ["127.0.0.1", "10.0.0.1", "100.64.0.1", "169.254.169.254", "192.168.1.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:10.0.0.1", "::ffff:a00:1", "::ffff:7f00:1", "::a00:1", "64:ff9b::a00:1", "64:ff9b::169.254.169.254", "2002:a00:1::1",
    "fd00::1", "fe80::1%eth0", "ff02::1", "2001:db8::1", "2001::1", "not-an-ip"]) expect(`${ip}: ${isPrivateAddress(ip)}`).toBe(`${ip}: true`);
  for (const ip of ["8.8.8.8", "172.32.0.1", "2606:4700::1", "::ffff:8.8.8.8", "64:ff9b::808:808", "2002:808:808::1"]) expect(`${ip}: ${isPrivateAddress(ip)}`).toBe(`${ip}: false`);
  expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
  expect(isLoopbackAddress("::1")).toBe(true);
  expect(isLoopbackAddress("64:ff9b::7f00:1")).toBe(false);
});

test("file names keep non-Latin titles", async () => {
  const { safeFileName, attachmentHeader } = await import("./index");
  expect(safeFileName("کاتالوگ محصولات آبان گستر البرز", "pdf")).toBe("کاتالوگ-محصولات-آبان-گستر-البرز.pdf");
  expect(safeFileName("Summer / 2027!", ".kavero")).toBe("summer-2027.kavero");
  expect(safeFileName("???", "pdf")).toBe("catalog.pdf");
  expect(attachmentHeader("کاتالوگ.pdf")).toContain("filename*=UTF-8''%DA%A9");
});

test("products accept the optional card fields and old products stay valid", () => {
  const doc = createCatalog({ title: "Shop" });
  doc.products.push({ id: "p_old", name: "Old chair", imageAssetIds: [], attributes: {} });
  doc.products.push(productSchema.parse({
    id: "p_new", name: "Lamp", subtitle: "Warm light", brand: "Lumo", price: 80, compareAtPrice: 100, currency: "EUR", unit: "/ piece",
    badge: "Sale", availability: "pre-order", rating: 4.5, tags: ["lighting"], url: "https://example.com/lamp", attributes: { Height: "40 cm", Bulb: "E27" },
  }));
  const res = parseCatalogDocument(JSON.parse(JSON.stringify(doc)));
  expect(res.ok).toBe(true);
  if (res.ok) {
    expect(res.document.products[0]).toEqual({ id: "p_old", name: "Old chair", imageAssetIds: [], attributes: {} });
    expect(Object.keys(res.document.products[1]!.attributes)).toEqual(["Height", "Bulb"]);
  }
  expect(productSchema.safeParse({ id: "x", name: "X", rating: 6 }).success).toBe(false);
  expect(productSchema.safeParse({ id: "x", name: "X", availability: "maybe" }).success).toBe(false);
  expect(productSchema.safeParse({ id: "x", name: "X", compareAtPrice: -1 }).success).toBe(false);
});

test("product validation warnings, usage and helpers", () => {
  const doc = createCatalog({ title: "Shop" });
  doc.products.push(productSchema.parse({ id: "p1", name: "Desk", price: 120, compareAtPrice: 100, imageAssetIds: ["missing"] }));
  const pos = { x: 0, y: 0, width: 10, height: 10, rotation: 0 };
  const base = { zIndex: 0, locked: false, hidden: false, opacity: 1, animations: [], effects: [], position: pos };
  doc.slides[0]!.elements.push(
    { ...base, id: "el_a", type: "product", content: { productId: "p1" }, style: { layout: "vertical", showPrice: true, showDescription: true, borderRadius: 8, imageFit: "contain", showAttributes: false } },
    { ...base, id: "el_b", type: "product-grid", content: { columns: 2, products: [{ productId: "p1" }] }, style: { layout: "vertical", showPrice: true, showDescription: true, borderRadius: 8, imageFit: "contain", showAttributes: false, gap: 16 } },
  );
  const res = parseCatalogDocument(doc);
  expect(res.ok && res.warnings.map((w) => w.path).sort()).toEqual(["products.0.compareAtPrice", "products.0.imageAssetIds.0"]);
  expect(productUsage(doc, "p1").map((u) => [u.slideIndex, u.elementId, u.elementType])).toEqual([[0, "el_a", "product"], [0, "el_b", "product-grid"]]);
  expect(productUsage(doc, "nope")).toEqual([]);
  expect(discountPercent({ price: 75, compareAtPrice: 100 })).toBe(25);
  expect(discountPercent({ price: 120, compareAtPrice: 100 })).toBeNull();
  expect(formatMoney(undefined, "USD", "en")).toBeNull();
  expect(formatMoney(5, "USD", "en")).toBe("$5.00");
  expect(matchesProduct(productSchema.parse({ id: "a", name: "Oak table", sku: "T-1", tags: ["wood"] }), "WOOD")).toBe(true);
});

test("card display defaults keep existing cards unchanged", () => {
  const d = cardDisplay({ showPrice: false, showDescription: true, showAttributes: true });
  expect(d).toMatchObject({ showPrice: false, showDescription: true, showAttributes: true, showImage: true, showName: true, showSku: false, showLink: false, maxAttributes: 8 });
});
