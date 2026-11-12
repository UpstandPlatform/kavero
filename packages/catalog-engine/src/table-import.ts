import { TABLE_LIMITS } from "./schema";

/**
 * Turning CSV/TSV text, clipboard data and spreadsheets into a grid of cell strings.
 * Pure functions; the spreadsheet reader receives SheetJS from the caller so this package
 * stays free of the dependency (the editor loads it lazily).
 */

export type TableDelimiter = "," | ";" | "\t" | "|";
const DELIMITERS: TableDelimiter[] = ["\t", ",", ";", "|"];

/** Largest spreadsheet or CSV file the editor reads. */
export const MAX_TABLE_FILE_BYTES = 10 * 1024 * 1024;

/** Count delimiter characters outside quotes per line, for the first lines of the text. */
function delimiterCounts(text: string, delimiter: string, maxLines = 20): number[] {
  const counts: number[] = [];
  let quoted = false;
  let current = 0;
  for (let i = 0; i < text.length && counts.length < maxLines; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && char === delimiter) current++;
    else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      counts.push(current);
      current = 0;
    }
  }
  if (counts.length < maxLines && current > 0) counts.push(current);
  return counts;
}

/** Pick the delimiter that splits the first lines most consistently (tab, comma, semicolon or pipe). */
export function detectDelimiter(text: string): TableDelimiter {
  const sample = stripBom(text).slice(0, 64 * 1024);
  let best: { delimiter: TableDelimiter; score: number } = { delimiter: ",", score: 0 };
  for (const delimiter of DELIMITERS) {
    const counts = delimiterCounts(sample, delimiter);
    const nonEmpty = counts.filter((count) => count > 0);
    if (!nonEmpty.length) continue;
    const first = counts[0] ?? 0;
    const consistent = counts.filter((count) => count === first).length / counts.length;
    // Consistency matters most, then how many columns the delimiter produces.
    const score = consistent * 100 + Math.min(first, 50) + nonEmpty.length / counts.length;
    if (score > best.score) best = { delimiter, score };
  }
  return best.delimiter;
}

export function stripBom(text: string) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * RFC 4180 style parsing: quoted fields may contain delimiters, doubled quotes and line breaks.
 * Accepts \n, \r\n and \r line endings and ignores a byte-order mark. The delimiter is detected
 * unless given.
 */
export function parseDelimited(input: string, options: { delimiter?: TableDelimiter } = {}): { rows: string[][]; delimiter: TableDelimiter } {
  const text = stripBom(input);
  const delimiter = options.delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let fieldStarted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"' && !fieldStarted) {
      quoted = true;
      fieldStarted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
      fieldStarted = false;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      fieldStarted = false;
    } else {
      field += char;
      fieldStarted = true;
    }
  }
  if (field || fieldStarted || row.length) {
    row.push(field);
    rows.push(row);
  }
  return { rows, delimiter };
}

/** Remove trailing empty rows and columns and pad every row to the same width. */
export function normalizeGrid(rows: readonly (readonly unknown[])[]): string[][] {
  const grid = rows.map((row) => row.map((cell) => (cell === null || cell === undefined ? "" : String(cell))));
  while (grid.length && grid[grid.length - 1]!.every((cell) => !cell.trim())) grid.pop();
  let width = 0;
  for (const row of grid) {
    let last = row.length;
    while (last > 0 && !row[last - 1]!.trim()) last--;
    width = Math.max(width, last);
  }
  return grid.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ""));
}

export interface GridCheck {
  rows: number;
  columns: number;
  /** Problems that prevent inserting the data. */
  errors: string[];
  /** Cells that will be shortened. */
  truncatedCells: number;
}

/** Check a grid against the table limits (the header row counts toward rows only when it is data). */
export function checkGrid(grid: readonly (readonly string[])[], header: boolean): GridCheck {
  const columns = Math.max(0, ...grid.map((row) => row.length));
  const rows = Math.max(0, grid.length - (header ? 1 : 0));
  const errors: string[] = [];
  if (!grid.length || !columns) errors.push("No data found.");
  if (columns > TABLE_LIMITS.columns) errors.push(`Tables can have at most ${TABLE_LIMITS.columns} columns; this data has ${columns}.`);
  if (rows > TABLE_LIMITS.rows) errors.push(`Tables can have at most ${TABLE_LIMITS.rows} rows; this data has ${rows.toLocaleString()}.`);
  let truncatedCells = 0;
  let characters = 0;
  for (const row of grid) for (const cell of row) {
    if (cell.length > TABLE_LIMITS.cellCharacters) truncatedCells++;
    characters += Math.min(cell.length, TABLE_LIMITS.cellCharacters);
  }
  if (characters > TABLE_LIMITS.totalCharacters) errors.push(`Tables can hold at most ${TABLE_LIMITS.totalCharacters.toLocaleString()} characters; this data has ${characters.toLocaleString()}.`);
  return { rows, columns, errors, truncatedCells };
}

/**
 * Tab-separated clipboard text (as copied from Excel, Numbers or Google Sheets) as a grid,
 * or null when the text doesn't look like a table.
 */
export function parseClipboardTable(text: string): string[][] | null {
  const trimmed = stripBom(text).replace(/(\r?\n)+$/, "");
  if (!trimmed.includes("\t")) return null;
  const { rows } = parseDelimited(trimmed, { delimiter: "\t" });
  const grid = normalizeGrid(rows);
  if (grid.length < 1 || (grid[0]?.length ?? 0) < 2) return null;
  return grid;
}

/** The part of SheetJS (`xlsx`) the spreadsheet reader uses. */
export interface SheetJsModule {
  read(data: ArrayBuffer | Uint8Array, options: { type: "array"; cellDates?: boolean; sheetRows?: number; dense?: boolean }): { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: {
    sheet_to_json(sheet: unknown, options: { header: 1; raw: false; defval: string; blankrows: boolean; dateNF?: string }): unknown[];
  };
}

export interface SpreadsheetSheet {
  name: string;
  rows: string[][];
  /** True when the sheet has more rows than were read. */
  truncated: boolean;
}

/**
 * Read every sheet of an .xlsx/.xls/.ods workbook as grids of the cells' displayed text
 * (number formats and dates as shown in the spreadsheet). At most `maxRows` rows are read per sheet.
 */
export function readSpreadsheet(xlsx: SheetJsModule, data: ArrayBuffer | Uint8Array, options: { maxRows?: number } = {}): SpreadsheetSheet[] {
  const maxRows = options.maxRows ?? TABLE_LIMITS.rows + 1;
  const workbook = xlsx.read(data, { type: "array", cellDates: true, sheetRows: maxRows + 1 });
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const raw = sheet ? (xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "", blankrows: false, dateNF: "yyyy-mm-dd" }) as unknown[][]) : [];
    const rows = normalizeGrid(raw.filter(Array.isArray));
    return { name, rows: rows.slice(0, maxRows), truncated: rows.length > maxRows };
  });
}

/** File kinds the table importer understands, from the file name (and type as a fallback). */
export function tableFileKind(name: string, mimeType = ""): "csv" | "tsv" | "spreadsheet" | null {
  const extension = name.toLowerCase().split(".").pop() ?? "";
  if (["xlsx", "xls", "xlsm", "ods"].includes(extension)) return "spreadsheet";
  if (extension === "tsv" || extension === "tab") return "tsv";
  if (extension === "csv" || extension === "txt") return "csv";
  if (/spreadsheetml|ms-excel|opendocument\.spreadsheet/.test(mimeType)) return "spreadsheet";
  if (/tab-separated/.test(mimeType)) return "tsv";
  if (/csv|text\/plain/.test(mimeType)) return "csv";
  return null;
}
