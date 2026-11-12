import { createTableContent, parseClipboardTable, tableStyleSchema, type TableContent } from "@Kavero/catalog-engine";
import type { NewElement } from "@Kavero/editor-core";
import { estimateTableHeight } from "@Kavero/renderer";

type Page = { width: number; height: number };
export type ContentElementInput = Omit<NewElement, "position"> & { size: [number, number] };

/** A new markdown element sized for the page; body text scales with the page height. */
export function markdownElementInput(markdown: string, page: Page, name?: string): ContentElementInput {
  return {
    type: "markdown", ...(name ? { name } : {}),
    content: { markdown },
    style: { baseFontSize: Math.max(12, Math.round(page.height * 0.024)) },
    size: [Math.round(page.width * 0.45), Math.round(page.height * 0.6)],
  } as unknown as ContentElementInput;
}

/** A new table element whose box fits its rows (up to 80% of the page height). */
export function tableElementInput(content: TableContent, page: Page): ContentElementInput {
  const fontSize = Math.max(12, Math.round(page.height * 0.02));
  const style = tableStyleSchema.parse({ fontSize, cellPadding: Math.round(fontSize * 0.5) });
  const height = Math.round(Math.min(page.height * 0.8, Math.max(page.height * 0.12, estimateTableHeight({ content, style }))));
  const width = Math.round(Math.min(page.width * 0.9, Math.max(page.width * 0.4, content.columns.length * fontSize * 7)));
  return { type: "table", content, style, size: [width, height] } as unknown as ContentElementInput;
}

/** Spreadsheet cells on the clipboard (tab-separated, at least two columns) as a table. */
export function tableInputFromClipboard(text: string, page: Page): ContentElementInput | null {
  const grid = parseClipboardTable(text);
  if (!grid || grid.length < 2) return null;
  try {
    return tableElementInput(createTableContent(grid, { header: true }), page);
  } catch {
    return null;
  }
}

/** Markdown files (by extension or type). */
export const isMarkdownFile = (file: File) => /\.(md|markdown|mdown|mkd)$/i.test(file.name) || file.type === "text/markdown";
