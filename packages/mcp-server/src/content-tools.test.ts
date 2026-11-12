import { expect, test } from "bun:test";
import { createCatalog, type TableElement } from "@Kavero/catalog-engine";
import { applyCommand } from "@Kavero/editor-core";

import {
  contentElementOutline,
  contentElementText,
  markdownAddCommand,
  markdownAddInput,
  markdownUpdateInput,
  tableAddCommand,
  tableAddInput,
  tableContentFromInput,
  tableUpdateCommands,
  tableUpdateInput,
} from "./content-tools";

const page = { width: 1920, height: 1080 };

test("markdown tool input is validated", () => {
  expect(markdownAddInput.safeParse({ catalogId: "c", slideId: "s", markdown: "# Hi" }).success).toBe(true);
  expect(markdownAddInput.safeParse({ catalogId: "c", slideId: "s", markdown: "" }).success).toBe(false);
  expect(markdownAddInput.safeParse({ catalogId: "c", slideId: "s", markdown: "x".repeat(20_001) }).success).toBe(false);
  expect(markdownAddInput.safeParse({ catalogId: "c", slideId: "s", markdown: "x", style: { baseFontSize: 1 } }).success).toBe(false);
  expect(markdownUpdateInput.safeParse({ catalogId: "c", elementId: "e" }).success).toBe(false);
  expect(markdownUpdateInput.safeParse({ catalogId: "c", elementId: "e", style: { color: "token:primary" } }).success).toBe(true);
});

test("table tool input is validated", () => {
  expect(tableAddInput.safeParse({ catalogId: "c", slideId: "s", columns: ["A"], rows: [["1"]] }).success).toBe(true);
  expect(tableAddInput.safeParse({ catalogId: "c", slideId: "s", csv: "a,b\n1,2" }).success).toBe(true);
  // Exactly one of columns or csv.
  expect(tableAddInput.safeParse({ catalogId: "c", slideId: "s" }).success).toBe(false);
  expect(tableAddInput.safeParse({ catalogId: "c", slideId: "s", columns: ["A"], csv: "a" }).success).toBe(false);
  expect(tableAddInput.safeParse({ catalogId: "c", slideId: "s", columns: [] }).success).toBe(false);
  expect(tableAddInput.safeParse({ catalogId: "c", slideId: "s", columns: Array.from({ length: 51 }, () => "c") }).success).toBe(false);
  expect(tableAddInput.safeParse({ catalogId: "c", slideId: "s", columns: [{ label: "A", format: "money" }] }).success).toBe(false);
  expect(tableUpdateInput.safeParse({ catalogId: "c", elementId: "e", ops: [] }).success).toBe(false);
  expect(tableUpdateInput.safeParse({ catalogId: "c", elementId: "e", ops: [{ op: "explode" }] }).success).toBe(false);
  expect(tableUpdateInput.safeParse({ catalogId: "c", elementId: "e", ops: [{ op: "setCell", row: -1, column: 0, value: "x" }] }).success).toBe(false);
  const parsed = tableUpdateInput.parse({ catalogId: "c", elementId: "e", ops: [{ op: "setCell", row: 0, column: 0, value: 12.5 }] });
  expect(parsed.ops?.[0]).toEqual({ op: "setCell", row: 0, column: 0, value: "12.5" });
});

test("table content from rows (numbers become text) or CSV", () => {
  const fromRows = tableContentFromInput({ columns: ["Item", { label: "Price", align: "end", format: "currency" }], rows: [["Pen", 1.5 as never]] });
  expect(fromRows.columns.map((column) => column.label)).toEqual(["Item", "Price"]);
  expect(fromRows.columns[1]).toMatchObject({ align: "end", format: "currency" });
  const fromCsv = tableContentFromInput({ csv: "a;b\n1;2\n" });
  expect(fromCsv.columns.map((column) => column.label)).toEqual(["a", "b"]);
  expect(fromCsv.rows).toEqual([["1", "2"]]);
  expect(() => tableContentFromInput({ columns: ["A"], rows: [["1", "2"]] })).toThrow();
  expect(() => tableContentFromInput({ csv: "" })).toThrow("no data");
});

test("commands add, edit and outline markdown and table elements", () => {
  const doc = createCatalog({ title: "T" });
  const slideId = doc.slides[0]!.id;
  const [markdownId] = applyCommand(doc, markdownAddCommand(markdownAddInput.parse({ catalogId: "c", slideId, markdown: "# Plan\n\n- one" }), page)).createdIds;
  const [tableId] = applyCommand(doc, tableAddCommand(tableAddInput.parse({ catalogId: "c", slideId, columns: ["Name", "Qty"], rows: [["Pen", 2]] }), page)).createdIds;
  for (const command of tableUpdateCommands(tableUpdateInput.parse({
    catalogId: "c", elementId: tableId!, ops: [{ op: "insertRows", index: 1, values: [["Book", "3"]] }, { op: "updateColumn", column: 1, changes: { format: "number" } }], style: { zebra: false },
  }))) applyCommand(doc, command);

  const markdown = doc.slides[0]!.elements.find((element) => element.id === markdownId)!;
  const table = doc.slides[0]!.elements.find((element) => element.id === tableId) as TableElement;
  expect(table.content.rows).toEqual([["Pen", "2"], ["Book", "3"]]);
  expect(table.style.zebra).toBe(false);
  expect(table.position.width).toBe(1536);
  expect(contentElementText(markdown)).toBe("Plan\n• one");
  expect(contentElementOutline(markdown)).toMatchObject({ title: "Plan" });
  expect(contentElementText(table)).toBe("Name | Qty\nPen | 2\nBook | 3");
  expect(contentElementOutline(table)).toEqual({ columns: ["Name", "Qty"], rows: 2, header: true });
});
