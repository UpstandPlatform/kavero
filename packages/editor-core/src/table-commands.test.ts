import { expect, test } from "bun:test";
import { createCatalog, createTableContent, type TableElement } from "@Kavero/catalog-engine";
import { Editor } from "./index";

const position = { x: 0, y: 0, width: 600, height: 300, rotation: 0 };

function setup() {
  const editor = new Editor(createCatalog({ title: "T" }), { coalesceMs: 0 });
  const slideId = editor.getState().activeSlideId;
  const [id] = editor.execute({
    type: "element.add", slideId,
    element: { type: "table", position, content: createTableContent([["Name", "Qty"], ["Pen", "2"]]) } as never,
  }).createdIds;
  const table = () => editor.getDocument().slides[0]!.elements.find((element) => element.id === id) as TableElement;
  return { editor, id: id!, table };
}

test("table.edit sets cells and is undoable", () => {
  const { editor, id, table } = setup();
  editor.execute({ type: "table.edit", elementId: id, ops: [{ op: "setCell", row: 0, column: 1, value: "5" }] });
  expect(table().content.rows[0]).toEqual(["Pen", "5"]);
  editor.undo();
  expect(table().content.rows[0]).toEqual(["Pen", "2"]);
  editor.redo();
  expect(table().content.rows[0]).toEqual(["Pen", "5"]);
});

test("table.edit adds and removes rows and columns", () => {
  const { editor, id, table } = setup();
  editor.execute({ type: "table.edit", elementId: id, ops: [{ op: "insertRows", index: 1, count: 2 }, { op: "insertColumns", index: 2, labels: ["Price"] }] });
  expect(table().content.rows).toEqual([["Pen", "2", ""], ["", "", ""], ["", "", ""]]);
  expect(table().content.columns.map((column) => column.label)).toEqual(["Name", "Qty", "Price"]);
  editor.execute({ type: "table.edit", elementId: id, ops: [{ op: "deleteRows", index: 1, count: 2 }, { op: "deleteColumns", index: 0 }] });
  expect(table().content.rows).toEqual([["2", ""]]);
  editor.undo();
  expect(table().content.rows).toHaveLength(3);
  editor.undo();
  expect(table().content.columns).toHaveLength(2);
});

test("invalid table edits leave the document unchanged", () => {
  const { editor, id } = setup();
  const before = editor.getDocument();
  expect(() => editor.execute({ type: "table.edit", elementId: id, ops: [{ op: "setCell", row: 5, column: 0, value: "x" }] })).toThrow();
  expect(() => editor.execute({ type: "table.edit", elementId: id, ops: [{ op: "setCell", row: 0, column: 0, value: "x".repeat(5_000) }] })).toThrow();
  expect(editor.getDocument()).toBe(before);
  const slideId = editor.getState().activeSlideId;
  const [textId] = editor.execute({ type: "element.add", slideId, element: { type: "text", position, content: { paragraphs: [[{ text: "Hi" }]] } } as never }).createdIds;
  expect(() => editor.execute({ type: "table.edit", elementId: textId!, ops: [{ op: "setHeader", header: false }] })).toThrow("Only table elements");
});

test("element.update keeps table rows aligned with columns", () => {
  const { editor, id, table } = setup();
  editor.execute({ type: "element.update", elementId: id, changes: { content: { rows: [["Only one"]] }, style: { zebra: false } } });
  expect(table().content.rows).toEqual([["Only one", ""]]);
  expect(table().style.zebra).toBe(false);
});
