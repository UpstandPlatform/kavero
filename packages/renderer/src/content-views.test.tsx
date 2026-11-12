import { expect, test } from "bun:test";
import { catalogElementSchema, createCatalog, createTableContent, markdownStyleSchema, type TableElement } from "@Kavero/catalog-engine";
import { renderToStaticMarkup } from "react-dom/server";

import { MarkdownView } from "./markdown-view";
import { SlideView } from "./slide-view";
import { TableView, estimateTableHeight } from "./table-view";

const doc = createCatalog({ title: "T" });
const style = markdownStyleSchema.parse({});

test("markdown renders GFM and never raw HTML", () => {
  const html = renderToStaticMarkup(
    <MarkdownView
      doc={doc}
      style={style}
      mode="present"
      markdown={'# Title\n\n<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n- [x] done\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n[bad](javascript:alert(1)) [good](https://example.com) ~~old~~'}
    />,
  );
  expect(html).toContain("<h1");
  expect(html).toContain("<table");
  expect(html).toContain("<del>old</del>");
  expect(html).not.toContain("<script");
  expect(html).not.toContain("onerror");
  expect(html).not.toContain("javascript:");
  expect(html).toContain('href="https://example.com"');
  expect(html).toContain('rel="noopener noreferrer"');
});

test("markdown links are not clickable while editing", () => {
  const html = renderToStaticMarkup(<MarkdownView doc={doc} style={style} mode="edit" markdown="[x](https://example.com)" />);
  expect(html).not.toContain("<a ");
  expect(html).toContain(">x</span>");
});

test("table renders header, formatted cells and a fade when rows overflow", () => {
  const content = createTableContent([["Item", "Price"], ["Pen", "1234.5"]]);
  content.columns[1]!.format = "number";
  const element = catalogElementSchema.parse({ id: "t", type: "table", position: { x: 0, y: 0, width: 400, height: 400, rotation: 0 }, content }) as TableElement;
  const html = renderToStaticMarkup(<TableView element={element} doc={doc} />);
  expect(html).toContain("<th");
  expect(html).toContain("Item");
  expect(html).toContain("1,234.5");
  expect(html).not.toContain("mask-image");

  const long = { ...element, content: { ...content, rows: Array.from({ length: 60 }, (_, index) => [`Row ${index}`, "1"]) } };
  expect(estimateTableHeight(long)).toBeGreaterThan(400);
  expect(renderToStaticMarkup(<TableView element={long} doc={doc} />)).toContain("mask-image");
});

test("slides render markdown and table elements", () => {
  const slide = structuredClone(doc.slides[0]!);
  slide.elements.push(
    catalogElementSchema.parse({ id: "m", type: "markdown", position: { x: 0, y: 0, width: 300, height: 200, rotation: 0 }, content: { markdown: "**Hello**" } }),
    catalogElementSchema.parse({ id: "t", type: "table", position: { x: 0, y: 200, width: 300, height: 200, rotation: 0 }, content: createTableContent([["A"], ["1"]]) }),
  );
  const html = renderToStaticMarkup(<SlideView doc={doc} slide={slide} />);
  expect(html).toContain("<strong>Hello</strong>");
  expect(html).toContain("data-table");
});
