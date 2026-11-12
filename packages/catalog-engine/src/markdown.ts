/**
 * A small, dependency-free reading of GitHub-flavored markdown into blocks of styled runs.
 * The renderer uses react-markdown for display; this parser serves the places that need plain
 * data instead (PowerPoint export, outlines for AI agents, layer names). Raw HTML is never kept:
 * tags are dropped and only their text survives.
 */

export interface MarkdownRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  /** Only http(s), mailto and tel links are kept. */
  href?: string;
}

export type MarkdownTableAlign = "left" | "center" | "right" | null;

export type MarkdownBlock =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; runs: MarkdownRun[] }
  | { kind: "paragraph"; runs: MarkdownRun[] }
  | { kind: "list-item"; ordered: boolean; number: number; depth: number; checked?: boolean; runs: MarkdownRun[] }
  | { kind: "quote"; runs: MarkdownRun[] }
  | { kind: "code"; text: string; language?: string }
  | { kind: "rule" }
  | { kind: "table"; header: MarkdownRun[][]; rows: MarkdownRun[][][]; align: MarkdownTableAlign[] };

/** A starter document for new markdown elements. */
export const SAMPLE_MARKDOWN = `# Release notes

Write **markdown** here: *emphasis*, \`code\` and [links](https://example.com).

- Bulleted lists
- [x] Task lists
- [ ] Tables, quotes and code blocks

| Plan | Price |
| --- | ---: |
| Basic | $9 |
| Pro | $29 |
`;

const SAFE_LINK = /^(https?:|mailto:|tel:)/i;
const HTML_TAG = /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>|<!--[\s\S]*?-->/g;

type Marks = Omit<MarkdownRun, "text">;

const INLINE = new RegExp(
  [
    "(`+)([\\s\\S]*?[^`])\\1(?!`)", // 1,2 code span
    "\\*\\*([\\s\\S]+?)\\*\\*", // 3 bold
    "__([\\s\\S]+?)__", // 4 bold
    "~~([\\s\\S]+?)~~", // 5 strike
    "\\*([^*\\s](?:[\\s\\S]*?[^*\\s])?)\\*", // 6 italic
    "(?<![A-Za-z0-9])_([^_\\s](?:[\\s\\S]*?[^_\\s])?)_(?![A-Za-z0-9])", // 7 italic
    "(!?)\\[([^\\]]*)\\]\\(\\s*<?((?:[^()\\s<>]|\\([^()\\s]*\\))*)>?(?:\\s+[\"'][^\"']*[\"'])?\\s*\\)", // 8,9,10 link / image
    "<((?:https?:\\/\\/|mailto:)[^>\\s]+)>", // 11 autolink
    "\\\\([\\\\`*_{}\\[\\]()#+\\-.!~|<>])", // 12 escape
  ].join("|"),
  "g",
);

function pushText(out: MarkdownRun[], text: string, marks: Marks) {
  if (!text) return;
  const last = out[out.length - 1];
  const same = last && last.bold === marks.bold && last.italic === marks.italic && last.strike === marks.strike && last.code === marks.code && last.href === marks.href;
  if (same) last.text += text;
  else out.push({ text, ...Object.fromEntries(Object.entries(marks).filter(([, value]) => value !== undefined && value !== false)) });
}

/** Inline markdown (emphasis, code, links) into runs. */
export function parseMarkdownInline(source: string, marks: Marks = {}, out: MarkdownRun[] = []): MarkdownRun[] {
  const text = source.replace(HTML_TAG, "");
  let last = 0;
  INLINE.lastIndex = 0;
  const pattern = new RegExp(INLINE.source, "g");
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    pushText(out, text.slice(last, match.index), marks);
    last = match.index + match[0].length;
    if (match[2] !== undefined) pushText(out, match[2].trim() ? match[2].replace(/^ (.*) $/, "$1") : match[2], { ...marks, code: true });
    else if (match[3] !== undefined || match[4] !== undefined) parseMarkdownInline(match[3] ?? match[4]!, { ...marks, bold: true }, out);
    else if (match[5] !== undefined) parseMarkdownInline(match[5], { ...marks, strike: true }, out);
    else if (match[6] !== undefined || match[7] !== undefined) parseMarkdownInline(match[6] ?? match[7]!, { ...marks, italic: true }, out);
    else if (match[9] !== undefined) {
      const href = match[10] && SAFE_LINK.test(match[10]) ? match[10] : undefined;
      if (match[8] === "!") pushText(out, match[9], marks);
      else parseMarkdownInline(match[9], { ...marks, ...(href ? { href } : {}) }, out);
    } else if (match[11] !== undefined) pushText(out, match[11], { ...marks, href: match[11] });
    else if (match[12] !== undefined) pushText(out, match[12], marks);
  }
  pushText(out, text.slice(last), marks);
  return out;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>[ ]?(.*)$/;
const LIST = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const TASK = /^\[([ xX])\][ \t]+/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

function splitTableRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < row.length; i++) {
    const char = row[i]!;
    if (char === "\\" && row[i + 1] === "|") {
      current += "|";
      i++;
    } else if (char === "|") {
      cells.push(current.trim());
      current = "";
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}

/** Block structure of a markdown document. */
export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    const text = paragraph.join(" ").trim();
    paragraph = [];
    if (text) blocks.push({ kind: "paragraph", runs: parseMarkdownInline(text) });
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      const marker = fence[1]!;
      for (i++; i < lines.length && !lines[i]!.trimStart().startsWith(marker); i++) body.push(lines[i]!);
      blocks.push({ kind: "code", text: body.join("\n"), ...(fence[2] ? { language: fence[2] } : {}) });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1]!.length as 1, runs: parseMarkdownInline(heading[2] ?? "") });
      continue;
    }
    if (RULE.test(line)) {
      // "text\n---" is a setext heading.
      if (paragraph.length && /^ {0,3}-+\s*$/.test(line)) {
        const text = paragraph.join(" ");
        paragraph = [];
        blocks.push({ kind: "heading", level: 2, runs: parseMarkdownInline(text) });
        continue;
      }
      flush();
      blocks.push({ kind: "rule" });
      continue;
    }
    if (paragraph.length && /^ {0,3}=+\s*$/.test(line)) {
      const text = paragraph.join(" ");
      paragraph = [];
      blocks.push({ kind: "heading", level: 1, runs: parseMarkdownInline(text) });
      continue;
    }
    const quote = QUOTE.exec(line);
    if (quote) {
      flush();
      const body = [quote[1]!];
      while (i + 1 < lines.length && QUOTE.test(lines[i + 1]!)) body.push(QUOTE.exec(lines[++i]!)![1]!);
      blocks.push({ kind: "quote", runs: parseMarkdownInline(body.map((part) => part.replace(/^>\s?/, "")).join(" ").trim()) });
      continue;
    }
    const list = LIST.exec(line);
    if (list) {
      flush();
      const indent = list[1]!.replace(/\t/g, "    ").length;
      const marker = list[2]!;
      let text = list[3]!;
      const task = TASK.exec(text);
      if (task) text = text.slice(task[0].length);
      // Lazy continuation lines belong to the item.
      while (i + 1 < lines.length && lines[i + 1]!.trim() && /^\s{2,}\S/.test(lines[i + 1]!) && !LIST.exec(lines[i + 1]!)) text += ` ${lines[++i]!.trim()}`;
      const ordered = /\d/.test(marker);
      blocks.push({
        kind: "list-item", ordered, number: ordered ? Number.parseInt(marker, 10) : 0, depth: Math.min(5, Math.floor(indent / 2)),
        ...(task ? { checked: task[1] !== " " } : {}), runs: parseMarkdownInline(text.trim()),
      });
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && TABLE_DELIMITER.test(lines[i + 1]!) && lines[i + 1]!.includes("-")) {
      flush();
      const header = splitTableRow(line);
      const align = splitTableRow(lines[i + 1]!).map((cell): MarkdownTableAlign => cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : cell.startsWith(":") ? "left" : null);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i]!.trim() && lines[i]!.includes("|"); i++) rows.push(splitTableRow(lines[i]!));
      i--;
      blocks.push({
        kind: "table",
        header: header.map((cell) => parseMarkdownInline(cell)),
        rows: rows.map((row) => header.map((_, index) => parseMarkdownInline(row[index] ?? ""))),
        align: header.map((_, index) => align[index] ?? null),
      });
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

const runsText = (runs: MarkdownRun[]) => runs.map((run) => run.text).join("");

/** Readable plain text of a markdown document: one line per block, list markers and table cells kept. */
export function markdownToPlainText(markdown: string): string {
  return parseMarkdownBlocks(markdown)
    .map((block) => {
      switch (block.kind) {
        case "heading":
        case "paragraph":
        case "quote":
          return runsText(block.runs);
        case "list-item":
          return `${"  ".repeat(block.depth)}${block.checked === undefined ? "" : block.checked ? "[x] " : "[ ] "}${block.ordered ? `${block.number}. ` : "• "}${runsText(block.runs)}`;
        case "code":
          return block.text;
        case "rule":
          return "";
        case "table":
          return [block.header, ...block.rows].map((row) => row.map(runsText).join(" | ")).join("\n");
      }
    })
    .filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== ""))
    .join("\n")
    .trim();
}

/** The first heading (or first line) of a markdown document, for layer names. */
export function markdownTitle(markdown: string): string {
  const blocks = parseMarkdownBlocks(markdown);
  const heading = blocks.find((block) => block.kind === "heading");
  const first = heading ?? blocks.find((block) => "runs" in block);
  return first && "runs" in first ? runsText(first.runs).trim() : "";
}
