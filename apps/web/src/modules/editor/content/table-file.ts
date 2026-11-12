import { MAX_TABLE_FILE_BYTES, normalizeGrid, parseDelimited, readSpreadsheet, tableFileKind, type SheetJsModule, type SpreadsheetSheet } from "@Kavero/catalog-engine";

export const TABLE_FILE_ACCEPT = ".csv,.tsv,.tab,.txt,.xlsx,.xls,.xlsm,.ods,text/csv,text/tab-separated-values,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Text files saved by Excel on Windows are often not UTF-8; fall back to Windows-1252. */
function decodeText(bytes: ArrayBuffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/**
 * Read a CSV/TSV or spreadsheet file into sheets of cell text. SheetJS is loaded only when a
 * spreadsheet is opened, so it never weighs on the editor bundle.
 */
export async function readTableFile(file: File): Promise<SpreadsheetSheet[]> {
  const kind = tableFileKind(file.name, file.type);
  if (!kind) throw new Error("Choose a CSV, TSV or Excel file (.csv, .tsv, .xlsx, .xls).");
  if (file.size > MAX_TABLE_FILE_BYTES) throw new Error(`"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB; files can be at most ${MAX_TABLE_FILE_BYTES / 1024 / 1024} MB.`);
  const bytes = await file.arrayBuffer();
  if (kind === "spreadsheet") {
    const xlsx = (await import("xlsx")) as unknown as SheetJsModule;
    try {
      return readSpreadsheet(xlsx, bytes);
    } catch {
      throw new Error(`"${file.name}" could not be read as a spreadsheet. It may be damaged or password-protected.`);
    }
  }
  const { rows } = parseDelimited(decodeText(bytes), kind === "tsv" ? { delimiter: "\t" } : {});
  return [{ name: file.name, rows: normalizeGrid(rows), truncated: false }];
}
