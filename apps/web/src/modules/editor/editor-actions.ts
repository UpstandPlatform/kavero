"use client";

import { createBlankSlide, createId, type CatalogElement, type CatalogSlide } from "@Kavero/catalog-engine";
import type { Editor, EditorCommand, NewElement } from "@Kavero/editor-core";
import { toast } from "sonner";

/** Platform-aware shortcut labels: ⌘ on macOS, Ctrl elsewhere. */
export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const kbd = (combo: string) => (isMac ? combo.replace(/Ctrl\+/g, "⌘").replace(/Alt\+/g, "⌥").replace(/Shift\+/g, "⇧") : combo);

/** Every editor shortcut, for menus and the shortcuts dialog (the handler lives in useEditorKeyboard). */
export const SHORTCUTS: { group: string; keys: string; label: string }[] = [
  { group: "Edit", keys: "Ctrl+Z", label: "Undo" },
  { group: "Edit", keys: "Ctrl+Shift+Z", label: "Redo" },
  { group: "Edit", keys: "Ctrl+C", label: "Copy" },
  { group: "Edit", keys: "Ctrl+X", label: "Cut" },
  { group: "Edit", keys: "Ctrl+V", label: "Paste (also images and text from other apps)" },
  { group: "Edit", keys: "Ctrl+D", label: "Duplicate" },
  { group: "Edit", keys: "Delete", label: "Delete" },
  { group: "Edit", keys: "Ctrl+Alt+C", label: "Copy style" },
  { group: "Edit", keys: "Ctrl+Alt+V", label: "Paste style" },
  { group: "Select", keys: "Ctrl+A", label: "Select all" },
  { group: "Select", keys: "Esc", label: "Deselect" },
  { group: "Select", keys: "Tab", label: "Select next element (Shift+Tab: previous)" },
  { group: "Select", keys: "Shift+Click", label: "Add to / remove from selection" },
  { group: "Arrange", keys: "Ctrl+G", label: "Group" },
  { group: "Arrange", keys: "Ctrl+Shift+G", label: "Ungroup" },
  { group: "Arrange", keys: "Ctrl+]", label: "Bring forward" },
  { group: "Arrange", keys: "Ctrl+[", label: "Send backward" },
  { group: "Arrange", keys: "Ctrl+Shift+]", label: "Bring to front" },
  { group: "Arrange", keys: "Ctrl+Shift+[", label: "Send to back" },
  { group: "Arrange", keys: "Ctrl+Shift+L", label: "Lock / unlock" },
  { group: "Arrange", keys: "Ctrl+Shift+H", label: "Hide / show" },
  { group: "Arrange", keys: "Arrows", label: "Nudge 1 px (Shift: 10 px)" },
  { group: "Align", keys: "Alt+A / Alt+H / Alt+D", label: "Align left / center / right" },
  { group: "Align", keys: "Alt+W / Alt+V / Alt+S", label: "Align top / middle / bottom" },
  { group: "Slides", keys: "PageUp / PageDown", label: "Previous / next slide" },
  { group: "Slides", keys: "Ctrl+M", label: "New slide" },
  { group: "Slides", keys: "Ctrl+Shift+D", label: "Duplicate slide" },
  { group: "View", keys: "Ctrl+= / Ctrl+-", label: "Zoom in / out" },
  { group: "View", keys: "Ctrl+0", label: "Zoom to fit" },
  { group: "View", keys: "?", label: "Show shortcuts" },
  { group: "Canvas", keys: "Double-click", label: "Edit text" },
  { group: "Canvas", keys: "Alt+Drag", label: "Move without snapping" },
  { group: "Canvas", keys: "Shift+Drag", label: "Move on one axis / keep proportions" },
  { group: "Canvas", keys: "Right-click", label: "Context menu" },
];

// ---------- Clipboard ----------

type Clip = { kind: "elements"; elements: CatalogElement[] } | { kind: "slide"; slide: CatalogSlide };
let memory: Clip | null = null;
let styleClip: { type: CatalogElement["type"]; style: Record<string, unknown>; opacity: number } | null = null;
const MARK = "application/x-kavero";

/** Serialize for the system clipboard so copy/paste works across tabs and catalogs. */
export function clipText(clip: Clip) {
  return JSON.stringify({ [MARK]: 1, ...clip });
}

export function parseClip(text: string): Clip | null {
  try {
    const v = JSON.parse(text);
    if (v?.[MARK] === 1 && (v.kind === "elements" || v.kind === "slide")) return v as Clip;
  } catch {
    // not ours
  }
  return null;
}

export function setClipboard(clip: Clip, event?: ClipboardEvent) {
  memory = clip;
  const text = clipText(clip);
  if (event?.clipboardData) {
    event.clipboardData.setData("text/plain", text);
    event.preventDefault();
  } else {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  }
}

export function hasClipboard() {
  return !!memory;
}

// ---------- Actions ----------

export interface ActionDeps {
  editor: Editor;
  run: (c: EditorCommand) => { createdIds: string[] } | null;
  uploadImage: (f: File) => Promise<{ assetId: string; width: number; height: number }>;
}

/** All selection/slide operations, shared by the keyboard, context menus and the layers panel. */
export function createActions({ editor, run, uploadImage }: ActionDeps) {
  const doc = () => editor.getDocument();
  const slide = () => doc().slides.find((s) => s.id === editor.getState().activeSlideId)!;
  const selected = () => {
    const ids = new Set(editor.getState().selection);
    return slide().elements.filter((e) => ids.has(e.id));
  };
  const unlocked = () => selected().filter((e) => !e.locked);
  const batch = (commands: EditorCommand[]) => (commands.length ? run(commands.length === 1 ? commands[0]! : { type: "batch", commands }) : null);
  const { width: W, height: H } = doc().settings;

  function pasteElements(elements: CatalogElement[], at?: { x: number; y: number }, offset = 20) {
    const minX = Math.min(...elements.map((e) => e.position.x));
    const minY = Math.min(...elements.map((e) => e.position.y));
    const groups = new Map<string, string>();
    const known = new Set(doc().assets.map((a) => a.id));
    const missing = elements.some((e) => (e.type === "image" && !known.has(e.content.assetId)));
    // Add bottom-to-top without the copied zIndex, so copies land on top in the same order.
    const r = batch([...elements].sort((p, q) => p.zIndex - q.zIndex).map((el) => {
      const { id: _id, zIndex: _z, ...rest } = el;
      const dx = at ? at.x - minX : offset;
      const dy = at ? at.y - minY : offset;
      const groupId = el.groupId ? (groups.get(el.groupId) ?? groups.set(el.groupId, createId("grp")).get(el.groupId)) : undefined;
      return { type: "element.add", slideId: slide().id, element: { ...rest, groupId, morphKey: el.morphKey ?? el.id, animations: rest.animations.map((a) => ({ ...a, id: createId("anim") })), position: { ...el.position, x: el.position.x + dx, y: el.position.y + dy } } as NewElement };
    }));
    if (r) editor.select(r.createdIds);
    if (missing) toast.message("Some pasted images belong to another catalog and show as placeholders.");
    return r;
  }

  const a = {
    selected,
    hasSelection: () => selected().length > 0,

    copy(event?: ClipboardEvent) {
      const els = selected();
      if (!els.length) return false;
      setClipboard({ kind: "elements", elements: structuredClone(els) }, event);
      return true;
    },
    cut(event?: ClipboardEvent) {
      if (!a.copy(event)) return;
      a.remove();
    },
    /** Paste Kavero elements/slides, else images or text from other apps. */
    async paste(event?: ClipboardEvent, at?: { x: number; y: number }) {
      const data = event?.clipboardData;
      const files = data ? [...data.files].filter((f) => f.type.startsWith("image/")) : [];
      if (files.length) {
        event?.preventDefault();
        for (const file of files) {
          try {
            const { assetId, width, height } = await uploadImage(file);
            const k = Math.min((W * 0.5) / width, (H * 0.6) / height, 1);
            const w = Math.round(width * k), h = Math.round(height * k);
            const pos = at ?? { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2) };
            const r = run({ type: "element.add", slideId: slide().id, element: { type: "image", position: { ...pos, width: w, height: h, rotation: 0 }, content: { assetId, alt: file.name.replace(/\.[^.]+$/, "") } } as unknown as NewElement });
            if (r) editor.select(r.createdIds);
          } catch (e) {
            toast.error((e as Error).message);
          }
        }
        return;
      }
      let text = data?.getData("text/plain") ?? "";
      if (!event && !text) text = await navigator.clipboard?.readText().catch(() => "") ?? "";
      const clip = (text && parseClip(text)) || (!text ? memory : null);
      if (clip) {
        event?.preventDefault();
        if (clip.kind === "elements") pasteElements(clip.elements, at);
        else a.pasteSlide(clip.slide);
        return;
      }
      if (text.trim()) {
        event?.preventDefault();
        const lines = text.replace(/\r/g, "").split("\n").slice(0, 200);
        const w = Math.round(W * 0.5), h = Math.round(Math.min(H * 0.6, 40 + lines.length * H * 0.04));
        const pos = at ?? { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2) };
        const r = run({ type: "element.add", slideId: slide().id, element: { type: "text", position: { ...pos, width: w, height: h, rotation: 0 }, content: { paragraphs: lines.map((t) => [{ text: t }]) }, style: { fontSize: Math.round(H * 0.025) } } as unknown as NewElement });
        if (r) editor.select(r.createdIds);
      }
    },
    duplicate() {
      const els = selected();
      if (els.length) pasteElements(structuredClone(els));
    },
    remove() {
      batch(selected().map((e) => ({ type: "element.delete", elementId: e.id })));
    },
    selectAll() {
      editor.select(slide().elements.filter((e) => !e.hidden).map((e) => e.id));
    },
    selectSameType() {
      const types = new Set(selected().map((e) => e.type));
      editor.select(slide().elements.filter((e) => types.has(e.type) && !e.hidden).map((e) => e.id));
    },
    selectNone: () => editor.select([]),
    /** Cycle selection through visible elements in stacking order. */
    selectNext(dir: 1 | -1) {
      const els = [...slide().elements].filter((e) => !e.hidden).sort((x, y) => x.zIndex - y.zIndex);
      if (!els.length) return;
      const cur = els.findIndex((e) => e.id === editor.getState().selection[0]);
      editor.select([els[(cur + dir + els.length) % els.length]!.id]);
    },
    group() {
      const els = selected();
      if (els.length > 1) batch([{ type: "element.group", elementIds: els.map((e) => e.id) }]);
    },
    ungroup() {
      const ids = new Set(selected().map((e) => e.groupId).filter(Boolean) as string[]);
      batch([...ids].map((groupId) => ({ type: "element.ungroup", groupId })));
    },
    order(to: "front" | "back" | "forward" | "backward") {
      const els = [...selected()].sort((x, y) => (to === "front" || to === "backward" ? x.zIndex - y.zIndex : y.zIndex - x.zIndex));
      batch(els.map((e) => ({ type: "element.reorder", elementId: e.id, to })));
    },
    toggleLock() {
      const els = selected();
      const lock = !els.every((e) => e.locked);
      batch(els.map((e) => ({ type: "element.update", elementId: e.id, changes: { locked: lock } })));
    },
    toggleHide() {
      const els = selected();
      const hide = !els.every((e) => e.hidden);
      batch(els.map((e) => ({ type: "element.update", elementId: e.id, changes: { hidden: hide } })));
    },
    setFlag(id: string, flag: "locked" | "hidden", value: boolean) {
      run({ type: "element.update", elementId: id, changes: { [flag]: value } });
    },
    rename(id: string, name: string) {
      run({ type: "element.update", elementId: id, changes: { name: name.trim() || undefined } });
    },
    nudge(dx: number, dy: number) {
      batch(unlocked().map((e) => ({ type: "element.move", elementId: e.id, position: { x: e.position.x + dx, y: e.position.y + dy } })));
    },
    /** One element aligns to the slide; several align to their shared bounds. */
    align(how: "l" | "c" | "r" | "t" | "m" | "b") {
      const els = unlocked();
      if (!els.length) return;
      const box = els.length === 1 ? { x0: 0, y0: 0, x1: W, y1: H } : {
        x0: Math.min(...els.map((e) => e.position.x)), y0: Math.min(...els.map((e) => e.position.y)),
        x1: Math.max(...els.map((e) => e.position.x + e.position.width)), y1: Math.max(...els.map((e) => e.position.y + e.position.height)),
      };
      batch(els.map((e) => {
        const p = e.position;
        const x = how === "l" ? box.x0 : how === "c" ? (box.x0 + box.x1 - p.width) / 2 : how === "r" ? box.x1 - p.width : p.x;
        const y = how === "t" ? box.y0 : how === "m" ? (box.y0 + box.y1 - p.height) / 2 : how === "b" ? box.y1 - p.height : p.y;
        return { type: "element.move", elementId: e.id, position: { x: Math.round(x), y: Math.round(y) } };
      }));
    },
    distribute(axis: "x" | "y") {
      const els = [...unlocked()].sort((p, q) => p.position[axis] - q.position[axis]);
      if (els.length < 3) return;
      const size = axis === "x" ? "width" : "height";
      const start = els[0]!.position[axis];
      const end = Math.max(...els.map((e) => e.position[axis] + e.position[size]));
      const gap = (end - start - els.reduce((n, e) => n + e.position[size], 0)) / (els.length - 1);
      let at = start;
      batch(els.map((e) => {
        const c: EditorCommand = { type: "element.move", elementId: e.id, position: { [axis]: Math.round(at) } };
        at += e.position[size] + gap;
        return c;
      }));
    },
    centerOnSlide() {
      a.align("c");
      a.align("m");
    },
    fillSlide() {
      batch(unlocked().map((e) => ({ type: "element.move", elementId: e.id, position: { x: 0, y: 0, width: W, height: H, rotation: 0 } })));
    },
    resetRotation() {
      batch(unlocked().map((e) => ({ type: "element.move", elementId: e.id, position: { rotation: 0 } })));
    },
    copyStyle() {
      const el = selected()[0];
      if (!el) return;
      styleClip = { type: el.type, style: structuredClone(el.style as Record<string, unknown>), opacity: el.opacity };
      toast.message("Style copied");
    },
    canPasteStyle: () => !!styleClip,
    pasteStyle() {
      if (!styleClip) return;
      const clip = styleClip;
      const targets = selected().filter((e) => e.type === clip.type);
      if (!targets.length) return toast.message(`The copied style is for ${clip.type} elements`);
      batch(targets.map((e) => ({ type: "element.update", elementId: e.id, changes: { style: clip.style, opacity: clip.opacity } })));
    },

    // ---------- Slides ----------
    addSlide(afterIndex?: number) {
      const i = afterIndex ?? doc().slides.findIndex((s) => s.id === slide().id);
      const r = run({ type: "slide.add", slide: createBlankSlide(`Slide ${doc().slides.length + 1}`), index: i + 1 });
      if (r?.createdIds[0]) editor.setActiveSlide(r.createdIds[0]);
    },
    duplicateSlide(slideId = slide().id) {
      const r = run({ type: "slide.duplicate", slideId });
      if (r?.createdIds[0]) editor.setActiveSlide(r.createdIds[0]);
    },
    deleteSlide(slideId = slide().id) {
      if (doc().slides.length > 1) run({ type: "slide.delete", slideId });
    },
    moveSlide(slideId: string, toIndex: number) {
      run({ type: "slide.move", slideId, toIndex });
    },
    renameSlide(slideId: string, name: string) {
      if (name.trim()) run({ type: "slide.update", slideId, changes: { name: name.trim() } });
    },
    copySlide(slideId = slide().id) {
      const s = doc().slides.find((x) => x.id === slideId);
      if (s) setClipboard({ kind: "slide", slide: structuredClone(s) });
      toast.message("Slide copied");
    },
    pasteSlide(source?: CatalogSlide) {
      const s = source ?? (memory?.kind === "slide" ? memory.slide : null);
      if (!s) return;
      const i = doc().slides.findIndex((x) => x.id === slide().id);
      const groups = new Map<string, string>();
      const copy: CatalogSlide = {
        ...structuredClone(s), id: createId("sld"), name: `${s.name} copy`,
        elements: s.elements.map((e) => ({
          ...structuredClone(e), id: createId("el"), animations: e.animations.map((x) => ({ ...x, id: createId("anim") })),
          groupId: e.groupId ? (groups.get(e.groupId) ?? groups.set(e.groupId, createId("grp")).get(e.groupId)) : undefined,
        })),
      };
      const r = run({ type: "slide.add", slide: copy, index: i + 1 });
      if (r?.createdIds[0]) editor.setActiveSlide(r.createdIds[0]);
    },
    hasSlideClip: () => memory?.kind === "slide",
  };
  return a;
}

export type EditorActions = ReturnType<typeof createActions>;
