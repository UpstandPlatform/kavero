import {
  MAX_MARKDOWN_CHARACTERS,
  TABLE_COLUMN_FORMATS,
  TABLE_LIMITS,
  createId,
  markdownTitle,
  markdownToPlainText,
  normalizeGrid,
  parseDelimited,
  tableContentSchema,
  tableToPlainText,
  type CatalogDocument,
  type CatalogElement,
  type TableOp,
} from "@Kavero/catalog-engine";
import type { EditorCommand, NewElement } from "@Kavero/editor-core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

/**
 * MCP tools for markdown and table elements. Inputs are validated here, turned into editor
 * commands and applied through the same catalog service (and schema) as every other edit.
 */

const id = z.string().min(1).max(100);
const colorInput = z.string().min(1).max(100).describe("Hex color or theme token (token:text, token:primary, token:muted, token:accent, token:background, token:on-primary)");
const fontInput = z.string().min(1).max(200).describe('Font family name or theme token ("token:body", "token:heading")');
const positionInput = z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive(), rotation: z.number().optional() });
const cell = z.union([z.string().max(TABLE_LIMITS.cellCharacters), z.number().finite(), z.boolean(), z.null()]).transform((value) => (value === null ? "" : String(value)));
const grid = z.array(z.array(cell).max(TABLE_LIMITS.columns)).max(TABLE_LIMITS.rows);

export const markdownStyleInput = z.object({
  fontFamily: fontInput, headingFontFamily: fontInput, baseFontSize: z.number().min(4).max(400).describe("Body text size in document pixels"),
  color: colorInput, headingColor: colorInput, linkColor: colorInput, lineHeight: z.number().min(0.8).max(4),
  align: z.enum(["start", "center", "end", "justify"]), direction: z.enum(["auto", "ltr", "rtl"]), background: colorInput,
}).partial();

export const tableStyleInput = z.object({
  fontFamily: fontInput, fontSize: z.number().min(4).max(200), color: colorInput,
  headerBackground: colorInput, headerColor: colorInput, zebra: z.boolean(), zebraColor: colorInput, background: colorInput,
  borderColor: colorInput, borderWidth: z.number().min(0).max(8), cellPadding: z.number().min(0).max(64),
  density: z.enum(["compact", "normal", "comfortable"]), direction: z.enum(["auto", "ltr", "rtl"]),
}).partial();

const columnInput = z.union([
  z.string().max(TABLE_LIMITS.labelCharacters),
  z.object({
    label: z.string().max(TABLE_LIMITS.labelCharacters),
    align: z.enum(["start", "center", "end"]).optional(),
    format: z.enum(TABLE_COLUMN_FORMATS).optional().describe("How cells display: text (as typed), number, currency (catalog currency), percent, date"),
    width: z.number().min(0.1).max(100).optional().describe("Relative width; columns without one share the rest equally"),
  }),
]);

export const markdownAddInput = z.object({
  catalogId: id, slideId: id,
  markdown: z.string().min(1).max(MAX_MARKDOWN_CHARACTERS).describe("GitHub-flavored markdown: headings, **bold**, *italic*, lists, - [ ] tasks, links, `code`, ``` blocks, > quotes, tables, ---. Raw HTML is not rendered."),
  position: positionInput.optional().describe("Document pixels; default: centered, 60% of the page width"),
  style: markdownStyleInput.optional(),
  name: z.string().max(100).optional(),
});

export const markdownUpdateInput = z.object({
  catalogId: id, elementId: id,
  markdown: z.string().max(MAX_MARKDOWN_CHARACTERS).optional(),
  style: markdownStyleInput.optional(),
}).refine((value) => value.markdown !== undefined || value.style !== undefined, "Give markdown, style or both.");

export const tableAddInput = z.object({
  catalogId: id, slideId: id,
  columns: z.array(columnInput).min(1).max(TABLE_LIMITS.columns).optional().describe("Column labels (or objects with label/align/format/width)"),
  rows: grid.optional().describe("Body rows, cells in column order"),
  csv: z.string().max(500_000).optional().describe("Alternative to columns/rows: CSV or TSV text; its first row becomes the header"),
  header: z.boolean().optional().describe("Show the column labels as a header row (default true)"),
  position: positionInput.optional().describe("Document pixels; default: centered, 80% of the page width"),
  style: tableStyleInput.optional(),
  name: z.string().max(100).optional(),
}).refine((value) => (value.columns !== undefined) !== (value.csv !== undefined), "Give either columns (with rows) or csv.");

const index = z.number().int().min(0).max(10_000);
export const tableOpInput = z.discriminatedUnion("op", [
  z.object({ op: z.literal("setCell"), row: index, column: index, value: cell }),
  z.object({ op: z.literal("setCells"), row: index, column: index, values: grid }).describe("Write a block of cells starting at (row, column); the table grows when needed"),
  z.object({ op: z.literal("insertRows"), index, count: z.number().int().min(1).max(TABLE_LIMITS.rows).optional(), values: grid.optional() }),
  z.object({ op: z.literal("deleteRows"), index, count: z.number().int().min(1).max(TABLE_LIMITS.rows).optional() }),
  z.object({ op: z.literal("moveRow"), from: index, to: index }),
  z.object({ op: z.literal("insertColumns"), index, count: z.number().int().min(1).max(TABLE_LIMITS.columns).optional(), labels: z.array(z.string().max(TABLE_LIMITS.labelCharacters)).max(TABLE_LIMITS.columns).optional() }),
  z.object({ op: z.literal("deleteColumns"), index, count: z.number().int().min(1).max(TABLE_LIMITS.columns).optional() }),
  z.object({ op: z.literal("moveColumn"), from: index, to: index }),
  z.object({
    op: z.literal("updateColumn"), column: index,
    changes: z.object({ label: z.string().max(TABLE_LIMITS.labelCharacters), align: z.enum(["start", "center", "end"]), format: z.enum(TABLE_COLUMN_FORMATS), width: z.number().min(0.1).max(100) }).partial(),
  }),
  z.object({ op: z.literal("setHeader"), header: z.boolean() }),
]);

export const tableUpdateInput = z.object({
  catalogId: id, elementId: id,
  ops: z.array(tableOpInput).max(200).optional().describe("Edits applied in order; row/column indexes are 0-based body rows/columns (the header is not a row)"),
  style: tableStyleInput.optional(),
}).refine((value) => value.ops?.length || value.style, "Give ops, style or both.");

export type MarkdownAddInput = z.infer<typeof markdownAddInput>;
export type TableAddInput = z.infer<typeof tableAddInput>;
export type TableUpdateInput = z.infer<typeof tableUpdateInput>;
export type MarkdownUpdateInput = z.infer<typeof markdownUpdateInput>;

const centered = (page: { width: number; height: number }, widthShare: number, heightShare: number) => {
  const width = Math.round(page.width * widthShare), height = Math.round(page.height * heightShare);
  return { x: Math.round((page.width - width) / 2), y: Math.round((page.height - height) / 2), width, height, rotation: 0 };
};

export function markdownAddCommand(input: MarkdownAddInput, page: { width: number; height: number }): EditorCommand {
  return {
    type: "element.add", slideId: input.slideId,
    element: {
      type: "markdown", ...(input.name ? { name: input.name } : {}),
      position: { rotation: 0, ...(input.position ?? centered(page, 0.6, 0.6)) },
      content: { markdown: input.markdown },
      style: { baseFontSize: Math.max(12, Math.round(page.height * 0.022)), ...input.style },
    } as unknown as NewElement,
  };
}

export function markdownUpdateCommands(input: MarkdownUpdateInput): EditorCommand[] {
  const changes: Record<string, unknown> = {};
  if (input.markdown !== undefined) changes.content = { markdown: input.markdown };
  if (input.style) changes.style = input.style;
  return [{ type: "element.update", elementId: input.elementId, changes }];
}

/** Table content from tool input (columns + rows, or CSV text). Throws with a readable message. */
export function tableContentFromInput(input: Pick<TableAddInput, "columns" | "rows" | "csv" | "header">) {
  let columns: Exclude<TableAddInput["columns"], undefined>;
  let rows: string[][];
  if (input.csv !== undefined) {
    const parsed = normalizeGrid(parseDelimited(input.csv).rows);
    if (!parsed.length) throw new Error("The CSV has no data.");
    columns = parsed[0]!;
    rows = parsed.slice(1);
  } else {
    columns = input.columns ?? [];
    rows = (input.rows ?? []).map((row) => row.map((value: unknown) => (value === null || value === undefined ? "" : String(value))));
  }
  if (columns.length > TABLE_LIMITS.columns) throw new Error(`Tables can have at most ${TABLE_LIMITS.columns} columns.`);
  if (rows.length > TABLE_LIMITS.rows) throw new Error(`Tables can have at most ${TABLE_LIMITS.rows} rows.`);
  const parsed = tableContentSchema.safeParse({
    columns: columns.map((column) => ({ id: createId("col"), ...(typeof column === "string" ? { label: column } : column) })),
    rows,
    header: input.header ?? true,
  });
  if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  return parsed.data;
}

export function tableAddCommand(input: TableAddInput, page: { width: number; height: number }): EditorCommand {
  const content = tableContentFromInput(input);
  const fontSize = Math.max(10, Math.round(page.height * 0.018));
  const rowHeight = fontSize * 1.3 + 20;
  const height = Math.min(page.height * 0.8, rowHeight * (content.rows.length + (content.header ? 1 : 0)) + 2);
  return {
    type: "element.add", slideId: input.slideId,
    element: {
      type: "table", ...(input.name ? { name: input.name } : {}),
      position: { rotation: 0, ...(input.position ?? { ...centered(page, 0.8, 0.5), height: Math.round(height), y: Math.round((page.height - height) / 2) }) },
      content,
      style: { fontSize, ...input.style },
    } as unknown as NewElement,
  };
}

export function tableUpdateCommands(input: TableUpdateInput): EditorCommand[] {
  const commands: EditorCommand[] = [];
  if (input.ops?.length) commands.push({ type: "table.edit", elementId: input.elementId, ops: input.ops as TableOp[] });
  if (input.style) commands.push({ type: "element.update", elementId: input.elementId, changes: { style: input.style } });
  return commands;
}

/** Text an agent reads back for markdown and table elements in catalog outlines. */
export function contentElementText(element: CatalogElement): string | undefined {
  if (element.type === "markdown") return markdownToPlainText(element.content.markdown).slice(0, 400);
  if (element.type === "table") return tableToPlainText(element.content, 8).slice(0, 600);
  return undefined;
}

/** Extra outline fields for markdown and table elements. */
export function contentElementOutline(element: CatalogElement) {
  if (element.type === "markdown") return { title: markdownTitle(element.content.markdown).slice(0, 80) || undefined, characters: element.content.markdown.length };
  if (element.type === "table") return { columns: element.content.columns.map((column) => column.label), rows: element.content.rows.length, header: element.content.header };
  return undefined;
}

export const CONTENT_ELEMENT_HELP = `- markdown: {"type":"markdown","position":{...},"content":{"markdown":"# Title\\n\\n- item"},"style":{"baseFontSize":24}}  (or use slide_add_markdown)
- table:   {"type":"table","position":{...},"content":{"columns":[{"id":"c1","label":"Name"}],"rows":[["Pen"]],"header":true}}  (or use slide_add_table)`;

type Guard = <A extends Record<string, unknown>>(name: string, scope: "catalogs:write", fn: (args: A) => Promise<CallToolResult>) => (args: A) => Promise<CallToolResult>;

export interface ContentToolsDeps {
  server: McpServer;
  guard: Guard;
  edit: (catalogId: string, commands: EditorCommand[]) => Promise<{ catalogId: string; revision: number; createdIds: string[] }>;
  getDocument: (catalogId: string) => Promise<CatalogDocument>;
  ok: (data: unknown) => CallToolResult;
  fail: (message: string) => CallToolResult;
}

function findElement(doc: CatalogDocument, elementId: string) {
  for (const slide of doc.slides) for (const element of slide.elements) if (element.id === elementId) return element;
  return undefined;
}

/** Register slide_add_markdown, markdown_update, slide_add_table and table_update. */
export function registerContentTools({ server, guard, edit, getDocument, ok, fail }: ContentToolsDeps) {
  const run = <A>(schema: z.ZodType<A>, handler: (input: A) => Promise<CallToolResult>) => async (args: Record<string, unknown>) => {
    const parsed = schema.safeParse(args);
    if (!parsed.success) return fail(parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; "));
    return handler(parsed.data);
  };

  server.registerTool("slide_add_markdown", {
    title: "Add markdown",
    description: "Add a markdown block to a slide. It renders GitHub-flavored markdown (headings, lists, task lists, links, code, quotes, tables) in the catalog's theme fonts and colors. Raw HTML is ignored.",
    inputSchema: markdownAddInput.shape,
  }, guard("slide_add_markdown", "catalogs:write", run(markdownAddInput, async (input) => {
    const doc = await getDocument(input.catalogId);
    if (!doc.slides.some((slide) => slide.id === input.slideId)) return fail(`Slide "${input.slideId}" not found.`);
    return ok(await edit(input.catalogId, [markdownAddCommand(input, doc.settings)]));
  })));

  server.registerTool("markdown_update", {
    title: "Update markdown",
    description: "Replace a markdown element's text and/or change its style (font sizes in document pixels, colors as theme tokens or hex).",
    inputSchema: markdownUpdateInput.shape,
  }, guard("markdown_update", "catalogs:write", run(markdownUpdateInput, async (input) => {
    const element = findElement(await getDocument(input.catalogId), input.elementId);
    if (element?.type !== "markdown") return fail(element ? `Element "${input.elementId}" is a ${element.type}, not a markdown element.` : `Element "${input.elementId}" not found.`);
    return ok(await edit(input.catalogId, markdownUpdateCommands(input)));
  })));

  server.registerTool("slide_add_table", {
    title: "Add table",
    description: `Add a data table to a slide from columns + rows or CSV text (at most ${TABLE_LIMITS.columns} columns × ${TABLE_LIMITS.rows} rows). Uses the theme colors by default: header in token:primary, zebra rows, muted borders.`,
    inputSchema: tableAddInput.shape,
  }, guard("slide_add_table", "catalogs:write", run(tableAddInput, async (input) => {
    const doc = await getDocument(input.catalogId);
    if (!doc.slides.some((slide) => slide.id === input.slideId)) return fail(`Slide "${input.slideId}" not found.`);
    let command: EditorCommand;
    try {
      command = tableAddCommand(input, doc.settings);
    } catch (error) {
      return fail((error as Error).message);
    }
    return ok(await edit(input.catalogId, [command]));
  })));

  server.registerTool("table_update", {
    title: "Update table",
    description: "Edit a table element: set cells, insert/delete/move rows and columns, change column labels, alignment and number formats, toggle the header row, and restyle. All ops apply together as one change.",
    inputSchema: tableUpdateInput.shape,
  }, guard("table_update", "catalogs:write", run(tableUpdateInput, async (input) => {
    const element = findElement(await getDocument(input.catalogId), input.elementId);
    if (element?.type !== "table") return fail(element ? `Element "${input.elementId}" is a ${element.type}, not a table.` : `Element "${input.elementId}" not found.`);
    return ok(await edit(input.catalogId, tableUpdateCommands(input)));
  })));
}
