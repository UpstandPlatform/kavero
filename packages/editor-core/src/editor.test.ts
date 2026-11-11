import { expect, test } from "bun:test";
import { createBlockSlide, createCatalog, PRESENTATION_BLOCKS } from "@Kavero/catalog-engine";
import { Editor } from "./index";

const pos = { x: 0, y: 0, width: 100, height: 50, rotation: 0 };

function setup() {
  const editor = new Editor(createCatalog({ title: "T" }), { coalesceMs: 0 });
  const slideId = editor.getState().activeSlideId;
  const [elId] = editor.execute({
    type: "element.add", slideId,
    element: { type: "text", position: pos, content: { paragraphs: [[{ text: "Hi" }]] } } as never,
  }).createdIds;
  return { editor, slideId, elId: elId! };
}

test("add, update, undo, redo", () => {
  const { editor, elId } = setup();
  editor.execute({ type: "element.update", elementId: elId, changes: { style: { fontSize: 48 } } });
  const size = () => { const e = editor.getDocument().slides[0]!.elements[0]!; return e.type === "text" ? e.style.fontSize : -1; };
  expect(size()).toBe(48);
  editor.undo();
  expect(size()).toBe(24);
  editor.redo();
  expect(size()).toBe(48);
  expect(editor.getState().dirty).toBe(true);
});

test("invalid command leaves document untouched", () => {
  const { editor, elId } = setup();
  const before = editor.getDocument();
  expect(() => editor.execute({ type: "element.update", elementId: elId, changes: { opacity: 5 } })).toThrow();
  expect(editor.getDocument()).toBe(before);
});

test("hydrates extension state for catalogs saved before extension support", () => {
  const legacy = createCatalog({ title: "Legacy" });
  delete (legacy as unknown as { extensions?: unknown }).extensions;

  const editor = new Editor(legacy);
  expect(editor.getDocument().extensions).toEqual({});
  expect(() => editor.execute({ type: "catalog.updateMetadata", changes: { title: "Migrated" } })).not.toThrow();
});

test("rapid moves coalesce into one undo step", () => {
  const editor = new Editor(createCatalog({ title: "T" }), { coalesceMs: 10_000 });
  const slideId = editor.getState().activeSlideId;
  const [id] = editor.execute({ type: "element.add", slideId, element: { type: "shape", position: pos, content: { shape: "rect" } } as never }).createdIds;
  for (let x = 1; x <= 5; x++) editor.execute({ type: "element.move", elementId: id!, position: { x } });
  editor.undo();
  expect(editor.getDocument().slides[0]!.elements[0]!.position.x).toBe(0);
});

test("slide ops and transitions", () => {
  const { editor, slideId } = setup();
  const [s2] = editor.execute({ type: "slide.duplicate", slideId }).createdIds;
  // Duplicates morph by default, and their elements remember the originals.
  const dup = editor.getDocument().slides.find((s) => s.id === s2)!;
  const orig = editor.getDocument().slides.find((s) => s.id === slideId)!;
  expect(dup.transition).toMatchObject({ type: "morph", durationMs: 900 });
  expect(dup.elements.map((e) => e.morphKey)).toEqual(orig.elements.map((e) => e.morphKey ?? e.id));
  editor.execute({ type: "slide.setTransition", slideId: s2!, transition: { type: "fade", durationMs: 500 } });
  editor.execute({ type: "slide.move", slideId: s2!, toIndex: 0 });
  expect(editor.getDocument().slides[0]!.transition).toMatchObject({ type: "fade", durationMs: 500 });
  editor.execute({ type: "slide.delete", slideId });
  expect(() => editor.execute({ type: "slide.delete", slideId: s2! })).toThrow();
});

test("slide.add repairs missing and duplicate built-in block element ids", () => {
  for (const block of PRESENTATION_BLOCKS) {
    const editor = new Editor(createCatalog({ title: "Blocks" }), { coalesceMs: 0 });
    const slide = createBlockSlide(block.id, block.name, 1920, 1080);
    for (const element of slide.elements) (element as { id: string }).id = "";

    const result = editor.execute({ type: "slide.add", slide } as never);
    const inserted = editor.getDocument().slides.find((item) => item.id === result.createdIds[0]);
    const ids = inserted?.elements.map((element) => element.id) ?? [];

    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.createdIds.slice(1)).toEqual(ids);
  }
});

test("products and assets", () => {
  const { editor, slideId } = setup();
  const [pid] = editor.execute({ type: "product.upsert", product: { name: "Chair", price: 120 } }).createdIds;
  editor.execute({ type: "element.add", slideId, element: { type: "product", position: pos, content: { productId: pid! } } as never });
  expect(() => editor.execute({ type: "product.delete", productId: pid! })).toThrow("still placed");
  editor.execute({ type: "product.upsert", product: { id: pid, name: "Arm chair" } });
  expect(editor.getDocument().products[0]).toMatchObject({ name: "Arm chair", price: 120 });
  editor.execute({ type: "asset.add", asset: { id: "ast_x", kind: "image", mimeType: "image/png", name: "x", uri: "local://ast_x" } });
  expect(editor.getDocument().assets).toHaveLength(1);
});

test("product fields, duplicate and delete from slides with undo", () => {
  const { editor, slideId } = setup();
  const [pid] = editor.execute({ type: "product.upsert", product: { name: "Lamp", price: 80, compareAtPrice: 100, badge: "Sale", availability: "in-stock", rating: 4, attributes: { Height: "40 cm" } } }).createdIds;
  expect(() => editor.execute({ type: "product.upsert", product: { id: pid, name: "Lamp", rating: 7 } })).toThrow();
  // Clearing an optional field on edit.
  editor.execute({ type: "product.upsert", product: { id: pid, name: "Lamp", badge: undefined } });
  expect(editor.getDocument().products[0]!.badge).toBeUndefined();
  const [copy] = editor.execute({ type: "product.duplicate", productId: pid! }).createdIds;
  expect(editor.getDocument().products.map((p) => p.name)).toEqual(["Lamp", "Lamp (copy)"]);
  expect(editor.getDocument().products[1]).toMatchObject({ price: 80, attributes: { Height: "40 cm" } });
  const [card] = editor.execute({ type: "element.add", slideId, element: { type: "product", position: pos, content: { productId: pid! } } as never }).createdIds;
  const [grid] = editor.execute({ type: "element.add", slideId, element: { type: "product-grid", position: pos, content: { products: [{ productId: pid! }, { productId: copy! }] } } as never }).createdIds;
  editor.execute({ type: "product.delete", productId: pid!, removeFromSlides: true });
  const els = editor.getDocument().slides[0]!.elements;
  expect(els.find((e) => e.id === card)).toBeUndefined();
  const g = els.find((e) => e.id === grid);
  expect(g?.type === "product-grid" && g.content.products).toEqual([{ productId: copy! }]);
  expect(editor.getDocument().products.map((p) => p.id)).toEqual([copy!]);
  editor.undo();
  expect(editor.getDocument().products).toHaveLength(2);
  expect(editor.getDocument().slides[0]!.elements.some((e) => e.id === card)).toBe(true);
});

test("setZ moves an element to an exact layer", () => {
  const editor = new Editor(createCatalog({ title: "T" }), { coalesceMs: 0 });
  const slideId = editor.getState().activeSlideId;
  const ids = [0, 1, 2].map(() => editor.execute({ type: "element.add", slideId, element: { type: "shape", position: pos, content: { shape: "rect" } } as never }).createdIds[0]!);
  editor.execute({ type: "element.setZ", elementId: ids[2]!, index: 0 });
  const order = [...editor.getDocument().slides[0]!.elements].sort((a, b) => a.zIndex - b.zIndex).map((e) => e.id);
  expect(order).toEqual([ids[2]!, ids[0]!, ids[1]!]);
});

test("element.move rejects non-finite positions and clamps sizes", () => {
  const { editor, elId } = setup();
  const before = editor.getDocument();
  expect(() => editor.execute({ type: "element.move", elementId: elId, position: { x: Number.NaN } })).toThrow("finite");
  expect(() => editor.execute({ type: "element.move", elementId: elId, position: { width: Number.POSITIVE_INFINITY } })).toThrow("finite");
  expect(() => editor.execute({ type: "element.move", elementId: elId, position: { rotation: Number.NaN } })).toThrow("finite");
  expect(editor.getDocument()).toBe(before);
  editor.execute({ type: "element.move", elementId: elId, position: { x: 5, width: 0, height: -3 } });
  expect(editor.getDocument().slides[0]!.elements[0]!.position).toMatchObject({ x: 5, width: 1, height: 1 });
});

test("rebase numbers the next revision after a newer stored copy and stays dirty", () => {
  const { editor } = setup();
  editor.markSaved();
  editor.execute({ type: "catalog.updateMetadata", changes: { title: "Mine" } });
  const stored = editor.getDocument().revision + 10;
  editor.rebase(stored);
  const rev = editor.getDocument().revision;
  expect(rev).toBe(stored + 1);
  expect(editor.getState().dirty).toBe(true);
  editor.rebase(rev - 5);
  expect(editor.getDocument().revision).toBe(rev);
});
