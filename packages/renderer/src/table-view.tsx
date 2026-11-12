import { formatTableCell, resolveToken, type CatalogDocument, type TableElement } from "@Kavero/catalog-engine";
import type { CSSProperties } from "react";

export const TABLE_DENSITY = { compact: 0.6, normal: 1, comfortable: 1.5 } as const;
export const TABLE_LINE_HEIGHT = 1.3;

/** Estimated height of a table (document pixels), used to decide whether rows are clipped. */
export function estimateTableHeight(element: Pick<TableElement, "content" | "style">) {
  const s = element.style;
  const padding = s.cellPadding * TABLE_DENSITY[s.density];
  const row = s.fontSize * TABLE_LINE_HEIGHT + padding * 2 + s.borderWidth;
  return row * (element.content.rows.length + (element.content.header ? 1 : 0)) + s.borderWidth;
}

/** Column widths in percent; columns without a width share the space equally. */
export function tableColumnPercents(columns: TableElement["content"]["columns"]) {
  const weights = columns.map((column) => column.width ?? 1);
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  return weights.map((weight) => (weight / total) * 100);
}

export interface TableViewProps {
  element: TableElement;
  doc: CatalogDocument;
  /** Live element height while resizing; defaults to the stored one. */
  height?: number;
}

/**
 * A real HTML table that fills its element box: rows stretch to the box height, and when there
 * are more rows than fit, the rest is clipped behind a short fade.
 */
export function TableView({ element, doc, height = element.position.height }: TableViewProps) {
  const { content, style: s } = element;
  const color = (value: string) => resolveToken(doc, value);
  const text = color(s.color);
  const border = s.borderWidth > 0 ? `${s.borderWidth}px solid ${color(s.borderColor)}` : "none";
  const padding = s.cellPadding * TABLE_DENSITY[s.density];
  const stripe = s.zebraColor ? color(s.zebraColor) : `color-mix(in srgb, ${color("token:muted")} 14%, transparent)`;
  const overflowing = estimateTableHeight(element) > height + 1;
  const widths = tableColumnPercents(content.columns);
  const dir = s.direction === "auto" ? undefined : s.direction;
  const cell: CSSProperties = {
    padding: `${padding}px ${padding * 1.2}px`, border, verticalAlign: "middle", whiteSpace: "pre-wrap", overflowWrap: "anywhere",
    lineHeight: TABLE_LINE_HEIGHT, overflow: "hidden",
  };
  const options = { language: doc.metadata.language, currency: doc.metadata.currency };
  return (
    <div
      data-table=""
      style={{
        width: "100%", height: "100%", overflow: "hidden", boxSizing: "border-box",
        ...(overflowing ? { maskImage: "linear-gradient(to bottom, #000 calc(100% - 3em), transparent)", WebkitMaskImage: "linear-gradient(to bottom, #000 calc(100% - 3em), transparent)" } : {}),
      }}
    >
      <table
        dir={dir}
        style={{
          width: "100%", height: overflowing ? undefined : "100%", tableLayout: "fixed", borderCollapse: "collapse", borderSpacing: 0,
          fontFamily: `${resolveToken(doc, s.fontFamily, "fonts")}, system-ui, sans-serif`, fontSize: s.fontSize, color: text,
          background: s.background ? color(s.background) : undefined,
        }}
      >
        <colgroup>{widths.map((width, index) => <col key={content.columns[index]!.id} style={{ width: `${width}%` }} />)}</colgroup>
        {content.header && (
          <thead>
            <tr>
              {content.columns.map((column) => (
                <th key={column.id} dir="auto" scope="col" style={{ ...cell, textAlign: column.align, fontWeight: 600, background: color(s.headerBackground), color: color(s.headerColor) }}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {content.rows.map((row, r) => (
            <tr key={r} style={s.zebra && r % 2 === 1 ? { background: stripe } : undefined}>
              {content.columns.map((column, c) => (
                <td key={column.id} dir="auto" style={{ ...cell, textAlign: column.align, fontVariantNumeric: column.format === "text" ? undefined : "tabular-nums" }}>
                  {formatTableCell(row[c] ?? "", column.format, options)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
