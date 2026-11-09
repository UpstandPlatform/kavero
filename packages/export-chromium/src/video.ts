import { spawn } from "node:child_process";

import { buildTimeline, frameAt, scheduleSlide } from "@Kavero/animation-engine";
import type { CatalogDocument } from "@Kavero/catalog-engine";

import { ffmpegPath, launchBrowser } from "./browser";
import { openRenderPage } from "./network";

export interface VideoOptions {
  doc: CatalogDocument;
  /** assetId → data: URL, so the headless page needs no access to the user's storage. */
  assets: Record<string, string>;
  /** Origin of the Kavero app serving /render (e.g. http://localhost:3001). */
  baseUrl: string;
  outFile: string;
  fps?: number;
  /** Output height in px (width follows the page ratio). Defaults to the document size. */
  height?: number;
  onProgress?: (p: { frame: number; totalFrames: number; phase: "starting" | "rendering" | "encoding" }) => void;
  signal?: AbortSignal;
}

/**
 * Frames that can't differ from the previous one: no transition is running and
 * every element animation on the slide has finished. Those reuse the last screenshot.
 */
function staticFrameKey(doc: CatalogDocument, t: number, timeline: ReturnType<typeof buildTimeline>, settledAt: number[]): string | null {
  const f = frameAt(timeline, t);
  if (f.transition) return null;
  if (f.current.localMs < settledAt[f.current.slideIndex]!) return null;
  const slide = doc.slides[f.current.slideIndex]!;
  if (slide.elements.some((e) => e.type === "video")) return null;
  return `slide:${f.current.slideIndex}`;
}

/** Render the catalog timeline to an MP4 (H.264) using headless Chrome + ffmpeg. */
export async function renderVideo(opts: VideoOptions): Promise<{ frames: number; durationMs: number }> {
  const { doc, fps = 30 } = opts;
  const timeline = buildTimeline(doc);
  const totalFrames = Math.max(1, Math.ceil((timeline.totalMs / 1000) * fps));
  const scale = opts.height ? opts.height / doc.settings.height : 1;
  // H.264 with yuv420p needs even dimensions.
  const width = Math.round((doc.settings.width * scale) / 2) * 2;
  const height = Math.round((doc.settings.height * scale) / 2) * 2;
  const settledAt = doc.slides.map((s, i) => {
    const seg = timeline.segments[i]!;
    const tr = seg.transition ? seg.transition.delayMs + seg.transition.durationMs : 0;
    return Math.max(tr, ...scheduleSlide(s).map((a) => a.endMs)) + 1;
  });

  opts.onProgress?.({ frame: 0, totalFrames, phase: "starting" });
  // Video jobs are already queued one at a time; wait as long as it takes for a Chrome slot.
  const browser = await launchBrowser({ queueTimeoutMs: 30 * 60_000 });
  const ffmpeg = spawn(ffmpegPath(), [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-",
    "-vf", `scale=${width}:${height}:flags=lanczos,format=yuv420p`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-r", String(fps),
    "-movflags", "+faststart",
    opts.outFile,
  ], { stdio: ["pipe", "ignore", "pipe"] });
  let ffmpegErr = "";
  ffmpeg.stderr.on("data", (d) => (ffmpegErr += d));
  const ffmpegDone = new Promise<void>((resolve, reject) => {
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code}): ${ffmpegErr.slice(-500)}`))));
  });
  const write = (buf: Buffer) =>
    new Promise<void>((resolve, reject) => (ffmpeg.stdin.write(buf, (e) => (e ? reject(e) : resolve()))));

  try {
    const page = await openRenderPage(browser, opts.baseUrl, { viewport: { width, height }, deviceScaleFactor: 1 });
    await page.waitForFunction(() => typeof (window as unknown as { __kaveroLoad?: unknown }).__kaveroLoad === "function", null, { timeout: 30_000 });
    await page.evaluate(
      async ({ doc, assets, scale }) => {
        const w = window as unknown as { __kaveroLoad: (d: unknown, a: unknown, s: number) => Promise<void> };
        await w.__kaveroLoad(doc, assets, scale);
      },
      { doc, assets: opts.assets, scale: width / doc.settings.width },
    );

    let lastKey: string | null = null;
    let lastBuf: Buffer | null = null;
    for (let i = 0; i < totalFrames; i++) {
      if (opts.signal?.aborted) throw new Error("Export cancelled");
      const t = (i / fps) * 1000;
      const key = staticFrameKey(doc, t, timeline, settledAt);
      if (key && key === lastKey && lastBuf) {
        await write(lastBuf);
      } else {
        await page.evaluate((time) => (window as unknown as { __kaveroSeek: (t: number) => Promise<void> }).__kaveroSeek(time), t);
        lastBuf = await page.screenshot({ type: "jpeg", quality: 92, animations: "disabled", caret: "hide" });
        lastKey = key;
        await write(lastBuf);
      }
      if (i % 5 === 0) opts.onProgress?.({ frame: i, totalFrames, phase: "rendering" });
    }
    opts.onProgress?.({ frame: totalFrames, totalFrames, phase: "encoding" });
    ffmpeg.stdin.end();
    await ffmpegDone;
    return { frames: totalFrames, durationMs: timeline.totalMs };
  } catch (e) {
    ffmpeg.kill("SIGKILL");
    throw e;
  } finally {
    await browser.close();
  }
}
