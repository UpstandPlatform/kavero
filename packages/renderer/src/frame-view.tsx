import { frameAt, matchMorph, transitionStyles, type Timeline } from "@Kavero/animation-engine";
import type { CatalogDocument } from "@Kavero/catalog-engine";
import type { CSSProperties } from "react";

import { fontFaceCss, googleFontsUrls } from "./fonts";
import { MorphView, SlideView, type AssetResolver, type ExtensionEffectRegistry, type ExtensionRendererRegistry } from "./slide-view";

/**
 * Renders the whole catalog at a global time: the current slide with its element
 * animations, plus the outgoing slide while a transition runs. Used for playback,
 * published sites and frame-by-frame video export.
 */
export function FrameView({ doc, timeline, timeMs, scale = 1, resolveAsset, extensionRenderers, extensionEffects }: {
  doc: CatalogDocument;
  timeline: Timeline;
  timeMs: number;
  scale?: number;
  resolveAsset?: AssetResolver;
  extensionRenderers?: ExtensionRendererRegistry;
  extensionEffects?: ExtensionEffectRegistry;
}) {
  const { width: W, height: H } = doc.settings;
  const frame = frameAt(timeline, timeMs);
  const styles = frame.transition ? transitionStyles(frame.transition.type, frame.transition.progress, frame.transition.direction) : null;
  const layer = (s?: CSSProperties): CSSProperties => ({ position: "absolute", inset: 0, transformOrigin: "50% 50%", backfaceVisibility: "hidden", ...s });
  const current = doc.slides[frame.current.slideIndex];
  const previous = frame.previous ? doc.slides[frame.previous.slideIndex] : undefined;
  if (!current) return null;
  // After a Morph, the shared elements are already in place: don't replay their entrances.
  const before = doc.slides[frame.current.slideIndex - 1];
  const settledIds = current.transition?.type === "morph" && before ? new Set(matchMorph(before, current).map(([, b]) => b.id)) : undefined;
  if (previous && frame.transition?.type === "morph") {
    return (
      <div style={{ position: "relative", width: W * scale, height: H * scale, overflow: "hidden", background: "#000" }}>
        <MorphView doc={doc} from={previous} to={current} progress={frame.transition.progress} scale={scale} timeMs={frame.current.localMs} resolveAsset={resolveAsset} extensionRenderers={extensionRenderers} extensionEffects={extensionEffects} />
      </div>
    );
  }
  return (
    <div style={{ position: "relative", width: W * scale, height: H * scale, overflow: "hidden", background: "#000" }}>
      {previous && frame.previous && (
        <div style={layer(styles?.outgoing)}>
          <SlideView doc={doc} slide={previous} scale={scale} timeMs={frame.previous.localMs} resolveAsset={resolveAsset} extensionRenderers={extensionRenderers} extensionEffects={extensionEffects} />
        </div>
      )}
      <div style={layer(styles?.incoming)}>
        <SlideView doc={doc} slide={current} scale={scale} timeMs={frame.current.localMs} settledIds={settledIds} resolveAsset={resolveAsset} extensionRenderers={extensionRenderers} extensionEffects={extensionEffects} />
      </div>
    </div>
  );
}

/** Loads Google fonts and embedded font files for a catalog. Render once per page. */
export function CatalogFonts({ doc, resolveAsset }: { doc: CatalogDocument; resolveAsset?: AssetResolver }) {
  const google = googleFontsUrls(doc);
  const faces = fontFaceCss(doc, resolveAsset ?? (() => undefined));
  return (
    <>
      {google.map((href) => <link key={href} rel="stylesheet" href={href} />)}
      {faces && <style>{faces}</style>}
    </>
  );
}
