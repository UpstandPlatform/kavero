import { randomUUID } from "node:crypto";
import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CatalogDocument } from "@Kavero/catalog-engine";
import { renderVideo } from "@Kavero/export-chromium";

export interface VideoJob {
  id: string;
  status: "queued" | "rendering" | "encoding" | "done" | "error" | "cancelled";
  frame: number;
  totalFrames: number;
  error?: string;
  file: string;
  title: string;
  bytes?: number;
  createdAt: number;
  controller: AbortController;
}

// Survives dev hot reloads.
const g = globalThis as unknown as { __kaveroVideoJobs?: Map<string, VideoJob>; __kaveroVideoQueue?: Promise<void> };
const jobs = (g.__kaveroVideoJobs ??= new Map());

const DIR = join(tmpdir(), "kavero-exports");
const KEEP_MS = 60 * 60 * 1000;
export const MAX_ACTIVE_JOBS = 3;

function cleanup() {
  const now = Date.now();
  for (const [id, j] of jobs) {
    if (now - j.createdAt > KEEP_MS) {
      jobs.delete(id);
      void rm(j.file, { force: true });
    }
  }
}

export function getJob(id: string) {
  return jobs.get(id);
}

export function activeJobs() {
  return [...jobs.values()].filter((j) => ["queued", "rendering", "encoding"].includes(j.status)).length;
}

/** Queue a render. Jobs run one at a time: each one drives a full Chrome instance. */
export async function startVideoJob(input: { doc: CatalogDocument; assets: Record<string, string>; baseUrl: string; fps: number; height: number }): Promise<VideoJob> {
  cleanup();
  await mkdir(DIR, { recursive: true });
  const id = randomUUID();
  const job: VideoJob = {
    id, status: "queued", frame: 0, totalFrames: 0, file: join(DIR, `${id}.mp4`),
    title: input.doc.metadata.title, createdAt: Date.now(), controller: new AbortController(),
  };
  jobs.set(id, job);

  const run = async () => {
    if (job.status === "cancelled") return;
    job.status = "rendering";
    try {
      await renderVideo({
        doc: input.doc, assets: input.assets, baseUrl: input.baseUrl, outFile: job.file,
        fps: input.fps, height: input.height, signal: job.controller.signal,
        onProgress: (p) => {
          job.frame = p.frame;
          job.totalFrames = p.totalFrames;
          if (p.phase === "encoding") job.status = "encoding";
        },
      });
      job.bytes = (await stat(job.file)).size;
      job.status = "done";
    } catch (e) {
      job.status = job.controller.signal.aborted ? "cancelled" : "error";
      job.error = (e as Error).message;
      await rm(job.file, { force: true });
    }
  };
  g.__kaveroVideoQueue = (g.__kaveroVideoQueue ?? Promise.resolve()).then(run, run);
  return job;
}

export function cancelJob(id: string) {
  const job = jobs.get(id);
  if (!job) return false;
  if (job.status === "queued") job.status = "cancelled";
  job.controller.abort();
  return true;
}

export function publicJob(j: VideoJob) {
  return { id: j.id, status: j.status, frame: j.frame, totalFrames: j.totalFrames, error: j.error, bytes: j.bytes, title: j.title };
}
