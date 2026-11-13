import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { imageModelFromCredential, videoModelFromCredential, type AiProvider } from "@Kavero/ai";
import { createResilientRateLimiter } from "@Kavero/redis";
import { createDownload, experimental_generateVideo, generateImage } from "ai";
import { ffmpegPath } from "@Kavero/export-chromium";

export type MediaPurpose = "image" | "video";
export type MediaJobStatus = "queued" | "generating" | "converting" | "done" | "error";
export interface MediaJob {
  id: string;
  userId: string;
  purpose: MediaPurpose;
  prompt: string;
  provider: AiProvider;
  model: string;
  status: MediaJobStatus;
  createdAt: number;
  file: string;
  posterFile?: string;
  mimeType?: string;
  bytes?: number;
  error?: string;
  expiresAt?: number;
  expiryTimer?: ReturnType<typeof setTimeout>;
  gifPromise?: Promise<void>;
  controller: AbortController;
}

const g = globalThis as unknown as { __kaveroAiMediaJobs?: Map<string, MediaJob>; __kaveroAiMediaQueue?: Promise<void> };
const jobs = (g.__kaveroAiMediaJobs ??= new Map());
const DIR = join(tmpdir(), "kavero-ai-media");
const KEEP_MS = 60 * 60 * 1000;
const GENERATION_TIMEOUTS = { image: 5 * 60_000, video: 16 * 60_000 } as const;
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
export const MAX_ACTIVE_MEDIA_JOBS = 6;
const mediaRateLimiter = createResilientRateLimiter({ namespace: "ai-media", maxRequests: 8, windowMs: 60_000 });

export class MediaJobCapacityError extends Error {
  constructor() {
    super("Media generation is busy. Wait for a current job to finish, then try again.");
    this.name = "MediaJobCapacityError";
  }
}

export class MediaJobRateLimitError extends Error {
  constructor() {
    super("Too many media generations. Wait a minute and try again.");
    this.name = "MediaJobRateLimitError";
  }
}

const GOOGLE_IMAGE_ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "1:8", "8:1", "1:4", "4:1"] as const;

function normalizeAspectRatio(provider: AiProvider, purpose: MediaPurpose, value: string, supportedAspectRatios: string[] = []): `${number}:${number}` | undefined {
  const [width, height] = value.split(":").map(Number);
  const ratio = width! / height!;
  if (provider === "google" && purpose === "image") {
    // Gemini image generation only accepts these aspect ratios; pick the closest one for custom slide sizes.
    return GOOGLE_IMAGE_ASPECT_RATIOS.reduce((best, candidate) => {
      const [w, h] = candidate.split(":").map(Number);
      const [bw, bh] = best.split(":").map(Number);
      return Math.abs(Math.log(ratio / (w! / h!))) < Math.abs(Math.log(ratio / (bw! / bh!))) ? candidate : best;
    }, GOOGLE_IMAGE_ASPECT_RATIOS[0]!);
  }
  if (provider === "google" && purpose === "video") return ratio >= 1 ? "16:9" : "9:16";
  if (provider === "openrouter" && purpose === "video") {
    if (!supportedAspectRatios.length) return undefined;
    return supportedAspectRatios.reduce((best, candidate) => {
      const [w, h] = candidate.split(":").map(Number);
      const [bw, bh] = best.split(":").map(Number);
      return Math.abs(Math.log(ratio / (w! / h!))) < Math.abs(Math.log(ratio / (bw! / bh!))) ? candidate : best;
    }) as `${number}:${number}`;
  }
  // Gateway video models do not publish supported ratios in model discovery; leave the
  // field unset so the selected provider uses its documented default instead of rejecting
  // a custom slide ratio.
  if (provider === "ai-gateway" && purpose === "video") return undefined;
  return value as `${number}:${number}`;
}

function cleanup() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.expiresAt !== undefined && now > job.expiresAt) {
      jobs.delete(id);
      void rm(job.file, { force: true });
      void rm(`${job.file}.gif`, { force: true });
      if (job.posterFile) void rm(job.posterFile, { force: true });
    }
  }
}

function scheduleExpiry(job: MediaJob) {
  if (job.expiryTimer) clearTimeout(job.expiryTimer);
  job.expiresAt = Date.now() + KEEP_MS;
  job.expiryTimer = setTimeout(() => {
    if (jobs.get(job.id) !== job) return;
    jobs.delete(job.id);
    void rm(job.file, { force: true });
    void rm(`${job.file}.gif`, { force: true });
    if (job.posterFile) void rm(job.posterFile, { force: true });
  }, KEEP_MS);
  job.expiryTimer.unref();
}

function runFfmpeg(args: string[], timeoutMs = 120_000) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("FFmpeg conversion timed out. Try the MP4 or a shorter video."));
    }, timeoutMs);
    timer.unref();
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-400); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`FFmpeg conversion failed (${code}): ${stderr}`));
    });
  });
}

export async function startMediaJob(input: {
  userId: string;
  purpose: MediaPurpose;
  prompt: string;
  provider: AiProvider;
  model: string;
  apiKey: string;
  baseUrl?: string | null;
  appUrl?: string;
  supportedAspectRatios?: string[];
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  aspectRatio: string;
}): Promise<MediaJob> {
  if (!(await mediaRateLimiter.limit(input.userId)).allowed) throw new MediaJobRateLimitError();
  cleanup();
  await mkdir(DIR, { recursive: true });
  const activeJobs = [...jobs.values()].filter((job) => ["queued", "generating", "converting"].includes(job.status)).length;
  if (activeJobs >= MAX_ACTIVE_MEDIA_JOBS) throw new MediaJobCapacityError();
  const id = randomUUID();
  const aspectRatio = normalizeAspectRatio(input.provider, input.purpose, input.aspectRatio, input.supportedAspectRatios);
  const job: MediaJob = {
    id, userId: input.userId, purpose: input.purpose, prompt: input.prompt, provider: input.provider, model: input.model,
    status: "queued", createdAt: Date.now(), file: join(DIR, `${id}.${input.purpose === "video" ? "mp4" : "png"}`),
    controller: new AbortController(),
  };
  jobs.set(id, job);

  const generate = async () => {
    job.status = "generating";
    const timeout = setTimeout(() => job.controller.abort(new Error("Media generation timed out")), GENERATION_TIMEOUTS[input.purpose]);
    timeout.unref();
    try {
      if (input.purpose === "image") {
        const imageModel = imageModelFromCredential(input);
        const result = await generateImage({
          model: imageModel,
          prompt: input.prompt,
          // OpenAI-compatible adapters reject `aspectRatio`; OpenRouter's ratio support is
          // model-specific, so it needs a separate adapter to pass only a known value.
          ...(input.provider === "google" && aspectRatio ? { aspectRatio } : {}),
          n: 1, maxRetries: 1, abortSignal: job.controller.signal,
        });
        const bytes = result.image.uint8Array;
        if (!bytes.byteLength || bytes.byteLength > MAX_MEDIA_BYTES) throw new Error("The generated image is empty or larger than the 25 MB asset limit. Try a shorter prompt or lower detail.");
        const svgText = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.byteLength, 16_384)));
        const isSvg = result.image.mediaType === "image/svg+xml"
          || /^\uFEFF?\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!doctype\s+svg\b[^>]*>\s*)*<svg(?:[\s>])/i.test(svgText);
        job.mimeType = isSvg ? "image/svg+xml" : result.image.mediaType || "image/png";
        if (!["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"].includes(job.mimeType)) throw new Error("The image provider returned an unsupported file type.");
        if (job.mimeType !== "image/png") {
          const extension = job.mimeType === "image/svg+xml" ? "svg" : job.mimeType.split("/")[1];
          job.file = join(DIR, `${id}.${extension?.replace(/[^a-z0-9]/gi, "") || "img"}`);
        }
        await writeFile(job.file, bytes);
        job.bytes = bytes.byteLength;
      } else {
        const result = await experimental_generateVideo({
          model: videoModelFromCredential(input), prompt: input.prompt, ...(aspectRatio ? { aspectRatio } : {}),
          n: 1, maxRetries: 1, abortSignal: job.controller.signal,
          download: createDownload({ maxBytes: MAX_MEDIA_BYTES }),
          poll: { timeoutMs: 15 * 60_000 },
        });
        const bytes = result.video.uint8Array;
        if (!bytes.byteLength || bytes.byteLength > MAX_MEDIA_BYTES) throw new Error("The generated video is empty or larger than the 25 MB asset limit. Try a shorter prompt.");
        if (result.video.mediaType !== "video/mp4") throw new Error("The video provider returned an unsupported format. Kavero currently accepts MP4 video.");
        job.mimeType = result.video.mediaType;
        await writeFile(job.file, bytes);
        job.bytes = bytes.byteLength;
        job.posterFile = `${job.file}.png`;
        await runFfmpeg(["-y", "-loglevel", "error", "-ss", "0.5", "-i", job.file, "-frames:v", "1", job.posterFile]);
        const poster = await stat(job.posterFile);
        if (!poster.size || poster.size > MAX_MEDIA_BYTES) throw new Error("Could not create a usable video cover image.");
      }
      job.status = "done";
      scheduleExpiry(job);
    } catch (error) {
      job.status = "error";
      job.error = (job.controller.signal.aborted ? "Media generation timed out. Try again with a shorter prompt." : error instanceof Error ? error.message : "Media generation failed.").slice(0, 500);
      await Promise.all([rm(job.file, { force: true }), ...(job.posterFile ? [rm(job.posterFile, { force: true })] : [])].map((operation) => operation.catch(() => undefined)));
      scheduleExpiry(job);
    } finally {
      clearTimeout(timeout);
    }
  };
  // Provider jobs are bounded separately from Chrome rendering and continue after the request returns.
  g.__kaveroAiMediaQueue = (g.__kaveroAiMediaQueue ?? Promise.resolve()).then(generate, generate);
  return job;
}

export function getMediaJob(id: string) {
  cleanup();
  return jobs.get(id);
}

export function publicMediaJob(job: MediaJob) {
  return { id: job.id, purpose: job.purpose, status: job.status, prompt: job.prompt, provider: job.provider, model: job.model, mimeType: job.mimeType, bytes: job.bytes, error: job.error, createdAt: job.createdAt };
}

export async function mediaJobFile(job: MediaJob, format: "original" | "gif" | "poster" = "original") {
  const available = job.status === "done" || job.status === "converting";
  if (format === "poster" && available && job.purpose === "video" && job.posterFile) {
    const info = await stat(job.posterFile);
    return { file: job.posterFile, mimeType: "image/png", bytes: info.size };
  }
  if (format === "original") {
    if (!available) throw new Error("This media job has no completed result yet.");
    return { file: job.file, mimeType: job.mimeType ?? "application/octet-stream", bytes: job.bytes ?? 0 };
  }
  if (format !== "gif" || job.purpose !== "video") throw new Error("This media format is not available for the job.");
  if (!available) throw new Error("This media job has no completed result yet.");
  const gif = `${job.file}.gif`;
  if (!job.gifPromise) {
    job.status = "converting";
    scheduleExpiry(job);
    job.gifPromise = (async () => {
      try {
        const existing = await stat(gif).catch(() => null);
        if (!existing?.size || existing.size > MAX_MEDIA_BYTES) {
          if (existing) await rm(gif, { force: true });
          await runFfmpeg([
            "-y", "-loglevel", "error", "-i", job.file, "-t", "20",
            "-vf", "fps=12,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer",
            "-loop", "0", gif,
          ]);
          const info = await stat(gif);
          if (!info.size) throw new Error("FFmpeg produced an empty GIF.");
          if (info.size > MAX_MEDIA_BYTES) throw new Error("The GIF exceeds the 25 MB asset limit. Convert a shorter video or use the MP4.");
        }
        scheduleExpiry(job);
      } catch (error) {
        await rm(gif, { force: true });
        throw error;
      } finally {
        job.status = "done";
        job.gifPromise = undefined;
      }
    })();
  }
  await job.gifPromise;
  const info = await stat(gif);
  return { file: gif, mimeType: "image/gif", bytes: info.size };
}

export async function readMediaFile(file: string) {
  return readFile(file);
}
