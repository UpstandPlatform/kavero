"use client";

import { Button } from "@Kavero/ui/components/button";
import { Spinner } from "@Kavero/ui/components/spinner";
import { useEffect, useMemo, useState } from "react";

type Purpose = "image" | "video";
type Job = { id: string; purpose: Purpose; status: "queued" | "generating" | "converting" | "done" | "error"; prompt: string; model: string; mimeType?: string; bytes?: number; error?: string };
type PreviewFormat = "original" | "gif";

export function MediaJobPreview({ jobId, purpose, onAdd }: {
  jobId: string;
  purpose: Purpose;
  onAdd: (media: File, poster?: File) => Promise<void>;
}) {
  const [job, setJob] = useState<Job | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [format, setFormat] = useState<PreviewFormat>("original");
  const [working, setWorking] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const fileUrl = useMemo(() => `/api/ai/media/jobs/${encodeURIComponent(jobId)}/file`, [jobId]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setJob(null);
    setLoadError(null);
    setFormat("original");
    const poll = async () => {
      try {
        const response = await fetch(`/api/ai/media/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" });
        const data = await response.json() as Job & { error?: string };
        if (!response.ok) throw new Error(data.error || "This generation is no longer available.");
        if (!active) return;
        setJob(data);
        setLoadError(null);
        if (["queued", "generating", "converting"].includes(data.status)) timer = setTimeout(poll, 1800);
      } catch (error) {
        if (active) setLoadError((error as Error).message);
      }
    };
    void poll();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [jobId, retryCount]);

  async function fetchFile(kind: "original" | "gif" | "poster") {
    const response = await fetch(`${fileUrl}?format=${kind}`, { cache: "no-store" });
    if (!response.ok) {
      const data = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(data?.error || "The generated file could not be retrieved.");
    }
    const blob = await response.blob();
    if (!blob.size || blob.size > 25 * 1024 * 1024) throw new Error("This result exceeds the 25 MB catalog asset limit.");
    return blob;
  }

  async function convertToGif() {
    setWorking(true);
    setLoadError(null);
    try {
      await fetchFile("gif");
      setFormat("gif");
    } catch (error) {
      setLoadError((error as Error).message);
    } finally {
      setWorking(false);
    }
  }

  async function addToSlide() {
    setWorking(true);
    setLoadError(null);
    try {
      const blob = await fetchFile(format === "gif" ? "gif" : "original");
      const mimeType = format === "gif" ? "image/gif" : job?.mimeType ?? blob.type;
      const extension = mimeType === "video/mp4" ? "mp4" : mimeType === "image/gif" ? "gif" : mimeType === "image/svg+xml" ? "svg" : mimeType.split("/")[1] || "png";
      const media = new File([blob], `generated-media.${extension}`, { type: mimeType });
      const poster = mediaPurpose === "video" && format === "original"
        ? new File([await fetchFile("poster")], "generated-video-cover.png", { type: "image/png" })
        : undefined;
      await onAdd(media, poster);
    } catch (error) {
      setLoadError((error as Error).message);
    } finally {
      setWorking(false);
    }
  }

  const previewSrc = `${fileUrl}?format=${format === "gif" ? "gif" : "original"}`;
  const status = job?.status;
  const mediaPurpose = job?.purpose ?? purpose;
  return (
    <article className="grid gap-2 rounded-lg border bg-card p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium capitalize">Generated {format === "gif" ? "GIF" : mediaPurpose}</span>
        {status && status !== "done" && status !== "error" && <span className="flex items-center gap-1 text-[10px] text-muted-foreground"><Spinner className="size-3" /> {status === "queued" ? "Queued" : status === "converting" ? "Converting" : "Generating"}…</span>}
      </div>
      {status === "done" && (mediaPurpose === "video" && format === "original"
        ? <video key={previewSrc} src={previewSrc} poster={`${fileUrl}?format=poster`} controls playsInline className="max-h-56 w-full rounded-md bg-black" />
        : <img src={previewSrc} alt="Generated preview" className="max-h-64 w-full rounded-md bg-muted object-contain" />)}
      {loadError && <p role="alert" className="rounded-md bg-destructive/10 p-2 text-[11px] text-destructive">{loadError}</p>}
      {status === "error" && <p role="alert" className="rounded-md bg-destructive/10 p-2 text-[11px] text-destructive">{job?.error || "Generation failed."}</p>}
      {status === "done" && job && <p className="text-[10px] text-muted-foreground">{job.model}{job.bytes ? ` · ${(job.bytes / 1024 / 1024).toFixed(1)} MB` : ""}</p>}
      <div className="flex flex-wrap gap-1.5">
        {loadError && !job && <Button type="button" size="xs" variant="outline" onClick={() => setRetryCount((count) => count + 1)}>Retry status</Button>}
        {mediaPurpose === "video" && format === "original" && status === "done" && <Button type="button" size="xs" variant="outline" disabled={working} onClick={() => void convertToGif()}>{working ? <Spinner data-icon="inline-start" /> : null} Convert to GIF</Button>}
        {format === "gif" && <Button type="button" size="xs" variant="ghost" disabled={working} onClick={() => setFormat("original")}>Back to video</Button>}
        {status === "done" && <Button type="button" size="xs" disabled={working} onClick={() => void addToSlide()}>{working ? <Spinner data-icon="inline-start" /> : null} Add to slide</Button>}
      </div>
    </article>
  );
}
