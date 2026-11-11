import { createId } from "./document";
import { catalogElementSchema, type CatalogElement } from "./schema";

export const SLIDE_LAYOUTS = [
  { id: "title-slide", name: "Title slide", description: "Centered title and subtitle." },
  { id: "section-header", name: "Section header", description: "A clear divider for a new section." },
  { id: "title-body", name: "Title and body", description: "A title with one large content area." },
  { id: "title-two-columns", name: "Title and two columns", description: "A heading above two side-by-side content areas." },
  { id: "title-only", name: "Title only", description: "A title with the rest of the slide left open." },
  { id: "one-column-text", name: "One column text", description: "A title and a reading-friendly text column." },
  { id: "main-point", name: "Main point", description: "One concise statement in the center." },
  { id: "section-title-description", name: "Section title and description", description: "A section heading beside its description." },
  { id: "caption", name: "Caption", description: "A media area with a caption below it." },
  { id: "big-number", name: "Big number", description: "A prominent metric and supporting label." },
  { id: "blank", name: "Blank", description: "An empty slide." },
] as const;

export type SlideLayoutId = (typeof SLIDE_LAYOUTS)[number]["id"];

type Slot = {
  slot: NonNullable<CatalogElement["layoutSlot"]>;
  type?: "text" | "shape";
  text?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  align?: "start" | "center";
};

const title = (overrides: Partial<Slot> = {}): Slot => ({
  slot: "title", text: "Click to add title", x: 0.1, y: 0.09, width: 0.8, height: 0.18,
  fontSize: 68, fontWeight: 700, color: "token:text", ...overrides,
});
const body = (overrides: Partial<Slot> = {}): Slot => ({
  slot: "body", text: "Click to add text", x: 0.1, y: 0.31, width: 0.8, height: 0.56,
  fontSize: 32, color: "token:muted", ...overrides,
});

const DEFINITIONS: Record<SlideLayoutId, readonly Slot[]> = {
  "title-slide": [
    title({ y: 0.34, height: 0.16, fontSize: 72, align: "center" }),
    { slot: "subtitle", text: "Click to add subtitle", x: 0.16, y: 0.52, width: 0.68, height: 0.12, fontSize: 36, color: "token:muted", align: "center" },
  ],
  "section-header": [
    title({ y: 0.36, height: 0.18, fontSize: 64 }),
    { slot: "subtitle", text: "Click to add subtitle", x: 0.1, y: 0.57, width: 0.76, height: 0.12, fontSize: 30, color: "token:muted" },
  ],
  "title-body": [title(), body()],
  "title-two-columns": [
    title(),
    body({ slot: "left-column", x: 0.1, y: 0.32, width: 0.37, height: 0.56 }),
    body({ slot: "right-column", x: 0.53, y: 0.32, width: 0.37, height: 0.56 }),
  ],
  "title-only": [title()],
  "one-column-text": [title({ fontSize: 58 }), body({ y: 0.3, width: 0.72, fontSize: 29 })],
  "main-point": [
    { slot: "body", text: "Click to add a main point", x: 0.12, y: 0.29, width: 0.76, height: 0.38, fontSize: 56, fontWeight: 600, color: "token:text", align: "center" },
    { slot: "subtitle", text: "Click to add supporting detail", x: 0.2, y: 0.7, width: 0.6, height: 0.1, fontSize: 25, color: "token:muted", align: "center" },
  ],
  "section-title-description": [
    { slot: "section-title", text: "Click to add title", x: 0.08, y: 0.33, width: 0.36, height: 0.28, fontSize: 58, fontWeight: 700, color: "token:text" },
    { slot: "section-description", text: "Click to add description", x: 0.52, y: 0.34, width: 0.4, height: 0.3, fontSize: 29, color: "token:muted" },
  ],
  caption: [
    { slot: "media", type: "shape", x: 0.12, y: 0.1, width: 0.76, height: 0.68 },
    { slot: "caption", text: "Click to add caption", x: 0.12, y: 0.81, width: 0.76, height: 0.1, fontSize: 22, color: "token:muted", align: "center" },
  ],
  "big-number": [
    { slot: "number", text: "XX%", x: 0.12, y: 0.24, width: 0.76, height: 0.34, fontSize: 132, fontWeight: 700, color: "token:text", align: "center" },
    { slot: "subtitle", text: "Click to add a label", x: 0.18, y: 0.62, width: 0.64, height: 0.12, fontSize: 30, color: "token:muted", align: "center" },
  ],
  blank: [],
};

export function createSlideLayoutElements(layoutId: SlideLayoutId, width: number, height: number, idForIndex: (index: number) => string = () => createId("el")): CatalogElement[] {
  const scale = Math.min(width / 1920, height / 1080);
  return DEFINITIONS[layoutId].map((slot, zIndex) => {
    const position = {
      x: Math.round(slot.x * width), y: Math.round(slot.y * height),
      width: Math.round(slot.width * width), height: Math.round(slot.height * height), rotation: 0,
    };
    const base = { id: idForIndex(zIndex), zIndex, position, layoutSlot: slot.slot };
    if (slot.type === "shape") {
      return catalogElementSchema.parse({
        ...base, type: "shape", content: { shape: "rect" },
        opacity: 0.14,
        style: { fill: "token:muted", stroke: "token:muted", strokeWidth: 1, borderRadius: 8 },
      });
    }
    return catalogElementSchema.parse({
      ...base,
      type: "text",
      content: { paragraphs: [[{ text: slot.text ?? "" }]] },
      style: {
        fontFamily: "token:heading", fontSize: Math.round((slot.fontSize ?? 28) * scale),
        fontWeight: slot.fontWeight ?? 400, lineHeight: 1.2, letterSpacing: 0,
        align: slot.align ?? "start", color: slot.color ?? "token:text", direction: "auto",
      },
    });
  });
}
