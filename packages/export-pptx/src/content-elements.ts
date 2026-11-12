import {
  formatTableCell,
  parseMarkdownBlocks,
  type CatalogDocument,
  type MarkdownElement,
  type MarkdownRun,
  type TableElement,
} from "@Kavero/catalog-engine";
import type PptxGenJS from "pptxgenjs";

/** What the main exporter shares with the markdown and table converters. */
export interface ContentExportContext {
  slide: PptxGenJS.Slide;
  doc: CatalogDocument;
  /** Position of the element in inches (PptxGenJS units). */
  box: { x: number; y: number; w: number; h: number; rotate?: number };
  /** Theme token or color → 6-digit hex. */
  color: (value: string | undefined, fallback?: string) => string;
  /** Theme font token → family name. */
  font: (value: string) => string;
  /** Document pixels → points. */
  pt: (px: number) => number;
  /** Whether a text is right-to-left (first strong character, like dir="auto"). */
  isRtl: (text: string) => boolean;
  warn: (message: string) => void;
  transparency?: number;
}

const HEADING_SCALE = [2, 1.6, 1.3, 1.12, 1, 0.9] as const;
const MONO = "Courier New";

function mixHex(a: string, b: string, amount: number) {
  const channel = (hex: string, index: number) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return [0, 1, 2].map((index) => Math.round(channel(a, index) * amount + channel(b, index) * (1 - amount)).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/**
 * Markdown → one editable text box. Headings, emphasis, links, lists (bulleted, numbered, tasks),
 * quotes and code keep their structure; markdown tables become " | "-separated lines.
 */
export function addMarkdownElement(ctx: ContentExportContext, element: MarkdownElement) {
  const s = element.style;
  const blocks = parseMarkdownBlocks(element.content.markdown);
  if (!blocks.length) return;
  const base = s.baseFontSize;
  const text = ctx.color(s.color);
  const link = ctx.color(s.linkColor);
  const runs: PptxGenJS.TextProps[] = [];
  const toRuns = (items: MarkdownRun[], paragraph: PptxGenJS.TextPropsOptions) => {
    const list = items.length ? items : [{ text: "" }];
    list.forEach((run, index) => runs.push({
      text: run.text,
      options: {
        ...paragraph,
        bold: run.bold || paragraph.bold || undefined,
        italic: run.italic || paragraph.italic || undefined,
        strike: run.strike ? "sngStrike" : undefined,
        fontFace: run.code ? MONO : paragraph.fontFace,
        color: run.href ? link : paragraph.color,
        hyperlink: run.href ? { url: run.href } : undefined,
        breakLine: index === list.length - 1,
      },
    }));
  };
  let tables = false;
  for (const block of blocks) {
    const paragraph: PptxGenJS.TextPropsOptions = { fontSize: ctx.pt(base), color: text, paraSpaceAfter: ctx.pt(base * 0.4) };
    switch (block.kind) {
      case "heading":
        toRuns(block.runs, { ...paragraph, bold: true, fontSize: ctx.pt(base * (HEADING_SCALE[block.level - 1] ?? 1)), fontFace: ctx.font(s.headingFontFamily), color: ctx.color(s.headingColor) });
        break;
      case "paragraph":
        toRuns(block.runs, paragraph);
        break;
      case "quote":
        toRuns(block.runs, { ...paragraph, italic: true, color: ctx.color("token:muted") });
        break;
      case "list-item": {
        const prefix = block.checked === undefined ? [] : [{ text: block.checked ? "☑ " : "☐ " }];
        toRuns([...prefix, ...block.runs], {
          ...paragraph, paraSpaceAfter: ctx.pt(base * 0.15), indentLevel: block.depth,
          bullet: block.checked !== undefined ? false : block.ordered ? { type: "number", numberStartAt: block.number || 1 } : true,
        });
        break;
      }
      case "code":
        for (const [index, line] of block.text.split("\n").entries()) {
          runs.push({ text: line || " ", options: { ...paragraph, fontFace: MONO, fontSize: ctx.pt(base * 0.85), paraSpaceAfter: index === block.text.split("\n").length - 1 ? paragraph.paraSpaceAfter : 0, breakLine: true } });
        }
        break;
      case "rule":
        runs.push({ text: "", options: { ...paragraph, breakLine: true } });
        break;
      case "table":
        tables = true;
        for (const row of [block.header, ...block.rows]) {
          toRuns(row.flatMap((cell, index) => [...(index ? [{ text: "  |  " }] : []), ...cell]), { ...paragraph, paraSpaceAfter: ctx.pt(base * 0.1), bold: row === block.header });
        }
        break;
    }
  }
  if (tables) ctx.warn("Tables inside markdown become text lines in PowerPoint; use a table element for a native table.");
  delete runs[runs.length - 1]!.options!.breakLine;
  const plain = blocks.map((block) => ("runs" in block ? block.runs.map((run) => run.text).join("") : "")).join(" ");
  const rtl = s.direction === "rtl" || (s.direction === "auto" && ctx.isRtl(plain));
  const align = s.align === "start" ? (rtl ? "right" : "left") : s.align === "end" ? (rtl ? "left" : "right") : s.align;
  ctx.slide.addText(runs, {
    ...ctx.box, fontFace: ctx.font(s.fontFamily), fontSize: ctx.pt(base), color: text, valign: "top", margin: 0,
    lineSpacingMultiple: s.lineHeight, align, rtlMode: rtl || undefined, lang: ctx.doc.metadata.language, transparency: ctx.transparency,
    fill: s.background ? { color: ctx.color(s.background) } : undefined, fit: "shrink",
  });
}

const DENSITY = { compact: 0.6, normal: 1, comfortable: 1.5 } as const;

/** Table → native PowerPoint table with header, zebra rows, borders and column widths. Rows that don't fit are left out. */
export function addTableElement(ctx: ContentExportContext, element: TableElement) {
  const { content, style: s } = element;
  const inch = (px: number) => px / 96;
  const padding = s.cellPadding * DENSITY[s.density];
  const naturalRow = s.fontSize * 1.3 + padding * 2 + s.borderWidth;
  const height = element.position.height;
  const headerRows = content.header ? 1 : 0;
  const fits = Math.max(0, Math.floor(height / naturalRow) - headerRows);
  const bodyRows = content.rows.slice(0, Math.max(1, fits));
  if (bodyRows.length < content.rows.length) ctx.warn("Tables taller than their box are cut to the rows that fit in PowerPoint.");
  if (element.position.rotation) ctx.warn("Rotated tables are exported unrotated.");
  const totalRows = bodyRows.length + headerRows;
  const rowH = Math.max(naturalRow, height / Math.max(1, totalRows));
  const background = ctx.color("token:background", "FFFFFF");
  const stripe = s.zebraColor ? ctx.color(s.zebraColor) : mixHex(ctx.color("token:muted", "888888"), s.background ? ctx.color(s.background) : background, 0.14);
  const border: PptxGenJS.BorderProps = s.borderWidth > 0 ? { type: "solid", pt: ctx.pt(s.borderWidth), color: ctx.color(s.borderColor) } : { type: "none" };
  const fontFace = ctx.font(s.fontFamily);
  const tableRtl = s.direction === "rtl" || (s.direction === "auto" && ctx.isRtl(content.rows.flat().join(" ") || content.columns.map((column) => column.label).join(" ")));
  const align = (value: "start" | "center" | "end", text: string): PptxGenJS.HAlign => {
    if (value === "center") return "center";
    const rtl = s.direction === "auto" ? ctx.isRtl(text) || (!/[A-Za-z0-9]/.test(text) && tableRtl) : s.direction === "rtl";
    return (value === "start") !== rtl ? "left" : "right";
  };
  const options = { language: ctx.doc.metadata.language, currency: ctx.doc.metadata.currency };
  const rows: PptxGenJS.TableRow[] = [];
  if (content.header) {
    rows.push(content.columns.map((column) => ({
      text: column.label,
      options: { bold: true, fill: { color: ctx.color(s.headerBackground) }, color: ctx.color(s.headerColor), align: align(column.align, column.label) },
    })));
  }
  bodyRows.forEach((row, r) => rows.push(content.columns.map((column, c) => {
    const value = formatTableCell(row[c] ?? "", column.format, options);
    return {
      text: value,
      options: {
        align: align(column.align, value),
        fill: s.zebra && r % 2 === 1 ? { color: stripe } : s.background ? { color: ctx.color(s.background) } : undefined,
      },
    };
  })));
  const weights = content.columns.map((column) => column.width ?? 1);
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  // Column order is visual: right-to-left tables start at the right edge, so reverse for PowerPoint.
  const ordered = tableRtl ? rows.map((row) => [...row].reverse()) : rows;
  const colW = (tableRtl ? [...weights].reverse() : weights).map((weight) => (weight / total) * ctx.box.w);
  ctx.slide.addTable(ordered, {
    x: ctx.box.x, y: ctx.box.y, w: ctx.box.w, colW, rowH: inch(rowH),
    fontFace, fontSize: ctx.pt(s.fontSize), color: ctx.color(s.color), valign: "middle",
    border, margin: inch(padding), autoPage: false,
  });
}
