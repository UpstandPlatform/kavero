import {
  catalogAssetSchema,
  catalogElementSchema,
  catalogSlideSchema,
  productSchema,
  createBlankSlide,
  createId,
  elementAnimationSchema,
  slideTransitionSchema,
  type CatalogAsset,
  type CatalogDocument,
  type CatalogElement,
  type CatalogSlide,
  type ElementAnimation,
  type ElementPosition,
  type Product,
  type SlideTransition,
} from "@Kavero/catalog-engine";

/** Distributive Omit so each union member keeps its own shape. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type NewElement = DistributiveOmit<CatalogElement, "id"> & { id?: string };

export type EditorCommand =
  | { type: "catalog.updateMetadata"; changes: Partial<CatalogDocument["metadata"]> }
  | { type: "catalog.updateTheme"; theme: Partial<CatalogDocument["theme"]> }
  | { type: "slide.add"; slide?: Partial<CatalogSlide>; index?: number }
  | { type: "slide.update"; slideId: string; changes: Partial<Omit<CatalogSlide, "id" | "elements">> }
  | { type: "slide.delete"; slideId: string }
  | { type: "slide.move"; slideId: string; toIndex: number }
  | { type: "slide.duplicate"; slideId: string }
  | { type: "slide.setTransition"; slideId: string; transition: Partial<SlideTransition> | null }
  | { type: "element.add"; slideId: string; element: NewElement }
  | { type: "element.update"; elementId: string; changes: Record<string, unknown> }
  | { type: "element.move"; elementId: string; position: Partial<ElementPosition> }
  | { type: "element.delete"; elementId: string }
  | { type: "element.reorder"; elementId: string; to: "front" | "back" | "forward" | "backward" }
  /** Move an element to an exact stacking position (0 = bottom), e.g. from the layers panel. */
  | { type: "element.setZ"; elementId: string; index: number }
  | { type: "element.group"; elementIds: string[] }
  | { type: "element.ungroup"; groupId: string }
  | { type: "element.addAnimation"; elementId: string; animation: Omit<Partial<ElementAnimation>, "id"> & Pick<ElementAnimation, "category" | "preset"> }
  | { type: "element.removeAnimation"; elementId: string; animationId: string }
  | { type: "asset.add"; asset: CatalogAsset }
  | { type: "asset.remove"; assetId: string }
  | { type: "product.upsert"; product: Omit<Partial<Product>, "id"> & { id?: string; name: string } }
  | { type: "product.delete"; productId: string }
  | { type: "batch"; commands: EditorCommand[]; label?: string };

export interface CommandResult {
  /** Ids created by the command (slides, elements, animations, groups). */
  createdIds: string[];
}

export class CommandError extends Error {}

function findSlide(doc: CatalogDocument, slideId: string): CatalogSlide {
  const slide = doc.slides.find((s) => s.id === slideId);
  if (!slide) throw new CommandError(`Slide "${slideId}" not found`);
  return slide;
}

function findElement(doc: CatalogDocument, elementId: string): { slide: CatalogSlide; index: number; element: CatalogElement } {
  for (const slide of doc.slides) {
    const index = slide.elements.findIndex((e) => e.id === elementId);
    if (index >= 0) return { slide, index, element: slide.elements[index]! };
  }
  throw new CommandError(`Element "${elementId}" not found`);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge(target: Record<string, unknown>, changes: Record<string, unknown>): Record<string, unknown> {
  const out = { ...target };
  for (const [k, v] of Object.entries(changes)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k] as Record<string, unknown>, v) : v;
  }
  return out;
}

function normalizeZ(slide: CatalogSlide) {
  slide.elements.sort((a, b) => a.zIndex - b.zIndex).forEach((e, i) => (e.zIndex = i));
}

/** Apply a command to a draft document in place. The draft must be a private copy. */
export function applyCommand(doc: CatalogDocument, cmd: EditorCommand): CommandResult {
  const created: string[] = [];
  switch (cmd.type) {
    case "catalog.updateMetadata":
      doc.metadata = { ...doc.metadata, ...cmd.changes };
      if (!doc.metadata.title) throw new CommandError("Title cannot be empty");
      break;
    case "catalog.updateTheme":
      doc.theme = {
        colors: { ...doc.theme.colors, ...cmd.theme.colors },
        fonts: { ...doc.theme.fonts, ...cmd.theme.fonts },
      };
      break;
    case "slide.add": {
      const slide = catalogSlideSchema.parse({ ...createBlankSlide(), ...cmd.slide, id: cmd.slide?.id ?? createId("sld") });
      if (doc.slides.some((s) => s.id === slide.id)) throw new CommandError(`Slide id "${slide.id}" already exists`);
      const index = cmd.index ?? doc.slides.length;
      doc.slides.splice(Math.max(0, Math.min(index, doc.slides.length)), 0, slide);
      created.push(slide.id);
      break;
    }
    case "slide.update": {
      const slide = findSlide(doc, cmd.slideId);
      Object.assign(slide, catalogSlideSchema.parse({ ...slide, ...cmd.changes }));
      break;
    }
    case "slide.delete": {
      if (doc.slides.length <= 1) throw new CommandError("A catalog needs at least one slide");
      const i = doc.slides.findIndex((s) => s.id === cmd.slideId);
      if (i < 0) throw new CommandError(`Slide "${cmd.slideId}" not found`);
      doc.slides.splice(i, 1);
      break;
    }
    case "slide.move": {
      const i = doc.slides.findIndex((s) => s.id === cmd.slideId);
      if (i < 0) throw new CommandError(`Slide "${cmd.slideId}" not found`);
      const [slide] = doc.slides.splice(i, 1);
      doc.slides.splice(Math.max(0, Math.min(cmd.toIndex, doc.slides.length)), 0, slide!);
      break;
    }
    case "slide.duplicate": {
      const i = doc.slides.findIndex((s) => s.id === cmd.slideId);
      if (i < 0) throw new CommandError(`Slide "${cmd.slideId}" not found`);
      const copy = structuredClone(doc.slides[i]!);
      copy.id = createId("sld");
      copy.name = `${copy.name} copy`;
      const groups = new Map<string, string>();
      for (const el of copy.elements) {
        // Remember the original so the Morph transition can move it between the two slides.
        el.morphKey = el.morphKey ?? el.id;
        el.id = createId("el");
        for (const a of el.animations) a.id = createId("anim");
        if (el.groupId) el.groupId = groups.get(el.groupId) ?? groups.set(el.groupId, createId("grp")).get(el.groupId);
      }
      // A duplicate usually continues the same scene: morph into it unless a transition was chosen.
      if (!copy.transition || copy.transition.type === "none") copy.transition = slideTransitionSchema.parse({ type: "morph", durationMs: 900 });
      doc.slides.splice(i + 1, 0, copy);
      created.push(copy.id);
      break;
    }
    case "slide.setTransition": {
      const slide = findSlide(doc, cmd.slideId);
      if (cmd.transition === null) delete slide.transition;
      else slide.transition = slideTransitionSchema.parse({ ...slide.transition, ...cmd.transition });
      break;
    }
    case "element.add": {
      const slide = findSlide(doc, cmd.slideId);
      const element = catalogElementSchema.parse({
        ...cmd.element,
        zIndex: cmd.element.zIndex ?? slide.elements.length,
        id: cmd.element.id ?? createId("el"),
      });
      if (doc.slides.some((s) => s.elements.some((e) => e.id === element.id))) {
        throw new CommandError(`Element id "${element.id}" already exists`);
      }
      slide.elements.push(element);
      normalizeZ(slide);
      created.push(element.id);
      break;
    }
    case "element.update": {
      const { slide, index, element } = findElement(doc, cmd.elementId);
      if ("id" in cmd.changes || "type" in cmd.changes) throw new CommandError("Cannot change element id or type");
      slide.elements[index] = catalogElementSchema.parse(deepMerge(element as Record<string, unknown>, cmd.changes));
      break;
    }
    case "element.move": {
      const { element } = findElement(doc, cmd.elementId);
      if (element.locked) throw new CommandError("Element is locked");
      element.position = { ...element.position, ...cmd.position };
      break;
    }
    case "element.delete": {
      const { slide, index } = findElement(doc, cmd.elementId);
      slide.elements.splice(index, 1);
      normalizeZ(slide);
      break;
    }
    case "element.reorder": {
      const { slide, element } = findElement(doc, cmd.elementId);
      normalizeZ(slide);
      const max = slide.elements.length - 1;
      const target = { front: max, back: 0, forward: Math.min(max, element.zIndex + 1), backward: Math.max(0, element.zIndex - 1) }[cmd.to];
      const ordered = slide.elements.filter((e) => e !== element);
      ordered.splice(target, 0, element);
      ordered.forEach((e, i) => (e.zIndex = i));
      break;
    }
    case "element.setZ": {
      const { slide, element } = findElement(doc, cmd.elementId);
      normalizeZ(slide);
      const ordered = slide.elements.filter((e) => e !== element);
      ordered.splice(Math.max(0, Math.min(cmd.index, ordered.length)), 0, element);
      ordered.forEach((e, i) => (e.zIndex = i));
      break;
    }
    case "element.group": {
      if (cmd.elementIds.length < 2) throw new CommandError("Select at least two elements to group");
      const found = cmd.elementIds.map((id) => findElement(doc, id));
      if (new Set(found.map((f) => f.slide.id)).size > 1) throw new CommandError("Grouped elements must be on the same slide");
      const groupId = createId("grp");
      for (const f of found) f.element.groupId = groupId;
      created.push(groupId);
      break;
    }
    case "element.ungroup":
      for (const s of doc.slides) for (const e of s.elements) if (e.groupId === cmd.groupId) delete e.groupId;
      break;
    case "element.addAnimation": {
      const { element } = findElement(doc, cmd.elementId);
      const anim = elementAnimationSchema.parse({ ...cmd.animation, id: createId("anim") });
      element.animations.push(anim);
      created.push(anim.id);
      break;
    }
    case "element.removeAnimation": {
      const { element } = findElement(doc, cmd.elementId);
      element.animations = element.animations.filter((a) => a.id !== cmd.animationId);
      break;
    }
    case "asset.add": {
      const asset = catalogAssetSchema.parse(cmd.asset);
      if (doc.assets.some((a) => a.id === asset.id)) throw new CommandError(`Asset "${asset.id}" already exists`);
      doc.assets.push(asset);
      created.push(asset.id);
      break;
    }
    case "asset.remove": {
      const used = JSON.stringify(doc.slides).includes(`"${cmd.assetId}"`) || doc.products.some((p) => p.imageAssetIds.includes(cmd.assetId));
      if (used) throw new CommandError("Asset is still in use");
      doc.assets = doc.assets.filter((a) => a.id !== cmd.assetId);
      break;
    }
    case "product.upsert": {
      const i = cmd.product.id ? doc.products.findIndex((p) => p.id === cmd.product.id) : -1;
      const product = productSchema.parse(i >= 0 ? { ...doc.products[i], ...cmd.product } : { ...cmd.product, id: cmd.product.id ?? createId("prd") });
      if (i >= 0) doc.products[i] = product;
      else {
        doc.products.push(product);
        created.push(product.id);
      }
      break;
    }
    case "product.delete": {
      const used = doc.slides.some((s) => s.elements.some((e) =>
        (e.type === "product" && e.content.productId === cmd.productId) ||
        (e.type === "product-grid" && e.content.products.some((p) => p.productId === cmd.productId))));
      if (used) throw new CommandError("Product is still placed on a slide");
      doc.products = doc.products.filter((p) => p.id !== cmd.productId);
      break;
    }
    case "batch":
      for (const c of cmd.commands) created.push(...applyCommand(doc, c).createdIds);
      break;
  }
  return { createdIds: created };
}
