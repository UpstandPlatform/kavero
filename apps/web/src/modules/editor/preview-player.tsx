"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, PauseIcon, PlayIcon, SkipBackIcon } from "@hugeicons/core-free-icons";
import { buildTimeline } from "@Kavero/animation-engine";
import type { CatalogDocument } from "@Kavero/catalog-engine";
import { FrameView, type ExtensionEffectRegistry, type ExtensionRendererRegistry } from "@Kavero/renderer";
import { Button } from "@Kavero/ui/components/button";
import { Slider } from "@Kavero/ui/components/slider";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { VideoExportButton } from "./video-export";

const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Full-screen playback of the catalog timeline, exactly as the video export renders it. */
export function PreviewPlayer({ doc, startSlide, assetUrls, onClose, openExport = false, extensionRenderers, extensionEffects, prepareDocument }: {
  openExport?: boolean;
  doc: CatalogDocument;
  startSlide: number;
  assetUrls: Record<string, string>;
  onClose: () => void;
  extensionRenderers?: ExtensionRendererRegistry;
  extensionEffects?: ExtensionEffectRegistry;
  prepareDocument?: (format: "video", document: CatalogDocument) => Promise<CatalogDocument>;
}) {
  const timeline = useMemo(() => buildTimeline(doc), [doc]);
  const [time, setTime] = useState(timeline.segments[startSlide]?.startMs ?? 0);
  const [playing, setPlaying] = useState(!openExport);
  const [scale, setScale] = useState(0.5);
  const box = useRef<HTMLDivElement>(null);
  const { width: W, height: H } = doc.settings;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(Math.min(e!.contentRect.width / W, e!.contentRect.height / H)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      setTime((t) => {
        const next = t + (now - last);
        if (next >= timeline.totalMs) {
          setPlaying(false);
          return timeline.totalMs - 1;
        }
        return next;
      });
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, timeline.totalMs]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Let the timeline slider and export form controls handle their own keys.
      const inField = !!(e.target as HTMLElement | null)?.closest?.("input, select, textarea");
      if (e.key !== "Escape" && inField) return;
      if (!["Escape", " ", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
      // The preview owns these keys: keep them from the editor behind it.
      e.stopPropagation();
      if (e.key === "Escape") onClose();
      if (e.key === " ") { e.preventDefault(); setPlaying((p) => !p); }
      const seg = Math.max(0, timeline.segments.findIndex((s) => time >= s.startMs && time < s.endMs));
      if (e.key === "ArrowRight" && timeline.segments[seg + 1]) setTime(timeline.segments[seg + 1]!.startMs);
      if (e.key === "ArrowLeft" && timeline.segments[seg]) setTime(timeline.segments[Math.max(0, seg - (time - timeline.segments[seg]!.startMs < 500 ? 1 : 0))]!.startMs);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, time, timeline]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label="Preview">
      <div ref={box} className="flex min-h-0 flex-1 items-center justify-center p-4">
        <FrameView doc={doc} timeline={timeline} timeMs={time} scale={scale} resolveAsset={(id) => assetUrls[id]} extensionRenderers={extensionRenderers} extensionEffects={extensionEffects} />
      </div>
      <div className="flex items-center gap-2 border-t border-white/10 px-4 py-2 text-xs">
        <Button variant="ghost" size="icon-sm" className="text-white hover:bg-white/10" title="Restart" onClick={() => { setTime(0); setPlaying(true); }}><HugeiconsIcon icon={SkipBackIcon} /></Button>
        <Button variant="ghost" size="icon-sm" className="text-white hover:bg-white/10" title={playing ? "Pause (Space)" : "Play (Space)"} onClick={() => { if (time >= timeline.totalMs - 1) setTime(0); setPlaying(!playing); }}>{playing ? <HugeiconsIcon icon={PauseIcon} /> : <HugeiconsIcon icon={PlayIcon} />}</Button>
        <span className="w-20 tabular-nums">{fmt(time)} / {fmt(timeline.totalMs)}</span>
        <div className="relative flex-1">
          <Slider
            min={0} max={timeline.totalMs - 1} value={[Math.round(time)]} aria-label="Timeline"
            onValueChange={(value) => { setPlaying(false); setTime(typeof value === "number" ? value : value[0] ?? 0); }}
          />
          {/* Slide boundaries */}
          {timeline.segments.slice(1).map((s) => (
            <span key={s.startMs} className="pointer-events-none absolute top-0 h-1.5 w-px bg-white/40" style={{ left: `${(s.startMs / timeline.totalMs) * 100}%` }} />
          ))}
        </div>
        <VideoExportButton doc={doc} defaultOpen={openExport} prepareDocument={prepareDocument} />
        <Button variant="ghost" size="icon-sm" className="text-white hover:bg-white/10" title="Close (Esc)" onClick={onClose}><HugeiconsIcon icon={Cancel01Icon} /></Button>
      </div>
    </div>
  );
}
