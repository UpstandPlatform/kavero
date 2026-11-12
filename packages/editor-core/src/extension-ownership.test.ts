import { expect, test } from "bun:test";
import { createCatalog, PRODUCTS_EXTENSION_ID } from "@Kavero/catalog-engine";

import { checkExtensionCommandOwnership, Editor, type EditorCommand } from "./index";

const pos = { x: 0, y: 0, width: 100, height: 50, rotation: 0 };
const OTHER = "com.example.other";

function setup() {
  const editor = new Editor(createCatalog({ title: "T" }), { coalesceMs: 0 });
  const slideId = editor.getState().activeSlideId;
  const [foreignId] = editor.execute({
    type: "element.add", slideId,
    element: { type: "extension", extensionId: OTHER, kind: "widget", content: {}, style: {}, position: pos } as never,
  }).createdIds;
  const [textId] = editor.execute({
    type: "element.add", slideId,
    element: { type: "text", position: pos, content: { paragraphs: [[{ text: "Hi" }]] }, effects: [{ id: "fx_1", extensionId: OTHER, effectId: "glow", type: "shader-effect", parameters: {} }] } as never,
  }).createdIds;
  return { editor, slideId, foreignId: foreignId!, textId: textId! };
}

test("extensions cannot touch elements or effects owned by another extension", () => {
  const { editor, slideId, foreignId, textId } = setup();
  const doc = editor.getDocument();
  const reject = (command: EditorCommand) => expect(() => checkExtensionCommandOwnership(doc, command, PRODUCTS_EXTENSION_ID)).toThrow("another extension");
  reject({ type: "element.delete", elementId: foreignId });
  reject({ type: "element.move", elementId: foreignId, position: { x: 10 } });
  reject({ type: "element.update", elementId: textId, changes: { effects: [] } });
  reject({ type: "batch", commands: [{ type: "slide.add" }, { type: "slide.delete", slideId }] });
  reject({ type: "batch", commands: [{ type: "element.add", slideId, element: { type: "extension", extensionId: OTHER, kind: "x", position: pos } as never }] });
  reject({ type: "element.add", slideId, element: { type: "shape", position: pos, content: { shape: "rect" }, effects: [{ id: "fx_2", extensionId: OTHER, effectId: "glow", type: "shader-effect", parameters: {} }] } as never });

  // The owner itself, and unrelated edits, are allowed.
  expect(() => checkExtensionCommandOwnership(doc, { type: "element.delete", elementId: foreignId }, OTHER)).not.toThrow();
  expect(() => checkExtensionCommandOwnership(doc, { type: "element.update", elementId: textId, changes: { opacity: 0.5 } }, PRODUCTS_EXTENSION_ID)).not.toThrow();
  expect(() => checkExtensionCommandOwnership(doc, { type: "element.add", slideId, element: { type: "extension", extensionId: PRODUCTS_EXTENSION_ID, kind: "card", content: {}, position: pos } as never }, PRODUCTS_EXTENSION_ID)).not.toThrow();
  // A dry run never changes the editor's document.
  expect(editor.getDocument()).toBe(doc);
});

test("history-less extension storage writes are not undone by undo/redo", () => {
  const { editor, foreignId } = setup();
  editor.execute({ type: "extension.install", extensionId: OTHER, version: "1.0.0", grantedCapabilities: [] }, { history: false });
  editor.execute({ type: "element.move", elementId: foreignId, position: { x: 25 } });
  editor.execute({ type: "extension.setData", extensionId: OTHER, key: "count", value: 3 }, { history: false });
  expect(editor.getState().canUndo).toBe(true);
  editor.undo(); // undoes the move only
  expect(editor.getDocument().extensions[OTHER]?.data.count).toBe(3);
  editor.undo();
  editor.undo();
  expect(editor.getDocument().extensions[OTHER]?.data.count).toBe(3);
  editor.redo();
  expect(editor.getDocument().extensions[OTHER]?.data.count).toBe(3);
  expect(() => editor.execute({ type: "element.delete", elementId: foreignId }, { history: false })).toThrow("history");
});
