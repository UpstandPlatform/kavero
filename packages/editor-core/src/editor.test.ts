import { expect, test } from "bun:test";
import { createCatalog } from "@Kavero/catalog-engine";
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
