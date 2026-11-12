import { resolveToken, type CatalogDocument, type MarkdownElement } from "@Kavero/catalog-engine";
import type { CSSProperties, ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const SAFE_URL = /^(https?:|mailto:|tel:)/i;

/** Only web, mail and phone links survive; everything else (javascript:, data:, relative) is dropped. */
export function safeMarkdownUrl(url: string, key: string): string {
  const value = url.trim();
  if (key === "src") return /^https:/i.test(value) ? value : "";
  return SAFE_URL.test(value) ? value : "";
}

const HEADING_SCALE = [2, 1.6, 1.3, 1.12, 1, 0.9] as const;
const remarkPlugins = [remarkGfm];

export interface MarkdownViewProps {
  markdown: string;
  doc: CatalogDocument;
  style: MarkdownElement["style"];
  /** Links are only followed in "present" mode. */
  mode: "edit" | "present";
}

/**
 * GitHub-flavored markdown for slides: headings, emphasis, lists and task lists, links, code,
 * quotes, tables and rules. Raw HTML in the source is skipped and link/image URLs are filtered,
 * so markdown can never inject markup or scripts. Sizes are relative to `baseFontSize`.
 */
export function MarkdownView({ markdown, doc, style: s, mode }: MarkdownViewProps) {
  const color = (value: string) => resolveToken(doc, value);
  const text = color(s.color);
  const headingColor = color(s.headingColor);
  const linkColor = color(s.linkColor);
  const dir = s.direction === "auto" ? "auto" : s.direction;
  const rule = `color-mix(in srgb, ${text} 22%, transparent)`;
  const subtle = `color-mix(in srgb, ${text} 8%, transparent)`;
  const block: CSSProperties = { margin: "0 0 0.6em" };
  const heading = (level: 1 | 2 | 3 | 4 | 5 | 6) => ({ children }: { children?: ReactNode }) => {
    const Tag = `h${level}` as const;
    return (
      <Tag dir={dir} style={{
        margin: level <= 2 ? "0.2em 0 0.45em" : "0.2em 0 0.35em", fontSize: `${HEADING_SCALE[level - 1]}em`, lineHeight: 1.2, fontWeight: level <= 3 ? 700 : 600,
        fontFamily: `${resolveToken(doc, s.headingFontFamily, "fonts")}, system-ui, sans-serif`, color: headingColor,
      }}>{children}</Tag>
    );
  };
  const components: Components = {
    h1: heading(1), h2: heading(2), h3: heading(3), h4: heading(4), h5: heading(5), h6: heading(6),
    p: ({ children }) => <p dir={dir} style={block}>{children}</p>,
    a: ({ href, children }) => mode === "present" && href
      ? <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: linkColor, textDecoration: "underline", textUnderlineOffset: "0.15em" }}>{children}</a>
      : <span style={{ color: linkColor, textDecoration: "underline", textUnderlineOffset: "0.15em" }}>{children}</span>,
    ul: ({ children, className }) => <ul dir={dir} style={{ ...block, paddingInlineStart: className?.includes("contains-task-list") ? "0.4em" : "1.4em", listStyleType: className?.includes("contains-task-list") ? "none" : undefined }}>{children}</ul>,
    ol: ({ children, start }) => <ol dir={dir} start={start} style={{ ...block, paddingInlineStart: "1.6em" }}>{children}</ol>,
    li: ({ children }) => <li style={{ margin: "0.15em 0" }}>{children}</li>,
    input: ({ checked }) => (
      <span aria-hidden style={{
        display: "inline-grid", placeItems: "center", width: "0.85em", height: "0.85em", marginInlineEnd: "0.4em", verticalAlign: "-0.08em",
        border: `0.08em solid ${checked ? linkColor : rule}`, borderRadius: "0.18em", background: checked ? linkColor : "transparent",
        color: resolveToken(doc, "token:on-primary"), fontSize: "0.9em", lineHeight: 1,
      }}>{checked ? "✓" : ""}</span>
    ),
    blockquote: ({ children }) => <blockquote dir={dir} style={{ ...block, padding: "0.1em 0 0.1em 0.9em", marginInline: 0, borderInlineStart: `0.22em solid ${rule}`, opacity: 0.85 }}>{children}</blockquote>,
    code: ({ children, className }) => className?.startsWith("language-") || String(children).includes("\n")
      ? <code style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" }}>{children}</code>
      : <code style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: "0.88em", padding: "0.1em 0.35em", borderRadius: "0.3em", background: subtle }}>{children}</code>,
    pre: ({ children }) => <pre dir="ltr" style={{ ...block, padding: "0.7em 0.9em", borderRadius: "0.45em", background: subtle, fontSize: "0.85em", lineHeight: 1.45, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{children}</pre>,
    hr: () => <hr style={{ border: 0, borderTop: `0.08em solid ${rule}`, margin: "0.9em 0" }} />,
    table: ({ children }) => <table dir={dir} style={{ ...block, borderCollapse: "collapse", width: "100%", fontSize: "0.92em" }}>{children}</table>,
    th: ({ children, style }) => <th style={{ textAlign: (style as CSSProperties | undefined)?.textAlign ?? "start", padding: "0.3em 0.6em", borderBottom: `0.1em solid ${rule}`, fontWeight: 600 }}>{children}</th>,
    td: ({ children, style }) => <td style={{ textAlign: (style as CSSProperties | undefined)?.textAlign ?? "start", padding: "0.3em 0.6em", borderBottom: `0.06em solid ${rule}` }}>{children}</td>,
    img: ({ src, alt }) => typeof src === "string" && src
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={src} alt={alt ?? ""} referrerPolicy="no-referrer" style={{ maxWidth: "100%", height: "auto", verticalAlign: "middle" }} />
      : <span>{alt}</span>,
  };
  return (
    <div
      data-markdown=""
      dir={s.direction === "auto" ? undefined : s.direction}
      style={{
        width: "100%", height: "100%", overflow: "hidden", boxSizing: "border-box", overflowWrap: "break-word",
        fontFamily: `${resolveToken(doc, s.fontFamily, "fonts")}, system-ui, sans-serif`,
        fontSize: s.baseFontSize, lineHeight: s.lineHeight, color: text, textAlign: s.align,
        background: s.background ? color(s.background) : undefined, padding: s.background ? "0.6em 0.8em" : undefined,
      }}
    >
      <Markdown remarkPlugins={remarkPlugins} skipHtml urlTransform={safeMarkdownUrl} components={components}>{markdown}</Markdown>
    </div>
  );
}
