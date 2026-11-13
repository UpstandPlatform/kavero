import { expect, test } from "bun:test";
import { catalogElementSchema, createFromTemplate } from "@Kavero/catalog-engine";
import { exportPptx, toHex } from "./index";

test("toHex", () => {
  expect(toHex("#abc")).toBe("AABBCC");
  expect(toHex("rgb(255, 0, 16)")).toBe("FF0010");
  expect(toHex("nonsense", "123456")).toBe("123456");
});

test("exports editable slides with warnings", async () => {
  const doc = createFromTemplate("tech", { title: "Deck", page: "16:9" });
  doc.products.push({ id: "p1", name: "Phone X", price: 999, imageAssetIds: [], attributes: {} });
  const grid = doc.slides[2]!.elements.find((e) => e.type === "product-grid")!;
  if (grid.type === "product-grid") grid.content.products = [{ productId: "p1" }];
  doc.slides[0]!.elements.push(catalogElementSchema.parse({
    id: "h", type: "html", position: { x: 0, y: 0, width: 300, height: 100 }, content: { html: "<p>Hello <b>web</b></p>" },
  }));
  doc.slides[0]!.elements[0]!.effects.push({
    id: "fx_1", extensionId: "com.kavero.prism-glow", effectId: "prism-glow", type: "shader-effect", parameters: { intensity: 0.32 },
  });

  const { data, warnings } = await exportPptx<Uint8Array>(doc, { assets: {}, outputType: "uint8array" });
  expect(data.byteLength).toBeGreaterThan(10_000);
  // .pptx is a zip; slide XML is deflated, so check the zip directory for 4 slides.
  const names = new TextDecoder("latin1").decode(data);
  expect(names.match(/ppt\/slides\/slide\d+\.xml/g)?.filter((v, i, a) => a.indexOf(v) === i).length).toBe(doc.slides.length);
  expect(warnings.some((w) => w.includes("HTML blocks"))).toBe(true);
  expect(warnings.some((w) => w.includes("transitions"))).toBe(true);
  expect(warnings.some((w) => w.includes("Shader fills and effects"))).toBe(true);
});

test("RTL text detection", async () => {
  const { textIsRtl } = await import("./index");
  expect(textIsRtl("شیر توپی پی‌وی‌سی (UPVC)", false)).toBe(true);
  expect(textIsRtl("UPVC شیر", true)).toBe(false);
  expect(textIsRtl("۰۹۱۲ ۰۵۶ ۱۸۱۰", true)).toBe(true);
  expect(textIsRtl("123", false)).toBe(false);
});

test("product cards export the new product fields", async () => {
  const doc = createFromTemplate("tech", { title: "Deck", page: "16:9" });
  doc.products.push({
    id: "p1", name: "Phone X", subtitle: "Pro camera", brand: "Acme", price: 899, compareAtPrice: 999, unit: "/ unit", badge: "Sale",
    availability: "limited", rating: 4.5, sku: "PX-1", url: "https://example.com/x", imageAssetIds: [], attributes: { Storage: "256 GB" },
  });
  const grid = doc.slides[2]!.elements.find((e) => e.type === "product-grid")!;
  if (grid.type === "product-grid") {
    grid.content.products = [{ productId: "p1" }];
    Object.assign(grid.style, { showAttributes: true, showSku: true, showLink: true });
  }
  const { data } = await exportPptx<Uint8Array>(doc, { assets: {}, outputType: "uint8array" });
  expect(data.byteLength).toBeGreaterThan(10_000);
});

/** Read one file from a zip (local headers; JSZip writes sizes there). */
function readZipEntry(zip: Uint8Array, name: string): string | null {
  const { inflateRawSync } = require("node:zlib") as typeof import("node:zlib");
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let offset = 0; offset + 30 < zip.length && view.getUint32(offset, true) === 0x04034b50;) {
    const method = view.getUint16(offset + 8, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const fileName = new TextDecoder().decode(zip.subarray(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extraLength;
    const body = zip.subarray(start, start + size);
    if (fileName === name) return new TextDecoder().decode(method === 8 ? inflateRawSync(body) : body);
    offset = start + size;
  }
  return null;
}

test("markdown becomes formatted text and tables become native PowerPoint tables", async () => {
  const doc = createFromTemplate("tech", { title: "Deck", page: "16:9" });
  const slide = doc.slides[0]!;
  slide.elements = [
    catalogElementSchema.parse({ id: "md", type: "markdown", position: { x: 0, y: 0, width: 800, height: 400 }, content: { markdown: "# Heading\n\n- **bold** item\n1. first\n- [x] task\n\n| a | b |\n|---|---|\n| 1 | 2 |" } }),
    catalogElementSchema.parse({
      id: "tb", type: "table", position: { x: 0, y: 500, width: 800, height: 300 },
      content: { columns: [{ id: "a", label: "Item" }, { id: "b", label: "Price", align: "end", format: "currency" }], rows: [["Pen", "1.5"], ["Book", "12"]] },
    }),
  ];
  const { data, warnings } = await exportPptx<Uint8Array>(doc, { assets: {}, outputType: "uint8array" });
  const xml = readZipEntry(data, "ppt/slides/slide1.xml");
  expect(xml).not.toBeNull();
  expect(xml).toContain("<a:tbl>");
  expect(xml).toContain("Item");
  expect(xml).toContain("$1.50");
  expect(xml).toContain("Heading");
  expect(xml).toContain("buAutoNum");
  expect(xml).toContain("☑");
  expect(warnings.some((w) => w.includes("Tables inside markdown"))).toBe(true);
});

test("paths export as native custom geometry", async () => {
  const { pathToPptxPoints } = await import("./index");
  const points = pathToPptxPoints([{ x: 0, y: 0, out: { x: 0.5, y: 0 } }, { x: 1, y: 1 }, { x: 0, y: 1 }], true, 2, 1);
  expect(points).toEqual([
    { x: 0, y: 0, moveTo: true },
    { x: 2, y: 1, curve: { type: "cubic", x1: 1, y1: 0, x2: 2, y2: 1 } },
    { x: 0, y: 1 },
    { x: 0, y: 0 },
    { close: true },
  ]);
  const doc = createFromTemplate("tech", { title: "Paths", page: "16:9" });
  doc.slides[0]!.elements.push(catalogElementSchema.parse({
    id: "path1", type: "path", position: { x: 100, y: 100, width: 300, height: 200 },
    content: { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, style: { fill: "token:accent", dash: [6, 4] },
    animations: [{ id: "draw1", category: "entrance", preset: "draw" }],
  }));
  const { data } = await exportPptx<Uint8Array>(doc, { assets: {}, outputType: "uint8array" });
  expect(data.byteLength).toBeGreaterThan(10_000);
});

test("video export embeds MP4 media and GIF assets", async () => {
  const doc = createFromTemplate("tech", { title: "Media deck", page: "16:9" });
  doc.assets.push(
    { id: "generated-video", kind: "video", mimeType: "video/mp4", name: "Generated video", uri: "local://generated-video" },
    { id: "video-cover", kind: "image", mimeType: "image/png", name: "Video cover", uri: "local://video-cover" },
    { id: "animated-gif", kind: "image", mimeType: "image/gif", name: "Animated GIF", uri: "local://animated-gif" },
  );
  doc.slides[0]!.elements.push(
    catalogElementSchema.parse({
      id: "media-video", type: "video", content: { assetId: "generated-video", posterAssetId: "video-cover" },
      position: { x: 100, y: 100, width: 500, height: 280 },
    }),
    catalogElementSchema.parse({
      id: "media-gif", type: "image", content: { assetId: "animated-gif", alt: "Animated GIF" },
      position: { x: 650, y: 100, width: 300, height: 200 },
    }),
  );

  const { data, warnings } = await exportPptx<Uint8Array>(doc, {
    assets: {
      "generated-video": "data:video/mp4;base64,AAAAHGZ0eXBpc29tAAABAGlzb20=",
      "video-cover": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ9sAAAAASUVORK5CYII=",
      "animated-gif": "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    },
    outputType: "uint8array",
  });
  const zipDirectory = new TextDecoder("latin1").decode(data);
  expect(zipDirectory).toContain(".mp4");
  expect(zipDirectory).toContain(".gif");
  expect(warnings.some((warning) => warning.includes("video is missing"))).toBe(false);
});
