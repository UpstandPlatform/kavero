import { TEMPLATES, createId, type CatalogDocument } from "@Kavero/catalog-engine";
import { applyCommand, type EditorCommand, type NewElement } from "@Kavero/editor-core";
import { z } from "zod";

/**
 * AI edits are a small, closed set of operations (never code or raw JSON
 * patches). Each is turned into an editor command and dry-run on a copy, so
 * only valid changes are proposed to the user for approval.
 */
export const editOpSchema = z.object({
  op: z.enum(["set_text", "restyle_text", "move", "set_fill", "delete_element", "add_text", "add_shape", "set_background", "set_transition", "animate", "set_theme_color", "apply_template_theme", "add_slide"]),
  slideId: z.string().optional().describe("Target slide; defaults to the current slide"),
  elementId: z.string().optional(),
  text: z.string().max(2000).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  fontSize: z.number().optional(),
  fontWeight: z.number().optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  color: z.string().optional().describe("Hex color or theme token like token:primary"),
  shape: z.enum(["rect", "ellipse", "triangle", "line"]).optional(),
  transition: z.enum(["none", "fade", "slide", "push", "zoom", "wipe"]).optional(),
  preset: z.enum(["fade", "slide", "scale", "bounce", "blur", "float", "pulse"]).optional(),
  category: z.enum(["entrance", "emphasis", "exit"]).optional(),
  themeColor: z.enum(["background", "text", "muted", "primary", "on-primary", "accent"]).optional(),
  templateId: z.string().optional(),
  name: z.string().max(80).optional(),
});
export const editPlanSchema = z.object({
  summary: z.string().max(400).describe("One or two sentences describing the change, for the user to approve"),
  ops: z.array(editOpSchema).max(40),
});
export type EditOp = z.infer<typeof editOpSchema>;
export type EditPlan = z.infer<typeof editPlanSchema>;

export const EDITOR_SYSTEM = `You edit slides in Kavero, a visual catalog builder, by returning a short list of operations.

Operations (fields in parentheses):
- set_text (elementId, text): replace a text element's text (use \\n for new lines).
- restyle_text (elementId, fontSize?, fontWeight?, color?, align?)
- move (elementId, x?, y?, width?, height?): document pixels.
- set_fill (elementId, color): fill of a shape.
- delete_element (elementId)
- add_text (text, x, y, width, height, fontSize, fontWeight?, color?, align?, slideId?)
- add_shape (shape, x, y, width, height, color, slideId?)
- set_background (color, slideId?)
- set_transition (transition, slideId?)
- animate (elementId, preset, category)
- set_theme_color (themeColor, color): changes the color everywhere it's used.
- apply_template_theme (templateId): switch the whole catalog's colors and fonts.
- add_slide (name, slideId = id of the slide to insert after): adds an empty slide; follow with add_text/add_shape ops using the new slide's name as slideId.

Rules: use only element ids from the outline; keep everything inside the page; prefer theme tokens (token:primary, token:text, token:muted, token:accent, token:background, token:on-primary) over raw colors; make the minimal set of changes that fulfils the request; write a clear summary.`;

export function editorPrompt(doc: CatalogDocument, slideId: string, instruction: string) {
  const outline = {
    page: doc.settings,
    theme: doc.theme,
    templates: TEMPLATES.map((t) => t.id),
    currentSlideId: slideId,
    slides: doc.slides.map((s) => ({
      id: s.id, name: s.name, background: s.background, transition: s.transition?.type,
      elements: s.id === slideId || doc.slides.length <= 6
        ? s.elements.map((e) => ({
            id: e.id, type: e.type, position: e.position,
            text: e.type === "text" ? e.content.paragraphs.map((p) => p.map((r) => r.text).join("")).join("\n") : undefined,
            style: e.type === "text" ? { fontSize: e.style.fontSize, fontWeight: e.style.fontWeight, color: e.style.color, align: e.style.align } : e.type === "shape" ? { fill: e.style.fill } : undefined,
          }))
        : `${s.elements.length} elements`,
    })),
  };
  return `Catalog outline:\n${JSON.stringify(outline)}\n\nRequest: ${instruction}`;
}

/** Turn ops into editor commands, keeping only those that apply cleanly. */
export function opsToCommands(doc: CatalogDocument, currentSlideId: string, plan: EditPlan): { commands: EditorCommand[]; skipped: string[] } {
  const draft = structuredClone(doc);
  const commands: EditorCommand[] = [];
  const skipped: string[] = [];
  const nameToSlide = new Map<string, string>();
  const slideOf = (op: EditOp) => (op.slideId && (nameToSlide.get(op.slideId) ?? (draft.slides.some((s) => s.id === op.slideId) ? op.slideId : undefined))) ?? currentSlideId;
  const box = (op: EditOp) => ({ x: op.x ?? 80, y: op.y ?? 80, width: Math.max(10, op.width ?? 400), height: Math.max(10, op.height ?? 100), rotation: 0 });

  for (const op of plan.ops) {
    let cmd: EditorCommand | null = null;
    switch (op.op) {
      case "set_text":
        if (op.elementId && op.text !== undefined) cmd = { type: "element.update", elementId: op.elementId, changes: { content: { paragraphs: op.text.split("\n").map((t) => [{ text: t }]) } } };
        break;
      case "restyle_text": {
        const style = Object.fromEntries(Object.entries({ fontSize: op.fontSize, fontWeight: op.fontWeight && Math.round(op.fontWeight / 100) * 100, color: op.color, align: op.align }).filter(([, v]) => v !== undefined));
        if (op.elementId && Object.keys(style).length) cmd = { type: "element.update", elementId: op.elementId, changes: { style } };
        break;
      }
      case "move": {
        const position = Object.fromEntries(Object.entries({ x: op.x, y: op.y, width: op.width, height: op.height }).filter(([, v]) => v !== undefined)) as Record<string, number>;
        if (op.elementId && Object.keys(position).length) cmd = { type: "element.move", elementId: op.elementId, position };
        break;
      }
      case "set_fill":
        if (op.elementId && op.color) cmd = { type: "element.update", elementId: op.elementId, changes: { style: { fill: op.color } } };
        break;
      case "delete_element":
        if (op.elementId) cmd = { type: "element.delete", elementId: op.elementId };
        break;
      case "add_text":
        if (op.text) cmd = { type: "element.add", slideId: slideOf(op), element: { type: "text", position: box(op), content: { paragraphs: op.text.split("\n").map((t) => [{ text: t }]) }, style: { fontSize: op.fontSize ?? 32, fontWeight: op.fontWeight ?? 400, color: op.color ?? "token:text", align: op.align ?? "left" } } as unknown as NewElement };
        break;
      case "add_shape":
        cmd = { type: "element.add", slideId: slideOf(op), element: { type: "shape", position: box(op), content: { shape: op.shape ?? "rect" }, style: { fill: op.color ?? "token:accent" } } as unknown as NewElement };
        break;
      case "set_background":
        if (op.color) cmd = { type: "slide.update", slideId: slideOf(op), changes: { background: { kind: "color", color: op.color } } };
        break;
      case "set_transition":
        if (op.transition) cmd = { type: "slide.setTransition", slideId: slideOf(op), transition: op.transition === "none" ? null : { type: op.transition } };
        break;
      case "animate":
        if (op.elementId) cmd = { type: "element.addAnimation", elementId: op.elementId, animation: { category: op.category ?? "entrance", preset: op.preset ?? "fade", trigger: "after-previous" } };
        break;
      case "set_theme_color":
        if (op.themeColor && op.color && /^#[0-9a-f]{6}$/i.test(op.color)) cmd = { type: "catalog.updateTheme", theme: { colors: { [op.themeColor]: op.color } } };
        break;
      case "apply_template_theme": {
        const t = TEMPLATES.find((x) => x.id === op.templateId);
        if (t) cmd = { type: "catalog.updateTheme", theme: structuredClone(t.theme) };
        break;
      }
      case "add_slide": {
        const id = createId("sld");
        const after = draft.slides.findIndex((s) => s.id === (op.slideId ?? currentSlideId));
        cmd = { type: "slide.add", index: after >= 0 ? after + 1 : undefined, slide: { id, name: op.name ?? "New slide" } };
        if (op.name) nameToSlide.set(op.name, id);
        break;
      }
    }
    if (!cmd) {
      skipped.push(`${op.op}: missing fields`);
      continue;
    }
    try {
      applyCommand(draft, cmd);
      commands.push(cmd);
    } catch (e) {
      skipped.push(`${op.op}: ${(e as Error).message}`);
    }
  }
  return { commands, skipped };
}
