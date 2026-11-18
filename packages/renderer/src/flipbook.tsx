import { documentDirection, type CatalogDocument } from "@Kavero/catalog-engine";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

import { SlideView, type AssetResolver, type ExtensionEffectRegistry, type ExtensionRendererRegistry } from "./slide-view";

/**
 * A page-turn flipbook view of a catalog: every slide is a page of a book with
 * a 3-D turn animation. Two pages side by side on wide screens, one page on
 * narrow ones. Turn with the on-screen buttons, arrow keys, click on a page
 * half, or by dragging a page. Self-contained (no third-party flip engine), so
 * it works both in the editor and in a standalone exported file.
 */
export interface FlipbookProps {
  doc: CatalogDocument;
  resolveAsset?: AssetResolver;
  extensionRenderers?: ExtensionRendererRegistry;
  extensionEffects?: ExtensionEffectRegistry;
  /** First page shown (0-based). */
  initialSlide?: number;
  onSlideChange?: (index: number) => void;
  className?: string;
}

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const TURN_MS = 620;

export function Flipbook({ doc, resolveAsset, extensionRenderers, extensionEffects, initialSlide = 0, onSlideChange, className }: FlipbookProps) {
  const { width: W, height: H } = doc.settings;
  const slides = doc.slides;
  const count = slides.length;
  const rtl = documentDirection(doc) === "rtl";

  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setBox({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const aspect = W / H;
  // Two pages fit side by side only when the box is clearly wider than two pages tall.
  const twoUp = count > 1 && box.w > box.h * aspect * 1.15;
  const margin = 24;
  const availW = Math.max(0, box.w - margin * 2);
  const availH = Math.max(0, box.h - margin * 2);
  const pageH = twoUp ? Math.min(availH, availW / (2 * aspect)) : Math.min(availH, availW / aspect);
  const pageW = pageH * aspect;
  const scale = pageW / W;

  // `leftIndex` is the page on the left of the open spread (two-up) or the page shown (single).
  // Two-up spreads are [0,1], [2,3]… so the left index is always even.
  const step = twoUp ? 2 : 1;
  const clampLeft = useCallback((i: number) => {
    const max = twoUp ? Math.max(0, count % 2 === 0 ? count - 2 : count - 1) : count - 1;
    return Math.min(max, Math.max(0, twoUp ? i - (i % 2) : i));
  }, [twoUp, count]);

  const [leftIndex, setLeftIndex] = useState(() => clampLeft(initialSlide));
  // Keep the spread valid when the layout switches between one and two pages.
  const lastTwoUp = useRef(twoUp);
  useEffect(() => {
    if (lastTwoUp.current !== twoUp) {
      lastTwoUp.current = twoUp;
      setLeftIndex((i) => clampLeft(i));
    }
  }, [twoUp, clampLeft]);

  // A turn in progress: `dir` 1 = forward (next), -1 = back. `progress` 0→1.
  const [turn, setTurn] = useState<{ dir: 1 | -1; progress: number; animating: boolean } | null>(null);
  const page = useCallback((i: number) => (i >= 0 && i < count ? slides[i] : null), [slides, count]);

  const canNext = leftIndex + step < count;
  const canPrev = leftIndex - step >= 0;

  const commit = useCallback((dir: 1 | -1) => {
    setLeftIndex((i) => clampLeft(i + dir * step));
    setTurn(null);
  }, [clampLeft, step]);

  const go = useCallback((dir: 1 | -1) => {
    if (turn) return;
    if (dir === 1 && !canNext) return;
    if (dir === -1 && !canPrev) return;
    if (prefersReducedMotion()) {
      commit(dir);
      return;
    }
    setTurn({ dir, progress: 0, animating: false });
    // Next frame: start the CSS transition toward progress 1.
    requestAnimationFrame(() => requestAnimationFrame(() => setTurn((t) => (t ? { ...t, animating: true, progress: 1 } : t))));
  }, [turn, canNext, canPrev, commit]);

  useEffect(() => onSlideChange?.(leftIndex), [leftIndex, onSlideChange]);

  // Keyboard navigation (previous/next follow reading direction).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select")) return;
      const forward = rtl ? "ArrowLeft" : "ArrowRight";
      const back = rtl ? "ArrowRight" : "ArrowLeft";
      if (e.key === forward || e.key === "PageDown" || e.key === " ") { e.preventDefault(); go(1); }
      else if (e.key === back || e.key === "PageUp") { e.preventDefault(); go(-1); }
      else if (e.key === "Home") setLeftIndex(clampLeft(0));
      else if (e.key === "End") setLeftIndex(clampLeft(count));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, rtl, clampLeft, count]);

  // Drag a page to turn it.
  const drag = useRef<{ id: number; startX: number; dir: 1 | -1 } | null>(null);
  const onPointerDown = (e: ReactPointerEvent) => {
    if (turn || !pageW) return;
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const rightHalf = x > rect.width / 2;
    // Dragging the outer edge turns toward the spine; map to forward/back by reading direction.
    const forward = rtl ? !rightHalf : rightHalf;
    const dir: 1 | -1 = forward ? 1 : -1;
    if ((dir === 1 && !canNext) || (dir === -1 && !canPrev)) return;
    drag.current = { id: e.pointerId, startX: e.clientX, dir };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setTurn({ dir, progress: 0, animating: false });
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const travel = twoUp ? pageW : pageW; // full page width is a full turn
    const raw = ((e.clientX - d.startX) * (rtl ? 1 : -1) * d.dir) / Math.max(1, travel);
    setTurn({ dir: d.dir, progress: Math.min(1, Math.max(0, raw)), animating: false });
  };
  const endDrag = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setTurn((t) => {
      if (!t) return null;
      const complete = t.progress > 0.5;
      // Animate the rest of the way (or back), then commit on transition end.
      requestAnimationFrame(() => setTurn((cur) => (cur ? { ...cur, animating: true, progress: complete ? 1 : 0 } : cur)));
      if (!complete) return { ...t, animating: true, progress: 0 };
      return { ...t, animating: true, progress: 1 };
    });
    if (turn && turn.progress <= 0.5) {
      // Snapping back: clear once the animation settles (no commit).
      window.setTimeout(() => setTurn((cur) => (cur && !drag.current ? null : cur)), TURN_MS);
    }
  };

  const faceStyle: CSSProperties = { width: pageW, height: pageH, position: "absolute", top: 0, overflow: "hidden", background: "#fff", backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" };
  const slidePage = (slide: ReturnType<typeof page>, extra?: CSSProperties) =>
    slide ? (
      <div style={{ ...faceStyle, ...extra }}>
        <SlideView doc={doc} slide={slide} scale={scale} resolveAsset={resolveAsset} extensionRenderers={extensionRenderers} extensionEffects={extensionEffects} />
      </div>
    ) : (
      <div style={{ ...faceStyle, background: "#e9e9ef", ...extra }} aria-hidden />
    );

  // Which slides sit on each side, and on the turning leaf's two faces.
  const dir = turn?.dir ?? 1;
  const forward = dir === 1;
  const leftStatic = forward ? page(leftIndex) : page(turn ? leftIndex - step : leftIndex);
  const rightStatic = !twoUp ? null : forward ? page(turn ? leftIndex + 3 : leftIndex + 1) : page(leftIndex + 1);
  // Leaf faces. Forward: front = current inner page, back = next inner page.
  const leafFront = forward ? page(twoUp ? leftIndex + 1 : leftIndex) : page(twoUp ? leftIndex - 1 : leftIndex - 1);
  const leafBack = forward ? page(twoUp ? leftIndex + 2 : leftIndex + 1) : page(twoUp ? leftIndex : leftIndex);

  // The leaf sits on the right half (two-up forward / single) or left half (two-up back),
  // and rotates around the spine. Progress 0→1 maps to 0→180° of turn.
  const progress = turn?.progress ?? 0;
  const onLeftSide = twoUp && !forward;
  const angle = (onLeftSide ? 1 : -1) * progress * 180;
  const spineX = twoUp ? (onLeftSide ? 0 : pageW) : 0;
  const leafTransition = turn?.animating ? `transform ${TURN_MS}ms cubic-bezier(.3,0,.2,1)` : "none";

  const spreadW = twoUp ? pageW * 2 : pageW;
  const label = twoUp
    ? `Pages ${leftIndex + 1}${page(leftIndex + 1) ? `–${leftIndex + 2}` : ""} of ${count}`
    : `Page ${leftIndex + 1} of ${count}`;

  return (
    <div ref={boxRef} className={className} style={{ position: "relative", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", touchAction: "pan-y", userSelect: "none" }}>
      {pageW > 0 && (
        <div style={{ position: "relative", width: spreadW, height: pageH, perspective: Math.max(1600, spreadW * 1.6), boxShadow: "0 24px 70px rgba(0,0,0,.45)" }}>
          {/* Static left page */}
          <div style={{ position: "absolute", left: 0, top: 0 }}>{slidePage(leftStatic)}</div>
          {/* Static right page (two-up only) */}
          {twoUp && <div style={{ position: "absolute", left: pageW, top: 0 }}>{slidePage(rightStatic)}</div>}
          {/* Spine shadow */}
          {twoUp && <div style={{ position: "absolute", left: pageW - 12, top: 0, width: 24, height: pageH, background: "linear-gradient(90deg,rgba(0,0,0,.18),rgba(0,0,0,0) 45%,rgba(0,0,0,0) 55%,rgba(0,0,0,.18))", pointerEvents: "none" }} />}

          {/* Turning leaf */}
          {turn && (
            <div
              style={{
                position: "absolute", left: spineX, top: 0, width: pageW, height: pageH,
                transformStyle: "preserve-3d", transformOrigin: onLeftSide ? "right center" : "left center",
                transform: `rotateY(${angle}deg)`, transition: leafTransition, willChange: "transform",
              }}
              onTransitionEnd={(e) => { if (e.propertyName === "transform") { if ((turn?.progress ?? 0) > 0.5) commit(dir); else setTurn(null); } }}
            >
              {/* Front face */}
              <div style={{ position: "absolute", left: onLeftSide ? -pageW : 0, top: 0, transformOrigin: onLeftSide ? "right center" : "left center" }}>
                {slidePage(leafFront)}
                <div style={{ position: "absolute", inset: 0, background: "#000", opacity: progress * 0.22, pointerEvents: "none" }} />
              </div>
              {/* Back face (pre-rotated) */}
              <div style={{ position: "absolute", left: onLeftSide ? -pageW : 0, top: 0, transform: "rotateY(180deg)", transformOrigin: onLeftSide ? "right center" : "left center" }}>
                {slidePage(leafBack)}
                <div style={{ position: "absolute", inset: 0, background: "#000", opacity: (1 - progress) * 0.22, pointerEvents: "none" }} />
              </div>
            </div>
          )}

          {/* Click / drag surfaces over each half */}
          <div style={{ position: "absolute", inset: 0, display: "flex" }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
            <button type="button" aria-label={rtl ? "Next page" : "Previous page"} style={{ flex: 1, cursor: (rtl ? canNext : canPrev) ? "pointer" : "default", background: "transparent", border: 0 }} onClick={() => go(rtl ? 1 : -1)} />
            <button type="button" aria-label={rtl ? "Previous page" : "Next page"} style={{ flex: 1, cursor: (rtl ? canPrev : canNext) ? "pointer" : "default", background: "transparent", border: 0 }} onClick={() => go(rtl ? -1 : 1)} />
          </div>
        </div>
      )}

      {/* Controls */}
      <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", borderRadius: 999, background: "rgba(20,20,24,.72)", color: "#fff", font: "13px system-ui,sans-serif", backdropFilter: "blur(6px)" }}>
        <button type="button" onClick={() => go(rtl ? 1 : -1)} disabled={rtl ? !canNext : !canPrev} style={navBtn} aria-label="Previous">‹</button>
        <span style={{ minWidth: 120, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{label}</span>
        <button type="button" onClick={() => go(rtl ? -1 : 1)} disabled={rtl ? !canPrev : !canNext} style={navBtn} aria-label="Next">›</button>
      </div>
    </div>
  );
}

const navBtn: CSSProperties = { width: 30, height: 30, borderRadius: "50%", border: "1px solid rgba(255,255,255,.25)", background: "transparent", color: "#fff", fontSize: 18, lineHeight: 1, cursor: "pointer" };
