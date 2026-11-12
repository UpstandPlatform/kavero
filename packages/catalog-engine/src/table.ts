import { createId } from "./document";
import { TABLE_LIMITS, tableContentSchema, type TableColumn, type TableColumnFormat, type TableContent } from "./schema";

/** Input accepted for table content (column fields other than id/label may be omitted). */
export type TableContentInput = {
  columns: (Pick<TableColumn, "id"> & Partial<Omit<TableColumn, "id">>)[];
  rows: string[][];
  header?: boolean;
};

const columnId = () => createId("col").slice(0, 32);

/** Columns for a grid of data; labels come from the first row when it is a header. */
export function createTableContent(grid: readonly (readonly string[])[], options: { header?: boolean; labels?: readonly string[] } = {}): TableContent {
  const header = options.header ?? true;
  const width = Math.max(1, ...grid.map((row) => row.length), options.labels?.length ?? 0);
  if (width > TABLE_LIMITS.columns) throw new Error(`Tables can have at most ${TABLE_LIMITS.columns} columns (this data has ${width}).`);
  const labels = options.labels ?? (header && grid.length ? grid[0]! : []);
  const body = options.labels || !header ? grid : grid.slice(1);
  if (body.length > TABLE_LIMITS.rows) throw new Error(`Tables can have at most ${TABLE_LIMITS.rows} rows (this data has ${body.length}).`);
  const columns = Array.from({ length: width }, (_, index) => {
    const values = body.map((row) => row[index] ?? "");
    const format = guessColumnFormat(values);
    return {
      id: columnId(),
      label: (labels[index] ?? "").slice(0, TABLE_LIMITS.labelCharacters) || (header ? "" : `Column ${index + 1}`),
      align: format === "text" || format === "date" ? ("start" as const) : ("end" as const),
      format: "text" as const,
    };
  });
  return tableContentSchema.parse({
    columns,
    rows: body.map((row) => Array.from({ length: width }, (_, index) => (row[index] ?? "").slice(0, TABLE_LIMITS.cellCharacters))),
    header,
  });
}

/** An empty table of the given size with "Column n" labels. */
export function createEmptyTable(rows: number, columns: number): TableContent {
  const r = Math.max(1, Math.min(TABLE_LIMITS.rows, Math.round(rows)));
  const c = Math.max(1, Math.min(TABLE_LIMITS.columns, Math.round(columns)));
  return createTableContent(Array.from({ length: r }, () => Array<string>(c).fill("")), { labels: Array.from({ length: c }, (_, index) => `Column ${index + 1}`) });
}

const NUMBER = /^[-+]?[$€£¥₹]?\s?\d{1,3}(?:[,\s]\d{3})*(?:\.\d+)?%?$|^[-+]?[$€£¥₹]?\d+(?:\.\d+)?%?$/;

/** Numeric-looking columns are right-aligned on import; formatting stays "text" so values show as typed. */
export function guessColumnFormat(values: readonly string[]): TableColumnFormat {
  const filled = values.map((value) => value.trim()).filter(Boolean);
  if (!filled.length) return "text";
  return filled.every((value) => NUMBER.test(value)) ? "number" : "text";
}

/** Parse a cell that holds a number (thousands separators, currency symbols and % allowed). */
export function parseTableNumber(value: string): number | null {
  const cleaned = value.trim().replace(/[$€£¥₹\s,]/g, "").replace(/%$/, "");
  if (!cleaned || !/^[-+]?\d*\.?\d+(?:e[-+]?\d+)?$/i.test(cleaned)) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

/** Cell text as displayed for a column format. Values that don't parse are shown unchanged. */
export function formatTableCell(value: string, format: TableColumnFormat, options: { language?: string; currency?: string } = {}): string {
  if (format === "text" || !value.trim()) return value;
  const language = options.language || "en";
  try {
    if (format === "date") {
      if (!/\d/.test(value)) return value;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(language, { dateStyle: "medium", timeZone: /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? "UTC" : undefined }).format(date);
    }
    const number = parseTableNumber(value);
    if (number === null) return value;
    if (format === "percent") return new Intl.NumberFormat(language, { style: "percent", maximumFractionDigits: 2 }).format(value.trim().endsWith("%") ? number / 100 : number);
    if (format === "currency") return new Intl.NumberFormat(language, { style: "currency", currency: options.currency || "USD" }).format(number);
    return new Intl.NumberFormat(language, { maximumFractionDigits: 6 }).format(number);
  } catch {
    return value;
  }
}

/** Plain text of a table, one line per row with " | " between cells. */
export function tableToPlainText(table: Pick<TableContent, "columns" | "rows" | "header">, maxRows = Number.POSITIVE_INFINITY): string {
  const lines = table.header ? [table.columns.map((column) => column.label).join(" | ")] : [];
  for (const row of table.rows.slice(0, maxRows)) lines.push(row.join(" | "));
  if (table.rows.length > maxRows) lines.push(`… ${table.rows.length - maxRows} more rows`);
  return lines.join("\n");
}

// ---- Edits ----

/** One structural or cell edit of a table. Indexes are 0-based body rows / columns. */
export type TableOp =
  | { op: "setCell"; row: number; column: number; value: string }
  /** Write a block of values starting at (row, column); grows the table when needed. */
  | { op: "setCells"; row: number; column: number; values: string[][] }
  | { op: "insertRows"; index: number; count?: number; values?: string[][] }
  | { op: "deleteRows"; index: number; count?: number }
  | { op: "moveRow"; from: number; to: number }
  | { op: "insertColumns"; index: number; count?: number; labels?: string[] }
  | { op: "deleteColumns"; index: number; count?: number }
  | { op: "moveColumn"; from: number; to: number }
  | { op: "updateColumn"; column: number; changes: Partial<Omit<TableColumn, "id">> }
  | { op: "setHeader"; header: boolean }
  /** Replace all data (e.g. a re-import). */
  | { op: "replace"; columns: TableContentInput["columns"]; rows: string[][]; header?: boolean };

export class TableEditError extends Error {}

function clampIndex(index: number, length: number) {
  if (!Number.isInteger(index)) throw new TableEditError("Table indexes must be whole numbers.");
  return Math.max(0, Math.min(index, length));
}

function checkRow(table: TableContent, row: number) {
  if (!Number.isInteger(row) || row < 0 || row >= table.rows.length) throw new TableEditError(`Row ${row} does not exist (the table has ${table.rows.length} rows).`);
}

function checkColumn(table: TableContent, column: number) {
  if (!Number.isInteger(column) || column < 0 || column >= table.columns.length) throw new TableEditError(`Column ${column} does not exist (the table has ${table.columns.length} columns).`);
}

function count(value: number | undefined) {
  const n = value ?? 1;
  if (!Number.isInteger(n) || n < 1) throw new TableEditError("Count must be a positive whole number.");
  return n;
}

function nextLabel(table: { columns: { label: string }[] }) {
  const used = new Set(table.columns.map((column) => column.label));
  for (let n = table.columns.length + 1; ; n++) if (!used.has(`Column ${n}`)) return `Column ${n}`;
}

/** Apply edits to table content and validate the result. The input is not modified. */
export function applyTableOps(content: TableContent, ops: readonly TableOp[]): TableContent {
  const table: TableContent = structuredClone(content);
  const width = () => table.columns.length;
  const ensureSize = (rows: number, columns: number) => {
    while (table.columns.length < columns) {
      table.columns.push({ id: columnId(), label: nextLabel(table), align: "start", format: "text" });
      for (const row of table.rows) row.push("");
    }
    while (table.rows.length < rows) table.rows.push(Array<string>(width()).fill(""));
  };
  for (const op of ops) {
    switch (op.op) {
      case "setCell":
        checkRow(table, op.row);
        checkColumn(table, op.column);
        table.rows[op.row]![op.column] = op.value;
        break;
      case "setCells": {
        if (!Number.isInteger(op.row) || !Number.isInteger(op.column) || op.row < 0 || op.column < 0) throw new TableEditError("Cell positions must be non-negative whole numbers.");
        const columns = Math.max(0, ...op.values.map((row) => row.length));
        ensureSize(op.row + op.values.length, op.column + columns);
        op.values.forEach((values, r) => values.forEach((value, c) => (table.rows[op.row + r]![op.column + c] = value)));
        break;
      }
      case "insertRows": {
        const index = clampIndex(op.index, table.rows.length);
        const rows = op.values ?? Array.from({ length: count(op.count) }, () => []);
        const columns = Math.max(width(), ...rows.map((row) => row.length));
        ensureSize(0, columns);
        table.rows.splice(index, 0, ...rows.map((row) => Array.from({ length: width() }, (_, c) => row[c] ?? "")));
        break;
      }
      case "deleteRows":
        checkRow(table, op.index);
        table.rows.splice(op.index, count(op.count));
        break;
      case "moveRow": {
        checkRow(table, op.from);
        const [row] = table.rows.splice(op.from, 1);
        table.rows.splice(clampIndex(op.to, table.rows.length), 0, row!);
        break;
      }
      case "insertColumns": {
        const index = clampIndex(op.index, width());
        const n = op.labels?.length || count(op.count);
        const added = Array.from({ length: n }, (_, i) => ({ id: columnId(), label: op.labels?.[i] ?? "", align: "start" as const, format: "text" as const }));
        for (const column of added) if (!column.label) column.label = nextLabel({ columns: [...table.columns, ...added.filter((other) => other.label)] });
        table.columns.splice(index, 0, ...added);
        for (const row of table.rows) row.splice(index, 0, ...Array<string>(n).fill(""));
        break;
      }
      case "deleteColumns": {
        checkColumn(table, op.index);
        const n = count(op.count);
        if (width() - Math.min(n, width() - op.index) < 1) throw new TableEditError("A table needs at least one column.");
        table.columns.splice(op.index, n);
        for (const row of table.rows) row.splice(op.index, n);
        break;
      }
      case "moveColumn": {
        checkColumn(table, op.from);
        const to = clampIndex(op.to, width() - 1);
        const [column] = table.columns.splice(op.from, 1);
        table.columns.splice(to, 0, column!);
        for (const row of table.rows) {
          const [cell] = row.splice(op.from, 1);
          row.splice(to, 0, cell ?? "");
        }
        break;
      }
      case "updateColumn": {
        checkColumn(table, op.column);
        const { id: _id, ...changes } = op.changes as Partial<TableColumn>;
        table.columns[op.column] = { ...table.columns[op.column]!, ...changes };
        break;
      }
      case "setHeader":
        table.header = op.header;
        break;
      case "replace": {
        const next = tableContentSchema.parse({ columns: op.columns, rows: op.rows, header: op.header ?? table.header });
        table.columns = next.columns;
        table.rows = next.rows;
        table.header = next.header;
        break;
      }
    }
  }
  const parsed = tableContentSchema.safeParse(table);
  if (!parsed.success) throw new TableEditError(parsed.error.issues[0]?.message ?? "Invalid table.");
  return parsed.data;
}
