"use client";

import { buildTimeline, type Timeline } from "@Kavero/animation-engine";
import type { CatalogDocument } from "@Kavero/catalog-engine";
import { CatalogFonts, FrameView, SlideView, usedWeights } from "@Kavero/renderer";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { builtInExtensionRenderers } from "@/modules/editor/extensions/built-in-renderers";
import { builtInExtensionEffects } from "@/modules/editor/extensions/built-in-effects";

interface Loaded { doc: CatalogDocument; assets: Record<string, string>; scale: number; timeline: Timeline }

const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/**
 * Load every font the catalog uses before the first capture. document.fonts.ready
 * alone isn't enough: a font isn't requested until its stylesheet has loaded.
 */
async function loadFonts(doc: CatalogDocument) {
  const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].filter((l) => !l.sheet);
  await Promise.all(links.map((l) => new Promise((r) => { l.addEventListener("load", r, { once: true }); l.addEventListener("error", r, { once: true }); setTimeout(r, 5000); })));
  // Exactly the weights the catalog uses (e.g. 800 headings), so no frame captures a fallback font.
  await Promise.all(
    [...usedWeights(doc)].flatMap(([f, weights]) => [...weights.map(String), "italic 400"].map((w) => document.fonts.load(`${w} 16px "${f.replace(/"/g, "")}"`).catch(() => undefined))),
  );
  await document.fonts.ready;
}

/** Wait for fonts, images and HTML-block iframes in the current frame to finish loading. */
async function settle(root: HTMLElement) {
  await document.fonts.ready;
  const imgs = [...root.querySelectorAll("img")].filter((i) => !i.complete);
  const frames = [...root.querySelectorAll("iframe")].filter((f) => f.dataset.loaded !== "1");
  await Promise.all([
    ...imgs.map((i) => new Promise((r) => { i.onload = i.onerror = r; })),
    ...frames.map((f) => new Promise<void>((r) => {
      const done = () => { f.dataset.loaded = "1"; r(); };
      f.addEventListener("load", done, { once: true });
      setTimeout(done, 3000);
    })),
  ]);
  await nextPaint();
}

/**
 * Exposes window.__kaveroLoad(doc, assets, scale) and window.__kaveroSeek(ms)
 * so a headless browser can step through the timeline frame by frame.
 */
export function RenderHost() {
  const [data, setData] = useState<Loaded | null>(null);
  const [time, setTime] = useState(0);
  const [print, setPrint] = useState<{ doc: CatalogDocument; assets: Record<string, string>; pageNumbers: boolean } | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__kaveroLoad = async (doc: CatalogDocument, assets: Record<string, string>, scale: number) => {
      flushSync(() => setData({ doc, assets, scale, timeline: buildTimeline(doc) }));
      await loadFonts(doc);
      await settle(root.current!);
    };
    // Print mode: every slide in its finished state, one per PDF page.
    w.__kaveroPrint = async (doc: CatalogDocument, assets: Record<string, string>, pageNumbers: boolean) => {
      flushSync(() => setPrint({ doc, assets, pageNumbers }));
      await loadFonts(doc);
      await settle(document.body);
    };
    w.__kaveroSeek = async (ms: number) => {
      flushSync(() => setTime(ms));
      await settle(root.current!);
    };
  }, []);

  if (print) {
    const { width: W, height: H } = print.doc.settings;
    const resolve = (id: string) => print.assets[id];
    return (
      <div>
        <style>{`nextjs-portal,.tsqd-parent-container,.tsqd-open-btn-container{display:none!important}
html,body,body>div{height:auto!important;min-height:0!important;display:block!important;overflow:visible!important;background:#fff}
@page{size:${W}px ${H}px;margin:0}
.kv-page{width:${W}px;height:${H}px;position:relative;overflow:hidden;break-after:page}
.kv-page:last-child{break-after:auto}`}</style>
        <CatalogFonts doc={print.doc} resolveAsset={resolve} />
        {print.doc.slides.map((slide, i) => (
          <div key={slide.id} className="kv-page">
            <SlideView doc={print.doc} slide={slide} resolveAsset={resolve} extensionRenderers={builtInExtensionRenderers} extensionEffects={builtInExtensionEffects} />
            {print.pageNumbers && (
              <span style={{ position: "absolute", right: 24, bottom: 16, fontSize: 14, opacity: 0.6, fontFamily: "system-ui, sans-serif", mixBlendMode: "difference", color: "#fff" }}>
                {i + 1} / {print.doc.slides.length}
              </span>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div ref={root} style={{ position: "fixed", inset: 0, background: "#000", overflow: "hidden", zIndex: 2147483647 }}>
      {/* Keep dev overlays (Next.js indicator, query devtools) out of rendered frames. */}
      <style>{"nextjs-portal,.tsqd-parent-container,.tsqd-open-btn-container{display:none!important}"}</style>
      {data && (
        <>
          <CatalogFonts doc={data.doc} resolveAsset={(id) => data.assets[id]} />
          <FrameView doc={data.doc} timeline={data.timeline} timeMs={time} scale={data.scale} resolveAsset={(id) => data.assets[id]} extensionRenderers={builtInExtensionRenderers} extensionEffects={builtInExtensionEffects} />
        </>
      )}
    </div>
  );
}
