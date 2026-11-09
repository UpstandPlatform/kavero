"use client";

import { buildTimeline } from "@Kavero/animation-engine";
import type { CatalogDocument } from "@Kavero/catalog-engine";
import { Button } from "@Kavero/ui/components/button";
import { Download, Film, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { collectAssets } from "./export-menu";

type Job = { id: string; status: string; frame: number; totalFrames: number; error?: string; bytes?: number };


const HEIGHTS = [720, 1080, 1440, 2160] as const;

/** Renders the catalog to MP4 on the Kavero server (headless Chrome + ffmpeg). */
export function VideoExportButton({ doc, defaultOpen = false }: { doc: CatalogDocument; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [height, setHeight] = useState<(typeof HEIGHTS)[number]>(1080);
  const [fps, setFps] = useState<24 | 30 | 60>(30);
  const [job, setJob] = useState<Job | null>(null);
  const [starting, setStarting] = useState(false);
  const poll = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const seconds = Math.round(buildTimeline(doc).totalMs / 1000);

  useEffect(() => () => clearInterval(poll.current), []);

  async function start() {
    setStarting(true);
    try {
      const assets = await collectAssets(doc);
      const res = await fetch("/api/export/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document: doc, assets, fps, height }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Export failed");
      setJob(body);
      poll.current = setInterval(async () => {
        const r = await fetch(`/api/export/video/${body.id}`);
        const j: Job = await r.json();
        setJob(j);
        if (!["queued", "rendering", "encoding"].includes(j.status)) {
          clearInterval(poll.current);
          if (j.status === "done") window.location.href = `/api/export/video/${j.id}/file`;
          if (j.status === "error") toast.error(`Video export failed: ${j.error}`);
        }
      }, 700);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  async function cancel() {
    if (job) await fetch(`/api/export/video/${job.id}`, { method: "DELETE" });
    clearInterval(poll.current);
    setJob(null);
  }

  const running = job && ["queued", "rendering", "encoding"].includes(job.status);
  const pct = job?.totalFrames ? Math.round((job.frame / job.totalFrames) * 100) : 0;

  return (
    <div className="relative">
      <Button variant="ghost" size="sm" className="text-white hover:bg-white/10" onClick={() => setOpen(!open)}><Film /> Export video</Button>
      {open && (
        <div className="absolute right-0 bottom-full mb-2 w-72 border border-white/15 bg-neutral-900 p-3 text-xs text-white shadow-xl">
          {!job || !running ? (
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold">MP4 video</span>
                <span className="text-white/60">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} long</span>
              </div>
              <label className="flex items-center justify-between gap-2">Resolution
                <select value={height} onChange={(e) => setHeight(Number(e.target.value) as never)} className="h-7 border border-white/20 bg-transparent px-1">
                  {HEIGHTS.map((h) => <option key={h} value={h} className="bg-neutral-900">{h === 2160 ? "4K" : `${h}p`}</option>)}
                </select>
              </label>
              <label className="flex items-center justify-between gap-2">Frame rate
                <select value={fps} onChange={(e) => setFps(Number(e.target.value) as never)} className="h-7 border border-white/20 bg-transparent px-1">
                  {[24, 30, 60].map((f) => <option key={f} value={f} className="bg-neutral-900">{f} fps</option>)}
                </select>
              </label>
              {job?.status === "done" && (
                <a className="inline-flex items-center gap-1 text-sky-400 underline" href={`/api/export/video/${job.id}/file`}><Download className="size-3" /> Download again ({((job.bytes ?? 0) / 1e6).toFixed(1)} MB)</a>
              )}
              <p className="text-white/50">Rendered frame by frame with the same engine as Preview, then encoded with ffmpeg (H.264).</p>
              <Button size="sm" onClick={start} disabled={starting}>{starting ? <><Loader2 className="animate-spin" /> Preparing…</> : "Render video"}</Button>
            </div>
          ) : (
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <span>{job.status === "queued" ? "Waiting…" : job.status === "encoding" ? "Encoding…" : `Rendering frames ${pct}%`}</span>
                <button type="button" onClick={cancel} title="Cancel" className="text-white/60 hover:text-white"><X className="size-3.5" /></button>
              </div>
              <div className="h-1.5 w-full bg-white/10"><div className="h-full bg-sky-500 transition-[width]" style={{ width: `${job.status === "encoding" ? 100 : pct}%` }} /></div>
              <span className="text-white/50 tabular-nums">{job.frame} / {job.totalFrames || "…"} frames</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
