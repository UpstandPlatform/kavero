"use client";

import { mirrorHandle, pathToSvgD, type PathAnchor, type PathElement, type PathPoint, type PathVec } from "@Kavero/catalog-engine";
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";

/** Screen pixels within which a click lands on an anchor or handle. */
const HIT_PX = 8;
/** Pointer travel (screen px) before a click turns into a handle drag. */
const DRAG_PX = 3;

const sub = (a: PathVec, b: PathVec): PathVec => ({ x: a.x - b.x, y: a.y - b.y });

/** Snap `p` to the nearest 45° direction from `from` (Shift while drawing). */
function snap45(from: PathVec, p: PathVec): PathVec {
  const d = sub(p, from);
  const length = Math.hypot(d.x, d.y);
  if (!length) return p;
  const angle = Math.round(Math.atan2(d.y, d.x) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
}

/**
 * Pen tool overlay, laid over the slide while the pen is active.
 * Click adds a corner point, click-and-drag a smooth point with handles
 * (Alt breaks the handles apart), Shift snaps to 45°. Clicking the first point
 * closes the shape; Enter, Esc or double-click finishes an open path
 * (Esc with fewer than two points cancels). Backspace removes the last point.
 */
export function PenOverlay({ scale, width, height, toDoc, onFinish, onCancel }: {
  scale: number;
  width: number;
  height: number;
  /** Client → document pixels. */
  toDoc: (e: { clientX: number; clientY: number }) => PathVec;
  onFinish: (anchors: PathAnchor[], closed: boolean) => void;
  onCancel: () => void;
}) {
  const [anchors, setAnchors] = useState<PathAnchor[]>([]);
  const [hover, setHover] = useState<PathVec | null>(null);
  const drag = useRef<{ index: number; start: PathVec; screen: PathVec; moved: boolean } | null>(null);
  const lastDown = useRef<{ at: number; x: number; y: number } | null>(null);
  const anchorsRef = useRef(anchors);
  anchorsRef.current = anchors;
  // The key handler is registered once, so it reads the latest callbacks through a ref.
  const callbacks = useRef({ onFinish, onCancel });
  callbacks.current = { onFinish, onCancel };

  const finish = (closed = false) => {
    const current = anchorsRef.current;
    if (current.length < 2) return callbacks.current.onCancel();
    callbacks.current.onFinish(current, closed && current.length > 2);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") finish(false);
      else if (e.key === "Escape") finish(false);
      else if (e.key === "Backspace" || e.key === "Delete") setAnchors((current) => current.slice(0, -1));
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nearFirst = (p: PathVec) => anchors.length > 2 && Math.hypot(p.x - anchors[0]!.x, p.y - anchors[0]!.y) * scale <= HIT_PX;

  function onPointerDown(e: RPointerEvent<SVGSVGElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    let p = toDoc(e);
    const now = performance.now();
    const previousDown = lastDown.current;
    lastDown.current = { at: now, x: e.clientX, y: e.clientY };
    // Double-click: the first click already placed the last point, so just finish.
    if (previousDown && now - previousDown.at < 350 && Math.hypot(e.clientX - previousDown.x, e.clientY - previousDown.y) < 5) {
      lastDown.current = null;
      return finish(false);
    }
    if (nearFirst(p)) return finish(true);
    const last = anchors[anchors.length - 1];
    if (e.shiftKey && last) p = snap45(last, p);
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { index: anchors.length, start: p, screen: { x: e.clientX, y: e.clientY }, moved: false };
    setAnchors([...anchors, { x: p.x, y: p.y }]);
  }

  function onPointerMove(e: RPointerEvent<SVGSVGElement>) {
    const p = toDoc(e);
    const d = drag.current;
    if (!d) return setHover(p);
    if (!d.moved && Math.hypot(e.clientX - d.screen.x, e.clientY - d.screen.y) < DRAG_PX) return;
    d.moved = true;
    const out = sub(p, d.start);
    setAnchors((current) => current.map((anchor, i) => {
      if (i !== d.index) return anchor;
      // Dragging pulls out a symmetric pair of handles; Alt moves only the outgoing one (a cusp).
      return e.altKey
        ? { ...anchor, out, kind: "corner" }
        : { ...anchor, out, in: { x: -out.x, y: -out.y }, kind: "smooth" };
    }));
  }

  function onPointerUp() {
    drag.current = null;
  }

  const last = anchors[anchors.length - 1];
  const committed = anchors.length > 1 ? pathToSvgD(anchors, false) : "";
  const closing = hover ? nearFirst(hover) : false;
  const target = closing ? anchors[0]! : hover;
  // Rubber band from the last point to the pointer, following the last point's outgoing handle.
  const preview = last && target && !drag.current
    ? `M${last.x} ${last.y} C${last.x + (last.out?.x ?? 0)} ${last.y + (last.out?.y ?? 0)} ${target.x + (closing ? anchors[0]!.in?.x ?? 0 : 0)} ${target.y + (closing ? anchors[0]!.in?.y ?? 0 : 0)} ${target.x} ${target.y}`
    : "";
  const px = 1 / scale; // one screen pixel in document units
  return (
    <svg
      role="application"
      aria-label="Pen tool: click to add points, drag to curve, click the first point to close, Enter or Esc to finish"
      className="absolute inset-0 z-20"
      width={width * scale}
      height={height * scale}
      viewBox={`0 0 ${width} ${height}`}
      style={{ cursor: closing ? "pointer" : "crosshair", overflow: "visible", touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setHover(null)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <rect width={width} height={height} fill="transparent" />
      {committed && <path d={committed} fill="none" stroke="currentColor" className="text-sky-500" strokeWidth={2 * px} />}
      {preview && <path d={preview} fill="none" stroke="currentColor" className="text-sky-500" strokeWidth={1.5 * px} strokeDasharray={`${4 * px} ${3 * px}`} />}
      {anchors.map((anchor, i) => (
        <g key={i}>
          {[anchor.in, anchor.out].map((handle, h) => handle && (
            <g key={h}>
              <line x1={anchor.x} y1={anchor.y} x2={anchor.x + handle.x} y2={anchor.y + handle.y} stroke="currentColor" className="text-sky-500" strokeWidth={px} />
              <circle cx={anchor.x + handle.x} cy={anchor.y + handle.y} r={3 * px} fill="white" stroke="currentColor" className="text-sky-500" strokeWidth={px} />
            </g>
          ))}
          <rect
            x={anchor.x - 4 * px} y={anchor.y - 4 * px} width={8 * px} height={8 * px}
            fill={i === 0 && closing ? "currentColor" : "white"} stroke="currentColor" className="text-sky-500" strokeWidth={1.5 * px}
          />
        </g>
      ))}
    </svg>
  );
}

type DragTarget = { kind: "anchor" | "in" | "out"; index: number };

/**
 * Point editing for a selected path (double-click it): drag anchors and their
 * handles, Alt-drag a handle to break the symmetry, double-click an anchor to
 * toggle smooth/corner, Delete removes the selected point, Esc leaves.
 * Edits stream to `onDraft` for live rendering and commit once on release.
 */
export function PathPointEditor({ element, scale, slideRect, onDraft, onCommit, onDeletePoint, onExit }: {
  element: PathElement;
  scale: number;
  /** Bounding rect of the slide in client pixels (read lazily). */
  slideRect: () => DOMRect | undefined;
  onDraft: (points: PathPoint[] | null) => void;
  onCommit: (points: PathPoint[]) => void;
  onDeletePoint: (index: number) => void;
  onExit: () => void;
}) {
  const { x, y, width: w, height: h, rotation } = element.position;
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState<PathPoint[] | null>(null);
  const drag = useRef<{ target: DragTarget; startLocal: PathVec; startPoints: PathPoint[]; moved: boolean } | null>(null);
  const lastAnchorDown = useRef<{ index: number; at: number } | null>(null);
  const points = draft ?? element.content.points;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable=true]")) return;
      if (e.key === "Escape" || e.key === "Enter") onExit();
      else if ((e.key === "Delete" || e.key === "Backspace") && selectedRef.current !== null) {
        onDeletePoint(selectedRef.current);
        setSelected(null);
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onExit, onDeletePoint]);

  /** Client pixels → normalized coordinates of the element box, undoing its rotation. */
  function toLocal(e: { clientX: number; clientY: number }): PathVec {
    const r = slideRect();
    if (!r) return { x: 0, y: 0 };
    const cx = r.left + (x + w / 2) * scale;
    const cy = r.top + (y + h / 2) * scale;
    const th = (-rotation * Math.PI) / 180;
    const dx = (e.clientX - cx) / scale, dy = (e.clientY - cy) / scale;
    const lx = dx * Math.cos(th) - dy * Math.sin(th) + w / 2;
    const ly = dx * Math.sin(th) + dy * Math.cos(th) + h / 2;
    return { x: lx / Math.max(1, w), y: ly / Math.max(1, h) };
  }

  function down(e: RPointerEvent, target: DragTarget) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (target.kind === "anchor") {
      const now = performance.now();
      const previous = lastAnchorDown.current;
      lastAnchorDown.current = { index: target.index, at: now };
      if (previous?.index === target.index && now - previous.at < 400) {
        lastAnchorDown.current = null;
        return onCommit(toggleSmooth(points, target.index, element.content.closed));
      }
      setSelected(target.index);
    }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { target, startLocal: toLocal(e), startPoints: points, moved: false };
  }

  function move(e: RPointerEvent) {
    const d = drag.current;
    if (!d) return;
    const p = toLocal(e);
    const delta = sub(p, d.startLocal);
    if (!d.moved && Math.hypot(delta.x * w, delta.y * h) * scale < 2) return;
    d.moved = true;
    const next = d.startPoints.map((point, i) => {
      if (i !== d.target.index) return point;
      if (d.target.kind === "anchor") return { ...point, x: point.x + delta.x, y: point.y + delta.y };
      const handle = sub(p, point);
      const other = d.target.kind === "out" ? point.in : point.out;
      // Smooth points mirror the opposite handle (keeping its length); Alt breaks them into a corner.
      if (e.altKey) return { ...point, [d.target.kind]: handle, kind: "corner" as const };
      if (point.kind === "smooth") {
        const mirrored = denormalizedMirror(handle, other, w, h);
        return { ...point, [d.target.kind]: handle, [d.target.kind === "out" ? "in" : "out"]: mirrored };
      }
      return { ...point, [d.target.kind]: handle };
    });
    setDraft(next);
    onDraft(next);
  }

  function up() {
    const d = drag.current;
    drag.current = null;
    if (d?.moved && draft) onCommit(draft);
    setDraft(null);
    onDraft(null);
  }

  const S = (v: PathVec) => ({ x: v.x * w * scale, y: v.y * h * scale });
  const outline = pathToSvgD(points, element.content.closed, w * scale, h * scale);
  return (
    <div
      className="pointer-events-none absolute z-20"
      style={{ left: x * scale, top: y * scale, width: w * scale, height: h * scale, transform: rotation ? `rotate(${rotation}deg)` : undefined }}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <svg className="absolute inset-0 overflow-visible" width={w * scale} height={h * scale} aria-hidden>
        <path d={outline} fill="none" stroke="currentColor" className="text-sky-500" strokeWidth={1} />
        {points.map((point, i) => {
          const a = S(point);
          return [point.in, point.out].map((handle, k) => {
            if (!handle) return null;
            const end = S({ x: point.x + handle.x, y: point.y + handle.y });
            return <line key={`${i}-${k}`} x1={a.x} y1={a.y} x2={end.x} y2={end.y} stroke="currentColor" className="text-sky-500" strokeWidth={1} />;
          });
        })}
      </svg>
      {points.map((point, i) => {
        const a = S(point);
        return (
          <div key={i}>
            {(["in", "out"] as const).map((kind) => {
              const handle = point[kind];
              if (!handle) return null;
              const end = S({ x: point.x + handle.x, y: point.y + handle.y });
              return (
                <div
                  key={kind}
                  role="slider"
                  aria-label={`${kind === "in" ? "Incoming" : "Outgoing"} handle of point ${i + 1}`}
                  aria-valuenow={i}
                  onPointerDown={(e) => down(e, { kind, index: i })}
                  className="pointer-events-auto absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-sky-500 bg-white"
                  style={{ left: end.x, top: end.y, cursor: "grab" }}
                />
              );
            })}
            <div
              role="button"
              aria-pressed={selected === i}
              aria-label={`Path point ${i + 1}${point.kind === "smooth" ? " (smooth)" : ""}`}
              title="Drag to move · double-click: smooth/corner · Delete removes"
              onPointerDown={(e) => down(e, { kind: "anchor", index: i })}
              className={`pointer-events-auto absolute size-2.5 -translate-x-1/2 -translate-y-1/2 border border-sky-500 ${selected === i ? "bg-sky-500" : "bg-white"} ${point.kind === "smooth" ? "rounded-full" : ""}`}
              style={{ left: a.x, top: a.y, cursor: "move" }}
            />
          </div>
        );
      })}
    </div>
  );
}

/** Mirror a handle in pixel space (normalized coordinates of a non-square box would bend the line). */
function denormalizedMirror(handle: PathVec, other: PathVec | undefined, w: number, h: number): PathVec {
  const W = Math.max(1, w), H = Math.max(1, h);
  const m = mirrorHandle({ x: handle.x * W, y: handle.y * H }, other ? { x: other.x * W, y: other.y * H } : undefined, true);
  return { x: m.x / W, y: m.y / H };
}

/** Double-click on an anchor: drop its handles (corner) or derive smooth ones from its neighbours. */
function toggleSmooth(points: readonly PathPoint[], index: number, closed: boolean): PathPoint[] {
  return points.map((point, i) => {
    if (i !== index) return point;
    if (point.in || point.out) return { x: point.x, y: point.y, kind: "corner" as const };
    const n = points.length;
    const prev = points[i - 1] ?? (closed ? points[n - 1] : undefined) ?? point;
    const next = points[i + 1] ?? (closed ? points[0] : undefined) ?? point;
    // Catmull-Rom style tangent, a third of the way to each neighbour.
    const t = { x: (next.x - prev.x) / 6, y: (next.y - prev.y) / 6 };
    if (!t.x && !t.y) return point;
    return { ...point, in: { x: -t.x, y: -t.y }, out: t, kind: "smooth" as const };
  });
}
