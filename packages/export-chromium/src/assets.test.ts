import { expect, test } from "bun:test";
import { PDFDocument } from "pdf-lib";

import { createAssetStore } from "./assets";
import { mergePdfs } from "./pdf";

test("asset store decodes data URLs once and serves them from a private path", () => {
  const png = Buffer.from([137, 80, 78, 71]);
  const store = createAssetStore({ a: `data:image/png;base64,${png.toString("base64")}`, b: "https://example.com/x.jpg", "c d": "data:image/svg+xml,%3Csvg%2F%3E" }, "http://localhost:3001/render");
  expect(store.urls.a).toStartWith(`http://localhost:3001${store.prefix}`);
  expect(store.urls.b).toBe("https://example.com/x.jpg");
  const a = store.files.get(store.urls.a!.slice(`http://localhost:3001${store.prefix}`.length))!;
  expect(a.contentType).toBe("image/png");
  expect([...a.body]).toEqual([...png]);
  const c = store.files.get(encodeURIComponent("c d"))!;
  expect(c.body.toString()).toBe("<svg/>");
  // A new random prefix per export, so one export can't read another's files.
  expect(createAssetStore({}, "http://x").prefix).not.toBe(store.prefix);
});

test("mergePdfs keeps every page in order", async () => {
  const part = async (n: number, w: number) => {
    const d = await PDFDocument.create();
    for (let i = 0; i < n; i++) d.addPage([w + i, 100]);
    return d.save();
  };
  const merged = await PDFDocument.load(await mergePdfs([await part(2, 200), await part(3, 300)]));
  expect(merged.getPages().map((p) => p.getWidth())).toEqual([200, 201, 300, 301, 302]);
});
