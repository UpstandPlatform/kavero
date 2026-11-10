import { catalogElementSchema, type CatalogSlide } from "./schema";
import { createBlankSlide, createId } from "./document";

export type PresentationBlockKind = "section" | "quote" | "stats" | "agenda" | "feature" | "closing";

export const PRESENTATION_BLOCKS: { id: PresentationBlockKind; name: string; description: string }[] = [
  { id: "section", name: "Section title", description: "A bold divider to introduce the next part." },
  { id: "feature", name: "Feature overview", description: "Three clear benefit cards for one idea." },
  { id: "stats", name: "Key statistics", description: "Three metrics with space for context." },
  { id: "agenda", name: "Agenda", description: "A readable list for plans and contents." },
  { id: "quote", name: "Quote", description: "A prominent statement with attribution." },
  { id: "closing", name: "Closing slide", description: "A clean final slide with a call to action." },
];

/** Build an editable slide for one of the built-in presentation blocks. */
export function createBlockSlide(kind: PresentationBlockKind, name: string, width: number, height: number): CatalogSlide {
  const slide = { ...createBlankSlide(), id: createId("sld"), name };
  const m = Math.round(Math.min(width, height) * 0.09);
  const small = Math.round(Math.min(width, height) * 0.025);
  const large = Math.round(Math.min(width, height) * 0.072);
  const elements: CatalogSlide["elements"] = [];
  const addText = (text: string, x: number, y: number, w: number, h: number, style: Record<string, unknown> = {}) => {
    elements.push(catalogElementSchema.parse({
      id: createId("el"),
      type: "text",
      position: { x, y, width: w, height: h, rotation: 0 },
      content: { paragraphs: text.split("\n").map((line) => [{ text: line }]) },
      style: { fontFamily: "token:body", color: "token:text", fontSize: 28, ...style },
    }));
  };
  const addShape = (x: number, y: number, w: number, h: number, fill = "token:accent") => {
    elements.push(catalogElementSchema.parse({
      id: createId("el"),
      type: "shape",
      position: { x, y, width: w, height: h, rotation: 0 },
      content: { shape: "rect" },
      style: { fill, borderRadius: Math.round(small / 2) },
    }));
  };

  if (kind === "section") {
    addText("01  /  SECTION", m, m, width - 2 * m, small * 1.6, { fontSize: small, color: "token:muted", letterSpacing: 2, fontWeight: 600 });
    addText("A new chapter\nstarts here.", m, height * 0.32, width * 0.74, height * 0.36, { fontFamily: "token:heading", fontSize: large * 1.65, fontWeight: 700, lineHeight: 1.05 });
    addShape(m, height * 0.77, width * 0.17, Math.max(4, small * 0.18), "token:primary");
  } else if (kind === "quote") {
    addText("“", m, height * 0.12, width * 0.16, height * 0.22, { fontFamily: "token:heading", fontSize: large * 2, color: "token:primary" });
    addText("A thoughtful idea can change how people see the whole story.", m, height * 0.32, width - 2 * m, height * 0.36, { fontFamily: "token:heading", fontSize: large * 0.88, italic: true, lineHeight: 1.25 });
    addText("— Your name, role or source", m, height * 0.75, width * 0.72, small * 2, { fontSize: small, color: "token:muted" });
  } else if (kind === "stats") {
    addText("The impact, at a glance", m, m, width - 2 * m, height * 0.16, { fontFamily: "token:heading", fontSize: large, fontWeight: 700 });
    const gap = m * 0.35;
    const colW = (width - 2 * m - gap * 2) / 3;
    ["48%", "3.2×", "12k"].forEach((metric, i) => {
      const x = m + i * (colW + gap);
      addShape(x, height * 0.34, colW, height * 0.38, i === 1 ? "token:primary" : "token:accent");
      addText(metric, x + small, height * 0.39, colW - 2 * small, height * 0.14, { fontFamily: "token:heading", fontSize: large * 1.2, fontWeight: 700, color: i === 1 ? "token:on-primary" : "token:text" });
      addText(["Growth", "Reach", "Customers"][i]!, x + small, height * 0.57, colW - 2 * small, height * 0.1, { fontSize: small, color: i === 1 ? "token:on-primary" : "token:muted" });
    });
  } else if (kind === "agenda") {
    addText("Today’s agenda", m, m, width - 2 * m, height * 0.16, { fontFamily: "token:heading", fontSize: large, fontWeight: 700 });
    ["Welcome and introductions", "What we learned", "The plan ahead", "Questions and discussion"].forEach((label, i) => {
      const y = height * 0.3 + i * height * 0.14;
      addText(String(i + 1).padStart(2, "0"), m, y, width * 0.08, height * 0.08, { fontSize: small, color: "token:primary", fontWeight: 700 });
      addText(label, m + width * 0.1, y, width * 0.74, height * 0.08, { fontSize: Math.round(large * 0.48), fontWeight: 500 });
      addShape(m + width * 0.1, y + height * 0.085, width * 0.74, Math.max(2, small * 0.08), "token:accent");
    });
  } else if (kind === "feature") {
    addText("A better way to move forward", m, m, width - 2 * m, height * 0.16, { fontFamily: "token:heading", fontSize: large, fontWeight: 700 });
    ["Made for people", "Clear by design", "Ready to grow"].forEach((label, i) => {
      const gap = m * 0.28;
      const colW = (width - 2 * m - gap * 2) / 3;
      const x = m + i * (colW + gap);
      addShape(x, height * 0.34, colW, height * 0.43, i === 1 ? "token:primary" : "token:accent");
      addText(`0${i + 1}`, x + small * 0.7, height * 0.39, colW - small, small * 1.5, { fontSize: small * 0.78, color: i === 1 ? "token:on-primary" : "token:primary", fontWeight: 700 });
      addText(label, x + small * 0.7, height * 0.5, colW - small * 1.4, height * 0.11, { fontSize: Math.round(small * 1.15), fontWeight: 700, color: i === 1 ? "token:on-primary" : "token:text" });
      addText("Add a short sentence about this point.", x + small * 0.7, height * 0.63, colW - small * 1.4, height * 0.12, { fontSize: Math.round(small * 0.68), color: i === 1 ? "token:on-primary" : "token:muted" });
    });
  } else {
    addText("Thank you", m, height * 0.28, width - 2 * m, height * 0.22, { fontFamily: "token:heading", fontSize: large * 1.4, fontWeight: 700, align: "center" });
    addText("Let’s keep the conversation going.", width * 0.2, height * 0.53, width * 0.6, height * 0.12, { fontSize: small * 0.9, color: "token:muted", align: "center" });
    addShape(width * 0.4, height * 0.72, width * 0.2, Math.max(6, small * 0.3), "token:primary");
  }

  return {
    ...slide,
    background: { kind: "color", color: "token:background" },
    elements,
  };
}
