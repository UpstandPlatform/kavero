/// <reference path="./page-flip.d.ts" />
import { documentDirection, type CatalogDocument, type CatalogSlide } from "@Kavero/catalog-engine";
import { PageFlip } from "page-flip";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { SlideView, type AssetResolver, type ExtensionEffectRegistry, type ExtensionRendererRegistry } from "./slide-view";

/**
 * A page-turn flipbook view of a catalog, built on StPageFlip (the `page-flip`
 * library): realistic page curl with soft shadows, drag/click/keyboard turns.
 * Laid out like a printed book: the first slide is the front cover, the last
 * slide is the back cover, and the slides in between sit in two-page spreads
 * (2–3, 4–5, …). On narrow screens it shows one page at a time. The book is
 * fitted inside the available space with margins, never edge to edge. Each page
 * is a live SlideView, so it looks exactly like the slide. Works in the editor
 * and in a standalone exported file.
 */
export interface FlipbookProps {
  doc: CatalogDocument;
  resolveAsset?: AssetResolver;
  extensionRenderers?: ExtensionRendererRegistry;
  extensionEffects?: ExtensionEffectRegistry;
  /** First slide shown (0-based). */
  initialSlide?: number;
  onSlideChange?: (index: number) => void;
  className?: string;
}

// StPageFlip's layout CSS (positions its page blocks and shadows), inlined so it
// renders the same in the editor and in standalone exports. The wrapper fills the
// box we size ourselves, so the book fits inside it on both axes.
const STF_CSS = `
.kv-flipbook.stf__parent{position:absolute;display:block;box-sizing:border-box;transform:translateZ(0);touch-action:pan-y}
.kv-flipbook .stf__wrapper{position:relative;width:100%;height:100%;box-sizing:border-box}
.kv-flipbook .stf__parent canvas{position:absolute;width:100%;height:100%;left:0;top:0}
.kv-flipbook .stf__block{position:absolute;width:100%;height:100%;box-sizing:border-box;perspective:2000px}
.kv-flipbook .stf__item{display:none;position:absolute;transform-style:preserve-3d}
.kv-flipbook .stf__outerShadow,.kv-flipbook .stf__innerShadow,.kv-flipbook .stf__hardShadow,.kv-flipbook .stf__hardInnerShadow{position:absolute;left:0;top:0}
.kv-flip-page{background:#fff;overflow:hidden}
`;

/** Space kept around the book (CSS px). The bottom also leaves room for the page controls. */
function margins(w: number, h: number) {
  const side = Math.round(Math.min(96, Math.max(16, w * 0.05)));
  const top = Math.round(Math.min(64, Math.max(16, h * 0.05)));
  const bottom = 72;
  return { side, top, bottom };
}

/** One page of the book: a slide, or a blank inside page that keeps the back cover on its own. */
type BookPage = { kind: "slide"; slide: CatalogSlide; slideIndex: number } | { kind: "blank"; id: string };

/** The book's pages: every slide, plus a blank before the back cover when the count is odd. */
function bookPages(slides: CatalogSlide[]): BookPage[] {
  const pages: BookPage[] = slides.map((slide, slideIndex) => ({ kind: "slide", slide, slideIndex }));
  // Cover mode pairs pages as [0], [1,2], [3,4]…; the last page is alone (a back cover) only
  // when the total is even. With an odd number of slides, add a blank inside page before it.
  if (slides.length >= 3 && slides.length % 2 === 1) pages.splice(pages.length - 1, 0, { kind: "blank", id: "kv-blank-inside-back" });
  return pages;
}

/** The pages shown together: cover alone, then pairs, then the back cover alone (two-page mode). */
function spreads(count: number, twoPage: boolean): number[][] {
  if (!twoPage) return Array.from({ length: count }, (_, i) => [i]);
  const out: number[][] = [[0]];
  for (let i = 1; i < count; i += 2) out.push(i < count - 1 ? [i, i + 1] : [i]);
  return out;
}

export function Flipbook({ doc, resolveAsset, extensionRenderers, extensionEffects, initialSlide = 0, onSlideChange, className }: FlipbookProps) {
  const { width: W, height: H } = doc.settings;
  const slides = doc.slides;
  const rtl = documentDirection(doc) === "rtl";

  const pages = useMemo(() => bookPages(slides), [slides]);
  const pageCount = pages.length;
  const startPage = Math.max(0, pages.findIndex((p) => p.kind === "slide" && p.slideIndex === Math.min(slides.length - 1, Math.max(0, initialSlide))));
  // A new book (new StPageFlip instance) only when the set of pages changes; content edits update live.
  const bookKey = `${doc.id}:${W}x${H}:${pages.map((p) => (p.kind === "slide" ? p.slide.id : p.id)).join(",")}`;

  const wrapRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<PageFlip | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [page, setPage] = useState(startPage);
  const [twoPage, setTwoPage] = useState(true);
  const [turning, setTurning] = useState(false);
  const pageRef = useRef(startPage);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setBox({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const m = margins(box.w, box.h);
  const availW = Math.max(0, box.w - m.side * 2);
  const availH = Math.max(0, box.h - m.top - m.bottom);
  const ready = availW > 0 && availH > 0;

  // Build the book. StPageFlip fits the pages inside the box we give it (both axes) and centres them.
  useLayoutEffect(() => {
    const block = bookRef.current;
    if (!block || !ready || !pageCount) return;
    const items = Array.from(block.querySelectorAll<HTMLElement>(":scope > .kv-flip-page"));
    const flip = new PageFlip(block, {
      width: W,
      height: H,
      size: "stretch",
      // Below two pages of this width the book shows one page at a time.
      minWidth: 260,
      maxWidth: 100_000,
      minHeight: 100,
      maxHeight: 100_000,
      autoSize: false,
      showCover: pageCount > 1,
      usePortrait: true,
      drawShadow: true,
      maxShadowOpacity: 0.45,
      mobileScrollSupport: false,
      flippingTime: 700,
      startPage: Math.min(pageCount - 1, pageRef.current),
      clickEventForward: false,
      useMouseEvents: true,
      swipeDistance: 24,
    });
    flip.loadFromHTML(items);
    flipRef.current = flip;
    setTwoPage(flip.getOrientation() === "landscape");
    flip.on("flip", (e) => {
      const i = Number(e.data);
      pageRef.current = i;
      setPage(i);
    });
    flip.on("changeState", (e) => setTurning(e.data !== "read"));
    flip.on("changeOrientation", (e) => {
      setTwoPage(e.data === "landscape");
      const i = flip.getCurrentPageIndex();
      pageRef.current = i;
      setPage(i);
    });
    return () => {
      // Not flip.destroy(): it removes the element React owns, and it never stops the
      // library's animation loop. Detach its listeners and silence the loop instead.
      const internals = flip as unknown as { ui?: { removeHandlers?: () => void }; render?: { render: (t: number) => void } };
      internals.ui?.removeHandlers?.();
      if (internals.render) internals.render.render = () => {};
      if (flipRef.current === flip) flipRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey, ready]);

  // Re-fit when the available space changes.
  useEffect(() => {
    flipRef.current?.update();
  }, [availW, availH]);

  // Report the slide on show (skip the blank inside page).
  useEffect(() => {
    const p = pages[page];
    if (p?.kind === "slide") onSlideChange?.(p.slideIndex);
  }, [page, pages, onSlideChange]);

  // Keyboard navigation (follows reading direction).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select")) return;
      const fwd = rtl ? "ArrowLeft" : "ArrowRight";
      const back = rtl ? "ArrowRight" : "ArrowLeft";
      if (e.key === fwd || e.key === "PageDown" || e.key === " ") { e.preventDefault(); flipRef.current?.flipNext(); }
      else if (e.key === back || e.key === "PageUp") { e.preventDefault(); flipRef.current?.flipPrev(); }
      else if (e.key === "Home") flipRef.current?.flip(0);
      else if (e.key === "End") flipRef.current?.flip(pageCount - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rtl, pageCount]);

  const spreadList = spreads(pageCount, twoPage && pageCount > 1);
  const spreadIndex = Math.max(0, spreadList.findIndex((s) => s.includes(page)));
  const shown = spreadList[spreadIndex] ?? [0];
  const canPrev = spreadIndex > 0;
  const canNext = spreadIndex < spreadList.length - 1;
  // A closed book (front or back cover alone) is centred; it slides back as a page starts to turn.
  const pageW = Math.min(availW / 2, availH * (W / H));
  const closedShift = !turning && twoPage && pageCount > 1 && shown.length === 1
    ? (shown[0] === 0 ? -pageW / 2 : shown[0] === pageCount - 1 ? pageW / 2 : 0)
    : 0;
  const label = (() => {
    if (pageCount <= 1) return "Page 1 of 1";
    const last = pageCount - 1;
    if (shown.length === 1 && shown[0] === 0) return "Cover";
    if (shown.length === 1 && shown[0] === last && twoPage) return "Back cover";
    const nums = shown.map((i) => pages[i]).filter((p): p is Extract<BookPage, { kind: "slide" }> => p?.kind === "slide").map((p) => p.slideIndex + 1);
    if (!nums.length) return "";
    return nums.length === 1 ? `Page ${nums[0]} of ${slides.length}` : `Pages ${nums[0]}–${nums[nums.length - 1]} of ${slides.length}`;
  })();

  return (
    <div ref={wrapRef} className={className} style={wrap}>
      <style>{STF_CSS}</style>
      {/* StPageFlip renders into this box (sized to the space minus margins); the .kv-flip-page children are its pages. */}
      <div
        key={`${bookKey}:${ready ? "ready" : "idle"}`}
        ref={bookRef}
        className="kv-flipbook"
        style={{ position: "absolute", left: m.side, top: m.top, width: availW, height: availH, transform: `translateX(${Math.round(closedShift)}px)`, transition: "transform 450ms cubic-bezier(.3,0,.2,1)" }}
      >
        {pages.map((p) =>
          p.kind === "slide" ? (
            <div className="kv-flip-page" key={p.slide.id} data-density={p.slideIndex === 0 || p.slideIndex === slides.length - 1 ? "hard" : "soft"}>
              <FlipPage doc={doc} slide={p.slide} resolveAsset={resolveAsset} extensionRenderers={extensionRenderers} extensionEffects={extensionEffects} />
            </div>
          ) : (
            <div className="kv-flip-page" key={p.id} data-density="soft" aria-hidden />
          ),
        )}
      </div>

      <div style={bar}>
        <button type="button" onClick={() => flipRef.current?.flipPrev()} disabled={!canPrev} style={navBtn} aria-label="Previous">‹</button>
        <span style={{ minWidth: 130, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{label}</span>
        <button type="button" onClick={() => flipRef.current?.flipNext()} disabled={!canNext} style={navBtn} aria-label="Next">›</button>
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

const wrap: CSSProperties = { position: "relative", width: "100%", height: "100%", overflow: "hidden", userSelect: "none" };
const bar: CSSProperties = { position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", borderRadius: 999, background: "rgba(20,20,24,.72)", color: "#fff", font: "13px system-ui,sans-serif", backdropFilter: "blur(6px)", zIndex: 5 };
const navBtn: CSSProperties = { width: 30, height: 30, borderRadius: "50%", border: "1px solid rgba(255,255,255,.25)", background: "transparent", color: "#fff", fontSize: 18, lineHeight: 1, cursor: "pointer" };
