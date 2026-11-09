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

  const { data, warnings } = await exportPptx<Uint8Array>(doc, { assets: {}, outputType: "uint8array" });
  expect(data.byteLength).toBeGreaterThan(10_000);
  // .pptx is a zip; slide XML is deflated, so check the zip directory for 4 slides.
  const names = new TextDecoder("latin1").decode(data);
  expect(names.match(/ppt\/slides\/slide\d+\.xml/g)?.filter((v, i, a) => a.indexOf(v) === i).length).toBe(4);
  expect(warnings.some((w) => w.includes("HTML blocks"))).toBe(true);
  expect(warnings.some((w) => w.includes("transitions"))).toBe(true);
});
