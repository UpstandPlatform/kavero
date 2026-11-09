import { ease, matchMorph, scheduleSlide, transitionStyles } from "@Kavero/animation-engine";
import type { CatalogDocument } from "@Kavero/catalog-engine";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { MorphView, SlideView, type AssetResolver } from "./slide-view";

export interface PresentationProps {
  doc: CatalogDocument;
  resolveAsset?: AssetResolver;
  /** Start slide (0-based). Defaults to the URL hash (#3 → third slide). */
  initialSlide?: number;
  /** Keep the URL hash in sync so slides can be linked. */
  syncHash?: boolean;
  onSlideChange?: (index: number) => void;
}

interface Transitioning {
  from: number;
  startedAt: number;
}

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const SETTLED = 1e9; // a time after every animation has finished

/**
 * Lightweight, editor-free player for published catalogs: responsive scaling,
 * element animations, slide transitions, keyboard/click/touch navigation.
 */
export function Presentation({ doc, resolveAsset, initialSlide, syncHash = true, onSlideChange }: PresentationProps) {
  const count = doc.slides.length;
  const readHash = () => {
    const n = Number(typeof window !== "undefined" ? window.location.hash.slice(1) : NaN);
    return Number.isInteger(n) && n >= 1 && n <= count ? n - 1 : 0;
  };
  const [index, setIndex] = useState(() => initialSlide ?? 0);
  const [enteredAt, setEnteredAt] = useState(0);
  const [transition, setTransition] = useState<Transitioning | null>(null);
  /** The slide we came from when that move was a Morph: its shared elements arrive at rest. */
  const [morphedFrom, setMorphedFrom] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [scale, setScale] = useState(0);
  const [reduced, setReduced] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const { width: W, height: H } = doc.settings;

  const settledAt = useMemo(() => doc.slides.map((s) => Math.max(0, ...scheduleSlide(s).map((a) => a.endMs))), [doc]);

  // Client-only setup: hash, reduced motion, clock.
  useEffect(() => {
    setReduced(prefersReducedMotion());
    if (initialSlide === undefined) setIndex(readHash());
    setEnteredAt(performance.now());
    setNow(performance.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(Math.min(e!.contentRect.width / W, e!.contentRect.height / H)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H]);

  const go = useCallback(
    (next: number) => {
      const target = Math.max(0, Math.min(count - 1, next));
      if (target === index) return;
      const t = performance.now();
      const tr = doc.slides[Math.max(target, index)]?.transition;
      setTransition(!reduced && tr && tr.type !== "none" ? { from: index, startedAt: t } : null);
      setMorphedFrom(tr?.type === "morph" ? index : null);
      setIndex(target);
      setEnteredAt(t);
      setNow(t);
    },
    [count, index, doc.slides, reduced],
  );

  useEffect(() => {
    onSlideChange?.(index);
    if (syncHash && typeof window !== "undefined") history.replaceState(null, "", `#${index + 1}`);
  }, [index, syncHash, onSlideChange]);

  // Animate only while something is moving.
  const slide = doc.slides[index]!;
  const settledIds = useMemo(() => {
    const from = morphedFrom === null ? undefined : doc.slides[morphedFrom];
    return from ? new Set(matchMorph(from, slide).map(([, b]) => b.id)) : undefined;
  }, [morphedFrom, slide, doc.slides]);
  const tr = transition ? (doc.slides[Math.max(index, transition.from)]?.transition ?? null) : null;
  const trTotal = tr ? tr.delayMs + tr.durationMs : 0;
  const local = reduced ? SETTLED : now - enteredAt;
  const animating = !reduced && (local <= settledAt[index]! + 50 || (transition !== null && now - transition.startedAt < trTotal));
  useEffect(() => {
    if (!animating) {
      if (transition && now - transition.startedAt >= trTotal) setTransition(null);
      return;
    }
    let raf = requestAnimationFrame(function tick(t) {
      setNow(t);
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [animating, transition, now, trTotal]);

  // Keyboard and hash navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select")) return;
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) { e.preventDefault(); go(index + 1); }
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) { e.preventDefault(); go(index - 1); }
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(count - 1);
      else if (e.key.toLowerCase() === "f") toggleFullscreen(box.current?.parentElement ?? null);
    };
    const onHash = () => go(readHash());
    window.addEventListener("keydown", onKey);
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("hashchange", onHash);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [go, index, count]);

  // Touch swipe.
  const touch = useRef<{ x: number; y: number } | null>(null);

  const layer = (s?: CSSProperties): CSSProperties => ({ position: "absolute", inset: 0, transformOrigin: "50% 50%", backfaceVisibility: "hidden", ...s });
  let styles: ReturnType<typeof transitionStyles> | null = null;
  let progress = 1;
  if (transition && tr) {
    const p = (progress = ease(tr.easing, (now - transition.startedAt - tr.delayMs) / Math.max(1, tr.durationMs)));
    const forward = index > transition.from;
    // Going backwards mirrors directional transitions.
    const flip = { left: "right", right: "left", up: "down", down: "up" } as const;
    const dir = forward ? tr.direction : tr.direction ? flip[tr.direction] : "right";
    styles = transitionStyles(tr.type, p, dir);
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#000", overflow: "hidden", userSelect: "none" }}>
      <div
        ref={box}
        style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a, button, video, iframe")) return;
          const r = e.currentTarget.getBoundingClientRect();
          go(e.clientX - r.left < r.width / 3 ? index - 1 : index + 1);
        }}
        onTouchStart={(e) => { const t = e.touches[0]!; touch.current = { x: t.clientX, y: t.clientY }; }}
        onTouchEnd={(e) => {
          const start = touch.current;
          const t = e.changedTouches[0];
          touch.current = null;
          if (!start || !t) return;
          const dx = t.clientX - start.x;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(t.clientY - start.y)) go(dx < 0 ? index + 1 : index - 1);
        }}
      >
        {scale > 0 && (
          <div style={{ position: "relative", width: W * scale, height: H * scale, overflow: "hidden", boxShadow: "0 10px 40px rgba(0,0,0,.4)" }}>
            {transition && tr?.type === "morph" && doc.slides[transition.from] ? (
              <div style={layer()} aria-roledescription="slide" aria-label={`${index + 1} of ${count}: ${slide.name}`}>
                <MorphView doc={doc} from={doc.slides[transition.from]!} to={slide} progress={progress} scale={scale} timeMs={local} resolveAsset={resolveAsset} />
              </div>
            ) : (<>
            {transition && styles && doc.slides[transition.from] && (
              <div style={layer(styles.outgoing)} aria-hidden>
                <SlideView doc={doc} slide={doc.slides[transition.from]!} scale={scale} timeMs={SETTLED} resolveAsset={resolveAsset} />
              </div>
            )}
            <div style={layer(styles?.incoming)} aria-roledescription="slide" aria-label={`${index + 1} of ${count}: ${slide.name}`}>
              <SlideView doc={doc} slide={slide} scale={scale} timeMs={local} settledIds={settledIds} resolveAsset={resolveAsset} />
            </div>
            </>)}
          </div>
        )}
      </div>

      {/* Controls */}
      <nav
        aria-label="Slides"
        style={{
          position: "absolute", left: 0, right: 0, bottom: 0, display: "flex", alignItems: "center", gap: 12,
          padding: "10px 16px", color: "#fff", font: "13px system-ui, sans-serif",
          background: "linear-gradient(transparent, rgba(0,0,0,.55))",
        }}
      >
        <button type="button" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous slide" style={btn}>‹</button>
        <span style={{ fontVariantNumeric: "tabular-nums", minWidth: 52, textAlign: "center" }} aria-live="polite">{index + 1} / {count}</span>
        <button type="button" onClick={() => go(index + 1)} disabled={index === count - 1} aria-label="Next slide" style={btn}>›</button>
        <div style={{ flex: 1, height: 3, background: "rgba(255,255,255,.2)", borderRadius: 2 }}>
          <div style={{ width: `${((index + 1) / count) * 100}%`, height: "100%", background: "#fff", borderRadius: 2, transition: "width .3s" }} />
        </div>
        <button type="button" onClick={(e) => toggleFullscreen(e.currentTarget.closest("nav")?.parentElement ?? null)} aria-label="Full screen" style={btn}>⛶</button>
      </nav>
    </div>
  );
}

const btn: CSSProperties = {
  background: "rgba(255,255,255,.12)", color: "#fff", border: 0, borderRadius: 6, width: 32, height: 32,
  fontSize: 18, lineHeight: 1, cursor: "pointer",
};

function toggleFullscreen(el: HTMLElement | null) {
  if (!el) return;
  if (document.fullscreenElement) void document.exitFullscreen();
  else void el.requestFullscreen?.().catch(() => undefined);
}
