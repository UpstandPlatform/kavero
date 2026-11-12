import { expect, test } from "bun:test";
import * as XLSX from "xlsx";
import {
  MAX_MARKDOWN_CHARACTERS,
  TABLE_LIMITS,
  applyTableOps,
  catalogElementSchema,
  checkGrid,
  createEmptyTable,
  createTableContent,
  detectDelimiter,
  formatTableCell,
  markdownTitle,
  markdownToPlainText,
  normalizeGrid,
  parseClipboardTable,
  parseDelimited,
  parseMarkdownBlocks,
  parseMarkdownInline,
  readSpreadsheet,
  tableContentSchema,
  tableFileKind,
  type SheetJsModule,
} from "./index";

const position = { x: 0, y: 0, width: 400, height: 300, rotation: 0 };

// ---- Schema ----

test("markdown element applies style defaults and caps its source", () => {
  const el = catalogElementSchema.parse({ id: "m", type: "markdown", position, content: { markdown: "# Hi" } });
  expect(el.type).toBe("markdown");
  if (el.type !== "markdown") return;
  expect(el.style).toMatchObject({ fontFamily: "token:body", headingFontFamily: "token:heading", color: "token:text", linkColor: "token:primary", align: "start", direction: "auto" });
  expect(() => catalogElementSchema.parse({ id: "m", type: "markdown", position, content: { markdown: "x".repeat(MAX_MARKDOWN_CHARACTERS + 1) } })).toThrow();
  expect(() => catalogElementSchema.parse({ id: "m", type: "markdown", position, content: {} })).toThrow();
});

test("table element pads short rows, rejects long rows and duplicate column ids", () => {
  const el = catalogElementSchema.parse({
    id: "t", type: "table", position,
    content: { columns: [{ id: "a", label: "A" }, { id: "b", label: "B" }], rows: [["1"], ["2", "3"]] },
  });
  if (el.type !== "table") throw new Error("expected table");
  expect(el.content.rows).toEqual([["1", ""], ["2", "3"]]);
  expect(el.content.header).toBe(true);
  expect(el.content.columns[0]).toMatchObject({ align: "start", format: "text" });
  expect(el.style).toMatchObject({ headerBackground: "token:primary", headerColor: "token:on-primary", zebra: true, borderColor: "token:muted" });

  expect(tableContentSchema.safeParse({ columns: [{ id: "a" }], rows: [["1", "2"]] }).success).toBe(false);
  expect(tableContentSchema.safeParse({ columns: [{ id: "a" }, { id: "a" }], rows: [] }).success).toBe(false);
  expect(tableContentSchema.safeParse({ columns: [], rows: [] }).success).toBe(false);
  expect(tableContentSchema.safeParse({ columns: [{ id: "a" }], rows: [["x".repeat(TABLE_LIMITS.cellCharacters + 1)]] }).success).toBe(false);
  expect(tableContentSchema.safeParse({ columns: [{ id: "a" }], rows: Array.from({ length: TABLE_LIMITS.rows + 1 }, () => ["x"]) }).success).toBe(false);
  expect(tableContentSchema.safeParse({ columns: [{ id: "a", format: "money" }], rows: [] }).success).toBe(false);
});

// ---- Markdown ----

test("markdown blocks: headings, lists, tasks, quotes, code, rules and tables", () => {
  const blocks = parseMarkdownBlocks(`# Title

Intro with **bold** and [a link](https://example.com).

- one
  - nested
- [x] done
1. first

> quoted

\`\`\`ts
const a = 1;
\`\`\`

---

| A | B |
|:--|--:|
| 1 | 2 |
`);
  expect(blocks.map((block) => block.kind)).toEqual(["heading", "paragraph", "list-item", "list-item", "list-item", "list-item", "quote", "code", "rule", "table"]);
  const nested = blocks[3];
  expect(nested?.kind === "list-item" && nested.depth).toBe(1);
  const task = blocks[4];
  expect(task?.kind === "list-item" && task.checked).toBe(true);
  const ordered = blocks[5];
  expect(ordered?.kind === "list-item" && ordered.ordered).toBe(true);
  const table = blocks[9];
  expect(table?.kind === "table" && table.align).toEqual(["left", "right"]);
  const code = blocks[7];
  expect(code?.kind === "code" && code.text).toBe("const a = 1;");
});

test("markdown inline runs keep marks and drop unsafe links and raw HTML", () => {
  expect(parseMarkdownInline("a **b _c_** `d`")).toEqual([
    { text: "a " }, { text: "b ", bold: true }, { text: "c", bold: true, italic: true }, { text: " " }, { text: "d", code: true },
  ]);
  expect(parseMarkdownInline("[x](javascript:alert(1))")[0]).toEqual({ text: "x" });
  expect(parseMarkdownInline("[x](https://a.test)")[0]).toEqual({ text: "x", href: "https://a.test" });
  const text = markdownToPlainText('Hello <script>alert("x")</script><b>bold</b>');
  expect(text).not.toContain("<script");
  expect(text).not.toContain("<b>");
  expect(text).toContain("bold");
});

test("markdown plain text and title", () => {
  expect(markdownToPlainText("# T\n\n- a\n- [ ] b")).toBe("T\n• a\n[ ] • b");
  expect(markdownTitle("Some text\n\n## Heading")).toBe("Heading");
  expect(markdownTitle("Just text")).toBe("Just text");
});

// ---- Tables ----

test("createTableContent uses the first row as labels and right-aligns numeric columns", () => {
  const table = createTableContent([["Name", "Price"], ["Pen", "1.50"], ["Book", "$12"]]);
  expect(table.columns.map((column) => column.label)).toEqual(["Name", "Price"]);
  expect(table.columns.map((column) => column.align)).toEqual(["start", "end"]);
  expect(table.rows).toEqual([["Pen", "1.50"], ["Book", "$12"]]);
  const plain = createTableContent([["a", "b"]], { header: false });
  expect(plain.header).toBe(false);
  expect(plain.rows).toEqual([["a", "b"]]);
  expect(plain.columns[1]!.label).toBe("Column 2");
  expect(() => createTableContent([Array<string>(TABLE_LIMITS.columns + 1).fill("x")])).toThrow();
});

test("table ops insert, delete, move and validate", () => {
  let table = createEmptyTable(2, 2);
  table = applyTableOps(table, [{ op: "setCell", row: 0, column: 1, value: "x" }]);
  expect(table.rows[0]).toEqual(["", "x"]);
  table = applyTableOps(table, [{ op: "insertColumns", index: 0 }, { op: "insertRows", index: 2, values: [["a", "b", "c"]] }]);
  expect(table.columns).toHaveLength(3);
  expect(table.columns[0]!.label).toBe("Column 3");
  expect(table.rows[2]).toEqual(["a", "b", "c"]);
  table = applyTableOps(table, [{ op: "moveRow", from: 2, to: 0 }, { op: "moveColumn", from: 0, to: 2 }]);
  expect(table.rows[0]).toEqual(["b", "c", "a"]);
  table = applyTableOps(table, [{ op: "deleteRows", index: 0 }, { op: "deleteColumns", index: 0 }]);
  expect(table.rows).toEqual([["x", ""], ["", ""]]);
  table = applyTableOps(table, [{ op: "setCells", row: 1, column: 1, values: [["p", "q"], ["r"]] }]);
  expect(table.columns).toHaveLength(3);
  expect(table.rows).toEqual([["x", "", ""], ["", "p", "q"], ["", "r", ""]]);
  table = applyTableOps(table, [{ op: "updateColumn", column: 0, changes: { align: "center", format: "number", label: "N" } }, { op: "setHeader", header: false }]);
  expect(table.columns[0]).toMatchObject({ align: "center", format: "number", label: "N" });
  expect(table.header).toBe(false);
  expect(() => applyTableOps(table, [{ op: "setCell", row: 9, column: 0, value: "" }])).toThrow();
  expect(() => applyTableOps(createEmptyTable(1, 1), [{ op: "deleteColumns", index: 0 }])).toThrow();
});

test("formatTableCell formats numbers, currency, percent and dates", () => {
  expect(formatTableCell("1234.5", "number", { language: "en" })).toBe("1,234.5");
  expect(formatTableCell("1234.5", "currency", { language: "en", currency: "EUR" })).toBe("€1,234.50");
  expect(formatTableCell("12%", "percent", { language: "en" })).toBe("12%");
  expect(formatTableCell("0.5", "percent", { language: "en" })).toBe("50%");
  expect(formatTableCell("2024-03-05", "date", { language: "en" })).toBe("Mar 5, 2024");
  expect(formatTableCell("n/a", "number")).toBe("n/a");
});

// ---- CSV ----

test("CSV parser handles quotes, escaped quotes, embedded newlines and BOM", () => {
  const csv = '﻿name,notes\r\n"Smith, J","He said ""hi"""\r\n"multi\nline",x\n';
  const { rows, delimiter } = parseDelimited(csv);
  expect(delimiter).toBe(",");
  expect(rows).toEqual([["name", "notes"], ["Smith, J", 'He said "hi"'], ["multi\nline", "x"]]);
  expect(parseDelimited("a,b\rc,d").rows).toEqual([["a", "b"], ["c", "d"]]);
  expect(parseDelimited('a,""\n').rows).toEqual([["a", ""]]);
  expect(parseDelimited("a,b,\n").rows).toEqual([["a", "b", ""]]);
});

test("delimiter detection picks semicolon, tab and comma", () => {
  expect(detectDelimiter("a;b;c\n1;2,5;3\n")).toBe(";");
  expect(detectDelimiter("a\tb\n1\t2\n")).toBe("\t");
  expect(detectDelimiter('"x;y",b\n1,2\n')).toBe(",");
  expect(detectDelimiter("single column\nvalue")).toBe(",");
});

test("grid helpers normalize, check limits and read clipboard data", () => {
  expect(normalizeGrid([["a", "", ""], ["b", "c"], ["", ""]])).toEqual([["a", ""], ["b", "c"]]);
  expect(checkGrid([["a"]], true).errors).toEqual([]);
  expect(checkGrid([], true).errors[0]).toContain("No data");
  expect(checkGrid(Array.from({ length: TABLE_LIMITS.rows + 2 }, () => ["x"]), true).errors[0]).toContain("rows");
  expect(parseClipboardTable("a\tb\n1\t2\n")).toEqual([["a", "b"], ["1", "2"]]);
  expect(parseClipboardTable("just text")).toBeNull();
  expect(tableFileKind("Data.XLSX")).toBe("spreadsheet");
  expect(tableFileKind("x.tsv")).toBe("tsv");
  expect(tableFileKind("x.csv")).toBe("csv");
  expect(tableFileKind("x.pdf")).toBeNull();
});

// ---- Excel ----

test("readSpreadsheet converts every sheet of a workbook to display text", () => {
  const workbook = XLSX.utils.book_new();
  const prices = XLSX.utils.aoa_to_sheet([["Item", "Price", "Date"], ["Pen", 1.5, new Date(Date.UTC(2024, 2, 5))], ["Book", 12, null]], { cellDates: true });
  prices["B2"]!.z = "0.00";
  XLSX.utils.book_append_sheet(workbook, prices, "Prices");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Only"]]), "Other");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

  const sheets = readSpreadsheet(XLSX as unknown as SheetJsModule, bytes);
  expect(sheets.map((sheet) => sheet.name)).toEqual(["Prices", "Other"]);
  expect(sheets[0]!.rows[0]).toEqual(["Item", "Price", "Date"]);
  expect(sheets[0]!.rows[1]![0]).toBe("Pen");
  expect(sheets[0]!.rows[1]![1]).toBe("1.50");
  expect(sheets[0]!.rows[1]![2]).toMatch(/3\/5\/(20)?24/);
  expect(sheets[0]!.rows[2]).toEqual(["Book", "12", ""]);
  expect(sheets[1]!.rows).toEqual([["Only"]]);

  const many = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(many, XLSX.utils.aoa_to_sheet(Array.from({ length: 30 }, (_, index) => [index])), "Big");
  const big = readSpreadsheet(XLSX as unknown as SheetJsModule, XLSX.write(many, { type: "array", bookType: "xlsx" }) as ArrayBuffer, { maxRows: 10 });
  expect(big[0]!.rows).toHaveLength(10);
  expect(big[0]!.truncated).toBe(true);
});
