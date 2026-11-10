"use client";

import type { CatalogElement, CatalogSlide, ElementPosition } from "@Kavero/catalog-engine";
import type { Editor, EditorState } from "@Kavero/editor-core";
import { SlideView, type ExtensionRendererRegistry } from "@Kavero/renderer";
import { Textarea } from "@Kavero/ui/components/textarea";
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";

import { useContextMenu } from "./context-menu";
import type { EditorActions } from "./editor-actions";
import { TooltipHint } from "@Kavero/ui/components/tooltip";
import { canvasMenu, elementMenu } from "./editor-menus";
import { useRun } from "./use-catalog-editor";

type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const HANDLES: Record<Handle, [number, number]> = {
  nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0],
};
const CURSORS: Record<Handle, string> = { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize" };
const SNAP_PX = 6;

type Gesture =
  | { kind: "move"; startX: number; startY: number; starts: Record<string, ElementPosition>; moved: boolean }
  | { kind: "resize"; id: string; handle: Handle; startX: number; startY: number; start: ElementPosition }
  | { kind: "rotate"; id: string; cx: number; cy: number; start: ElementPosition }
  | { kind: "marquee"; x0: number; y0: number; x1: number; y1: number; additive: string[] };

interface Guide { axis: "x" | "y"; at: number }

export interface CanvasProps {
  editor: Editor;
  state: EditorState;
  slide: CatalogSlide;
  assetUrls: Record<string, string>;
  zoom: number | "fit";
  onFitScale: (scale: number) => void;
  actions: EditorActions;
  annotationMode?: boolean;
  onAnnotateElement?: (slideId: string, elementId: string) => void;
  onAddElementsToChat?: (slideId: string, elementIds: string[]) => void;
  onCancelAnnotation?: () => void;
  highlightedAnnotation?: { slideId: string; elementId: string } | null;
  extensionRenderers?: ExtensionRendererRegistry;
}

export function Canvas({ editor, state, slide, assetUrls, zoom, onFitScale, actions, annotationMode = false, onAnnotateElement, onAddElementsToChat, onCancelAnnotation, highlightedAnnotation, extensionRenderers }: CanvasProps) {
  const openMenu = useContextMenu();
  const run = useRun(editor);
  const doc = state.document;
  const { width: W, height: H } = doc.settings;
  const wrapRef = useRef<HTMLDivElement>(null);
  const slideRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0.5);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Partial<ElementPosition>>>({});
  const [guides, setGuides] = useState<Guide[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Pointer capture during drags swallows native dblclick, so detect it ourselves.
  const lastDown = useRef<{ id: string; at: number } | null>(null);

  const scale = zoom === "fit" ? fit : zoom;
  const selected = new Set(state.selection);
  const elements = [...slide.elements].sort((a, b) => a.zIndex - b.zIndex);
  const pos = (el: CatalogElement): ElementPosition => ({ ...el.position, ...overrides[el.id] });

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      const s = Math.max(0.05, Math.min((width - 64) / W, (height - 64) / H));
      setFit(s);
      onFitScale(s);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H, onFitScale]);

  // Leave text editing when the slide or selection changes elsewhere.
  useEffect(() => {
    if (editingId && !slide.elements.some((e) => e.id === editingId)) setEditingId(null);
  }, [slide, editingId]);

  useEffect(() => {
    if (!annotationMode) return;
    if (document.activeElement instanceof HTMLTextAreaElement) document.activeElement.blur();
    setEditingId(null);
    setGesture(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCancelAnnotation?.();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [annotationMode, onCancelAnnotation]);

  /** Pointer position in document pixels. */
  function toDoc(e: { clientX: number; clientY: number }) {
    const r = slideRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  }

  function snapMove(ids: string[], starts: Record<string, ElementPosition>, dx: number, dy: number) {
    // Bounding box of the moving selection.
    const boxes = ids.map((id) => starts[id]!);
    const minX = Math.min(...boxes.map((b) => b.x)) + dx;
    const minY = Math.min(...boxes.map((b) => b.y)) + dy;
    const maxX = Math.max(...boxes.map((b) => b.x + b.width)) + dx;
    const maxY = Math.max(...boxes.map((b) => b.y + b.height)) + dy;
    const targetsX = [0, W / 2, W];
    const targetsY = [0, H / 2, H];
    for (const el of slide.elements) {
      if (ids.includes(el.id) || el.hidden) continue;
      const p = el.position;
      targetsX.push(p.x, p.x + p.width / 2, p.x + p.width);
      targetsY.push(p.y, p.y + p.height / 2, p.y + p.height);
    }
    const tol = SNAP_PX / scale;
    const found: Guide[] = [];
    const best = (edges: number[], targets: number[], axis: "x" | "y") => {
      let shift = 0, dist = Infinity, at = 0;
      for (const e of edges) for (const t of targets) {
        const d = Math.abs(t - e);
        if (d < tol && d < dist) { dist = d; shift = t - e; at = t; }
      }
      if (dist < Infinity) found.push({ axis, at });
      return shift;
    };
    const sx = best([minX, (minX + maxX) / 2, maxX], targetsX, "x");
    const sy = best([minY, (minY + maxY) / 2, maxY], targetsY, "y");
    return { dx: dx + sx, dy: dy + sy, guides: found };
  }

  function onElementDown(e: RPointerEvent, el: CatalogElement) {
    if (annotationMode) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      onAnnotateElement?.(slide.id, el.id);
      return;
    }
    if (e.button !== 0 || editingId === el.id) return;
    e.stopPropagation();
    const now = performance.now();
    const isDouble = lastDown.current?.id === el.id && now - lastDown.current.at < 400;
    lastDown.current = { id: el.id, at: now };
    if (isDouble && el.type === "text" && !el.locked && !e.shiftKey) {
      // Stop the follow-up mousedown from stealing focus from the new text box.
      e.preventDefault();
      editor.select([el.id]);
      setEditingId(el.id);
      return;
    }
    // Clicking any member of a group selects the whole group.
    const ids = el.groupId ? slide.elements.filter((x) => x.groupId === el.groupId).map((x) => x.id) : [el.id];
    let next = state.selection;
    if (e.shiftKey) {
      next = ids.every((id) => selected.has(id)) ? next.filter((id) => !ids.includes(id)) : [...new Set([...next, ...ids])];
      editor.select(next);
      return;
    }
    if (!ids.every((id) => selected.has(id))) {
      next = ids;
      editor.select(next);
    }
    const p = toDoc(e);
    const starts: Record<string, ElementPosition> = {};
    for (const x of slide.elements) if (next.includes(x.id) && !x.locked) starts[x.id] = x.position;
    if (!Object.keys(starts).length) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setGesture({ kind: "move", startX: p.x, startY: p.y, starts, moved: false });
  }

  function onBackgroundDown(e: RPointerEvent) {
    if (e.button !== 0) return;
    if (annotationMode) {
      e.preventDefault();
      return;
    }
    // Commit an open inline text edit first: unmounting the textarea wouldn't fire its blur.
    if (editingId && document.activeElement instanceof HTMLTextAreaElement) document.activeElement.blur();
    setEditingId(null);
    const p = toDoc(e);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    if (!e.shiftKey) editor.select([]);
    setGesture({ kind: "marquee", x0: p.x, y0: p.y, x1: p.x, y1: p.y, additive: e.shiftKey ? state.selection : [] });
  }

  function onHandleDown(e: RPointerEvent, el: CatalogElement, handle: Handle | "rotate") {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const p = toDoc(e);
    const start = el.position;
    if (handle === "rotate") setGesture({ kind: "rotate", id: el.id, cx: start.x + start.width / 2, cy: start.y + start.height / 2, start });
    else setGesture({ kind: "resize", id: el.id, handle, startX: p.x, startY: p.y, start });
  }

  function onPointerMove(e: RPointerEvent) {
    if (!gesture) return;
    const p = toDoc(e);
    switch (gesture.kind) {
      case "move": {
        const ids = Object.keys(gesture.starts);
        let dx = p.x - gesture.startX, dy = p.y - gesture.startY;
        if (!gesture.moved && Math.hypot(dx, dy) * scale < 3) return;
        if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
        const snapped = e.altKey ? { dx, dy, guides: [] } : snapMove(ids, gesture.starts, dx, dy);
        setGuides(snapped.guides);
        const o: typeof overrides = {};
        for (const id of ids) o[id] = { x: Math.round(gesture.starts[id]!.x + snapped.dx), y: Math.round(gesture.starts[id]!.y + snapped.dy) };
        setOverrides(o);
        if (!gesture.moved) setGesture({ ...gesture, moved: true });
        break;
      }
      case "resize": {
        const { start: s, handle } = gesture;
        const [hx, hy] = HANDLES[handle];
        const th = (s.rotation * Math.PI) / 180;
        const wdx = p.x - gesture.startX, wdy = p.y - gesture.startY;
        // Pointer delta in the element's own (unrotated) frame.
        const ldx = wdx * Math.cos(th) + wdy * Math.sin(th);
        const ldy = -wdx * Math.sin(th) + wdy * Math.cos(th);
        let w = Math.max(8, s.width + hx * ldx);
        let h = Math.max(8, s.height + hy * ldy);
        const el = slide.elements.find((x) => x.id === gesture.id);
        const keepRatio = hx !== 0 && hy !== 0 && (e.shiftKey || el?.type === "image");
        if (keepRatio && s.width > 0 && s.height > 0) {
          const r = s.width / s.height;
          if (w / h > r) h = w / r; else w = h * r;
        }
        // Keep the opposite edge fixed: shift the centre in local space, then rotate back.
        const lcx = (hx * (w - s.width)) / 2, lcy = (hy * (h - s.height)) / 2;
        const cx = s.x + s.width / 2 + lcx * Math.cos(th) - lcy * Math.sin(th);
        const cy = s.y + s.height / 2 + lcx * Math.sin(th) + lcy * Math.cos(th);
        setOverrides({ [gesture.id]: { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), width: Math.round(w), height: Math.round(h) } });
        break;
      }
      case "rotate": {
        let deg = (Math.atan2(p.y - gesture.cy, p.x - gesture.cx) * 180) / Math.PI + 90;
        deg = ((deg % 360) + 360) % 360;
        const step = e.shiftKey ? 15 : 0;
        if (step) deg = Math.round(deg / step) * step;
        else for (const a of [0, 90, 180, 270, 360]) if (Math.abs(deg - a) < 3) deg = a % 360;
        if (deg > 180) deg -= 360;
        setOverrides({ [gesture.id]: { rotation: Math.round(deg) } });
        break;
      }
      case "marquee": {
        const g = { ...gesture, x1: p.x, y1: p.y };
        setGesture(g);
        const [ax, bx] = [Math.min(g.x0, g.x1), Math.max(g.x0, g.x1)];
        const [ay, by] = [Math.min(g.y0, g.y1), Math.max(g.y0, g.y1)];
        const hit = slide.elements
          .filter((el) => !el.hidden && el.position.x < bx && el.position.x + el.position.width > ax && el.position.y < by && el.position.y + el.position.height > ay)
          .map((el) => el.id);
        editor.select([...new Set([...g.additive, ...hit])]);
        break;
      }
    }
  }

  function onPointerUp() {
    if (!gesture) return;
    if (gesture.kind !== "marquee" && Object.keys(overrides).length) {
      const commands = Object.entries(overrides).map(([elementId, position]) => ({ type: "element.move" as const, elementId, position }));
      run(commands.length === 1 ? commands[0]! : { type: "batch", commands });
    }
    setOverrides({});
    setGuides([]);
    setGesture(null);
  }

  const editingEl = editingId ? slide.elements.find((e) => e.id === editingId) : undefined;
  const single = state.selection.length === 1 ? slide.elements.find((e) => e.id === state.selection[0]) : undefined;
  const marquee = gesture?.kind === "marquee" ? gesture : null;

  return (
    <div ref={wrapRef} className={`relative h-full w-full overflow-auto bg-muted/40 ${annotationMode ? "cursor-crosshair" : ""}`} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      {annotationMode && (
        <div className="pointer-events-none absolute top-3 left-1/2 z-20 -translate-x-1/2 rounded-full border bg-background/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-md backdrop-blur">
          Select slide elements to attach to chat · Esc to finish
        </div>
      )}
      <div className="flex min-h-full min-w-full items-center justify-center p-8" style={{ width: W * scale + 64, height: H * scale + 64 }} onPointerDown={onBackgroundDown}
        onContextMenu={(e) => {
          if (e.target !== e.currentTarget && !(e.target as HTMLElement).closest("[data-slide-id]")) return;
          const p = toDoc(e);
          openMenu(e, canvasMenu(actions, { x: Math.round(p.x), y: Math.round(p.y) }));
        }}>
        <div ref={slideRef} className="relative shadow-lg ring-1 ring-black/10" style={{ width: W * scale, height: H * scale }}>
          <SlideView
            doc={doc}
            slide={slide}
            scale={scale}
            mode="edit"
            overrides={overrides}
            hiddenIds={editingId ? new Set([editingId]) : undefined}
            highlightedElementId={highlightedAnnotation?.slideId === slide.id ? highlightedAnnotation.elementId : undefined}
            resolveAsset={(id) => assetUrls[id]}
            extensionRenderers={extensionRenderers}
          />

          {/* Hit areas and selection chrome, in screen pixels over the scaled slide. */}
          <div className="absolute inset-0" style={{ touchAction: "none" }}>
            {elements.map((el) => {
              if (el.hidden) return null;
              const p = pos(el);
              const isSel = selected.has(el.id);
              const isAnnotationHighlighted = highlightedAnnotation?.slideId === slide.id && highlightedAnnotation.elementId === el.id;
              return (
                <div
                  key={el.id}
                  onPointerDown={(e) => onElementDown(e, el)}
                  onContextMenu={(e) => {
                    e.stopPropagation();
                    // Right-click selects what's under the pointer (its whole group) unless it's already selected.
                    const contextElementIds = selected.has(el.id)
                      ? state.selection
                      : el.groupId ? slide.elements.filter((x) => x.groupId === el.groupId).map((x) => x.id) : [el.id];
                    if (!selected.has(el.id)) editor.select(contextElementIds);
                    const p = toDoc(e);
                    openMenu(e, elementMenu(actions, {
                      at: { x: Math.round(p.x), y: Math.round(p.y) },
                      onAddToChat: () => onAddElementsToChat?.(slide.id, contextElementIds),
                    }));
                  }}
                  className={annotationMode ? "outline-2 outline-primary/40 hover:outline-primary" : isAnnotationHighlighted ? "outline-2 outline-primary" : isSel ? "outline-2 outline-sky-500" : "hover:outline-1 hover:outline-sky-400"}
                  style={{
                    position: "absolute", left: p.x * scale, top: p.y * scale, width: p.width * scale, height: p.height * scale,
                    transform: p.rotation ? `rotate(${p.rotation}deg)` : undefined,
                    cursor: annotationMode ? "crosshair" : el.locked ? "default" : "move", outlineStyle: annotationMode || isSel || isAnnotationHighlighted ? "solid" : undefined,
                  }}
                />
              );
            })}

            {!annotationMode && single && !single.locked && !gesture?.kind.startsWith("m") && editingId !== single.id && (
              <SelectionHandles position={pos(single)} scale={scale} onDown={(e, h) => onHandleDown(e, single, h)} />
            )}

            {guides.map((g, i) => (
              <div
                key={i}
                className="pointer-events-none absolute bg-fuchsia-500"
                style={g.axis === "x" ? { left: g.at * scale, top: 0, width: 1, height: H * scale } : { top: g.at * scale, left: 0, height: 1, width: W * scale }}
              />
            ))}

            {marquee && (
              <div
                className="pointer-events-none absolute border border-sky-500 bg-sky-500/10"
                style={{
                  left: Math.min(marquee.x0, marquee.x1) * scale, top: Math.min(marquee.y0, marquee.y1) * scale,
                  width: Math.abs(marquee.x1 - marquee.x0) * scale, height: Math.abs(marquee.y1 - marquee.y0) * scale,
                }}
              />
            )}

            {editingEl?.type === "text" && (
              <InlineTextEditor
                key={editingEl.id}
                element={editingEl}
                scale={scale}
                fontFamily={doc.theme.fonts[editingEl.style.fontFamily.replace("token:", "")] ?? editingEl.style.fontFamily}
                color={editingEl.style.color.startsWith("token:") ? (doc.theme.colors[editingEl.style.color.slice(6)] ?? "#000") : editingEl.style.color}
                onDone={(text) => {
                  setEditingId(null);
                  const current = editingEl.content.paragraphs.map((r) => r.map((x) => x.text).join("")).join("\n");
                  if (text === current) return;
                  // Plain-text edit keeps the first run's formatting for each paragraph.
                  const paragraphs = text.split("\n").map((line, i) => {
                    const { text: _t, ...fmt } = editingEl.content.paragraphs[i]?.[0] ?? editingEl.content.paragraphs[0]?.[0] ?? { text: "" };
                    return [{ ...fmt, text: line }];
                  });
                  run({ type: "element.update", elementId: editingEl.id, changes: { content: { paragraphs } } });
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SelectionHandles({ position: p, scale, onDown }: { position: ElementPosition; scale: number; onDown: (e: RPointerEvent, h: Handle | "rotate") => void }) {
  const w = p.width * scale, h = p.height * scale;
  return (
    <div
      className="pointer-events-none absolute"
      style={{ left: p.x * scale, top: p.y * scale, width: w, height: h, transform: p.rotation ? `rotate(${p.rotation}deg)` : undefined }}
    >
      {(Object.keys(HANDLES) as Handle[]).map((k) => {
        const [hx, hy] = HANDLES[k];
        return (
          <div
            key={k}
            onPointerDown={(e) => onDown(e, k)}
            className="pointer-events-auto absolute size-2.5 border border-sky-500 bg-white"
            style={{ left: ((hx + 1) / 2) * w - 5, top: ((hy + 1) / 2) * h - 5, cursor: CURSORS[k] }}
          />
        );
      })}
      <div className="absolute left-1/2 h-5 w-px -translate-x-1/2 bg-sky-500" style={{ top: -20 }} />
      <TooltipHint content="Rotate (Shift snaps to 15°)"><div
        onPointerDown={(e) => onDown(e, "rotate")}
        tabIndex={0}
        aria-label="Rotate element; hold Shift to snap to 15 degrees"
        className="pointer-events-auto absolute left-1/2 size-3 -translate-x-1/2 rounded-full border border-sky-500 bg-white"
        style={{ top: -26, cursor: "grab" }}
      /></TooltipHint>
    </div>
  );
}

function InlineTextEditor({
  element: el, scale, fontFamily, color, onDone,
}: { element: Extract<CatalogElement, { type: "text" }>; scale: number; fontFamily: string; color: string; onDone: (text: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const initial = el.content.paragraphs.map((r) => r.map((x) => x.text).join("")).join("\n");
  useEffect(() => {
    // Focus after the current pointer sequence finishes.
    const t = setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const s = el.style;
  const p = el.position;
  return (
    <Textarea
      ref={ref}
      dir={el.style.direction === "auto" ? "auto" : el.style.direction}
      defaultValue={initial}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => onDone(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) e.currentTarget.blur();
      }}
      className="absolute h-full min-h-0 resize-none overflow-hidden rounded-none border-0 bg-transparent p-0 shadow-none outline-2 outline-sky-500 focus-visible:border-0 focus-visible:ring-0"
      style={{
        left: p.x * scale, top: p.y * scale, width: p.width * scale, height: Math.max(p.height * scale, s.fontSize * s.lineHeight * scale),
        transform: p.rotation ? `rotate(${p.rotation}deg)` : undefined,
        fontFamily: `${fontFamily}, system-ui, sans-serif`, fontSize: s.fontSize * scale, fontWeight: s.fontWeight,
        lineHeight: s.lineHeight, letterSpacing: s.letterSpacing * scale, textAlign: s.align, color,
        fontStyle: s.italic ? "italic" : undefined,
      }}
    />
  );
}
