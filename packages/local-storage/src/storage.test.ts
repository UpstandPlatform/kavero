import { expect, test } from "bun:test";
import { createCatalog } from "@Kavero/catalog-engine";
import { MemoryCatalogRepository, exportProjectFile, importProjectFile } from "./index";

function catalogWithImage() {
  const doc = createCatalog({ title: "Shoes" });
  doc.assets.push({ id: "ast_1", kind: "image", mimeType: "image/png", name: "a.png", uri: "local://ast_1" });
  doc.slides[0]!.elements.push({
    id: "el_1", type: "image", position: { x: 0, y: 0, width: 10, height: 10, rotation: 0 }, zIndex: 0,
    locked: false, hidden: false, opacity: 1, animations: [], content: { assetId: "ast_1", alt: "" }, style: { fit: "cover", borderRadius: 0 },
  });
  return doc;
}

test("save, list, delete", async () => {
  const repo = new MemoryCatalogRepository();
  const doc = createCatalog({ title: "A" });
  await repo.save(doc);
  expect((await repo.list())[0]?.title).toBe("A");
  await repo.delete(doc.id);
  expect(await repo.list()).toHaveLength(0);
});

test("save rejects invalid documents", async () => {
  const repo = new MemoryCatalogRepository();
  const doc = createCatalog({ title: "A" });
  doc.metadata.title = "";
  expect(repo.save(doc)).rejects.toThrow();
});

test(".kavero round trip, and re-import becomes a copy with remapped assets", async () => {
  const repo = new MemoryCatalogRepository();
  const doc = catalogWithImage();
  await repo.save(doc);
  await repo.putAsset({ id: "ast_1", catalogId: doc.id, hash: "h", blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }) });
  const file = await exportProjectFile(repo, doc.id);

  const fresh = new MemoryCatalogRepository();
  const a = await importProjectFile(fresh, file);
  expect(a.document.id).toBe(doc.id);
  expect(new Uint8Array(await (await fresh.getAsset("ast_1"))!.blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));

  const b = await importProjectFile(repo, file);
  expect(b.document.id).not.toBe(doc.id);
  const el = b.document.slides[0]!.elements[0]!;
  const newAssetId = b.document.assets[0]!.id;
  expect(newAssetId).not.toBe("ast_1");
  expect(el.type === "image" && el.content.assetId).toBe(newAssetId);
  expect(await repo.getAsset(newAssetId)).not.toBeNull();
});

test("rejects non-kavero files", async () => {
  expect(importProjectFile(new MemoryCatalogRepository(), "{\"hello\":1}")).rejects.toThrow("not a Kavero project");
});
