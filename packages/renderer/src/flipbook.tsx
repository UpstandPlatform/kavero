/// <reference path="./page-flip.d.ts" />
import { documentDirection, type CatalogDocument, type CatalogSlide } from "@Kavero/catalog-engine";
import { PageFlip } from "page-flip";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { SlideView, type AssetResolver, type ExtensionEffectRegistry, type ExtensionRendererRegistry } from "./slide-view";

/**
 * A page-turn flipbook view of a catalog, built on StPageFlip (the `page-flip`
 * library): realistic page curl with soft shadows, two pages side by side on
 * wide screens and one on narrow ones, drag/click/keyboard turns. Each page is a
 * live SlideView, so it looks exactly like the slide. Works in the editor and in
 * a standalone exported file.
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

// StPageFlip's own layout CSS (positions its canvas, page blocks and shadows),
// inlined so it works the same in the editor and in standalone exports.
const STF_CSS = `
.stf__parent{position:relative;display:block;box-sizing:border-box;transform:translateZ(0);touch-action:pan-y}
.stf__parent canvas{position:absolute;width:100%;height:100%;left:0;top:0}
.stf__wrapper,.sft__wrapper{position:relative;width:100%;box-sizing:border-box}
.stf__block{position:absolute;width:100%;height:100%;box-sizing:border-box;perspective:2000px}
.stf__item{display:none;position:absolute;transform-style:preserve-3d}
.stf__outerShadow,.stf__innerShadow,.stf__hardShadow,.stf__hardInnerShadow{position:absolute;left:0;top:0}
.kv-flip-page{background:#fff;overflow:hidden}
`;

export function Flipbook({ doc, resolveAsset, extensionRenderers, extensionEffects, initialSlide = 0, onSlideChange, className }: FlipbookProps) {
  const { width: W, height: H } = doc.settings;
  const aspect = W / H;
  const slides = doc.slides;
  const count = slides.length;
  const rtl = documentDirection(doc) === "rtl";

  const parentRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<PageFlip | null>(null);
  const [index, setIndex] = useState(() => Math.min(count - 1, Math.max(0, initialSlide)));
  const [two, setTwo] = useState(false);

  // (Re)build the flipbook when the catalog identity, page count or shape changes.
  // Editing a slide's content doesn't re-init: the live SlideView inside each page updates on its own.
  useLayoutEffect(() => {
    const parent = parentRef.current;
    if (!parent || !count) return;
    const pages = parent.querySelectorAll<HTMLElement>(".kv-flip-page");
    // A base page size in CSS pixels; `stretch` scales it to the container, keeping the aspect ratio.
    const baseW = 560;
    const flip = new PageFlip(parent, {
      width: baseW,
      height: Math.round(baseW / aspect),
      size: "stretch",
      minWidth: 180,
      maxWidth: 4000,
      minHeight: Math.round(180 / aspect),
      maxHeight: 4000,
      drawShadow: true,
      maxShadowOpacity: 0.5,
      showCover: false,
      usePortrait: true,
      mobileScrollSupport: false,
      flippingTime: 650,
      startPage: Math.min(count - 1, Math.max(0, initialSlide)),
      autoSize: true,
      clickEventForward: false,
      useMouseEvents: true,
      swipeDistance: 24,
    });
    flip.loadFromHTML(pages);
    flipRef.current = flip;
    setTwo(flip.getOrientation() === "landscape");
    const onFlip = (e: { data: number | string }) => {
      const i = Number(e.data);
      setIndex(i);
      onSlideChange?.(i);
    };
    const onOrient = (e: { data: number | string }) => setTwo(e.data === "landscape");
    flip.on("flip", onFlip);
    flip.on("changeOrientation", onOrient);
    return () => {
      try {
        flip.destroy();
      } catch {
        // already torn down
      }
      flipRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id, count, aspect]);

  // Keyboard navigation (follows reading direction).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select")) return;
      const fwd = rtl ? "ArrowLeft" : "ArrowRight";
      const back = rtl ? "ArrowRight" : "ArrowLeft";
      if (e.key === fwd || e.key === "PageDown" || e.key === " ") { e.preventDefault(); flipRef.current?.flipNext(); }
      else if (e.key === back || e.key === "PageUp") { e.preventDefault(); flipRef.current?.flipPrev(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rtl]);

  const canPrev = index > 0;
  const canNext = index < count - (two ? 2 : 1);
  const label = two && index + 1 < count ? `Pages ${index + 1}–${index + 2} of ${count}` : `Page ${Math.min(index + 1, count)} of ${count}`;

  return (
    <div className={className} style={wrap}>
      <style>{STF_CSS}</style>
      {/* StPageFlip renders into this element; the .kv-flip-page children are its pages. */}
      <div ref={parentRef} style={{ width: "100%", maxWidth: "100%" }}>
        {slides.map((slide) => (
          <div className="kv-flip-page" key={slide.id} data-density="soft">
            <FlipPage doc={doc} slide={slide} resolveAsset={resolveAsset} extensionRenderers={extensionRenderers} extensionEffects={extensionEffects} />
          </div>
        ))}
      </div>

      <div style={bar}>
        <button type="button" onClick={() => flipRef.current?.flipPrev()} disabled={rtl ? !canNext : !canPrev} style={navBtn} aria-label="Previous">‹</button>
        <span style={{ minWidth: 130, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{label}</span>
        <button type="button" onClick={() => flipRef.current?.flipNext()} disabled={rtl ? !canPrev : !canNext} style={navBtn} aria-label="Next">›</button>
      </div>
    </div>
  );
}

/** One page: a live SlideView scaled to fill the page element StPageFlip sizes. */
function FlipPage({ doc, slide, resolveAsset, extensionRenderers, extensionEffects }: {
  doc: CatalogDocument;
  slide: CatalogSlide;
  resolveAsset?: AssetResolver;
  extensionRenderers?: ExtensionRendererRegistry;
  extensionEffects?: ExtensionEffectRegistry;
}) {
  const { width: W } = doc.settings;
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setScale(entry.contentRect.width / W);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [W]);
  return (
    <div ref={ref} style={{ width: "100%", height: "100%", overflow: "hidden", background: "#fff" }}>
      {scale > 0 && (
        <SlideView doc={doc} slide={slide} scale={scale} resolveAsset={resolveAsset} extensionRenderers={extensionRenderers} extensionEffects={extensionEffects} />
      )}
    </div>
  );
}

const wrap: CSSProperties = { position: "relative", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", userSelect: "none", padding: 24, boxSizing: "border-box" };
const bar: CSSProperties = { position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", borderRadius: 999, background: "rgba(20,20,24,.72)", color: "#fff", font: "13px system-ui,sans-serif", backdropFilter: "blur(6px)", zIndex: 5 };
const navBtn: CSSProperties = { width: 30, height: 30, borderRadius: "50%", border: "1px solid rgba(255,255,255,.25)", background: "transparent", color: "#fff", fontSize: 18, lineHeight: 1, cursor: "pointer" };
