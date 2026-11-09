import { existsSync } from "node:fs";
import { createRequire } from "node:module";

import { chromium, type Browser } from "playwright-core";

export function ffmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  // Bundled static binary, loaded lazily so FFMPEG_PATH alone also works.
  return (createRequire(import.meta.url)("@ffmpeg-installer/ffmpeg") as { path: string }).path;
}

const CHROME_CANDIDATES = [
  process.env.KAVERO_CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

/** Thrown when every Chrome slot stays busy for longer than the caller is willing to wait. */
export class BrowserBusyError extends Error {
  constructor() {
    super("The export service is busy. Try again in a minute.");
    this.name = "BrowserBusyError";
  }
}

/** Chrome instances allowed at once in this process (PDF, images, video, previews together). */
const MAX_BROWSERS = Math.max(1, Number(process.env.KAVERO_MAX_BROWSERS) || 2);
// Per process, and shared across dev hot reloads / route bundles.
const g = globalThis as unknown as { __kaveroBrowserSlots?: { active: number; waiting: (() => void)[] } };
const slots = (g.__kaveroBrowserSlots ??= { active: 0, waiting: [] });

async function acquireSlot(timeoutMs: number): Promise<() => void> {
  if (slots.active >= MAX_BROWSERS) {
    await new Promise<void>((resolve, reject) => {
      const grant = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        slots.waiting.splice(slots.waiting.indexOf(grant), 1);
        reject(new BrowserBusyError());
      }, timeoutMs);
      slots.waiting.push(grant);
    });
  } else slots.active++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    // Hand the slot straight to the next waiter, or free it.
    const next = slots.waiting.shift();
    if (next) next();
    else slots.active--;
  };
}

/**
 * Launch headless Chrome within the shared concurrency limit; waits up to
 * `queueTimeoutMs` for a free slot, then throws BrowserBusyError. The slot is
 * released when the browser closes or disconnects.
 */
export async function launchBrowser(opts: { queueTimeoutMs?: number } = {}): Promise<Browser> {
  const executablePath = CHROME_CANDIDATES.find((p) => p && existsSync(p));
  if (!executablePath) {
    throw new Error("No Chrome or Chromium found. Install Chrome or set KAVERO_CHROME_PATH.");
  }
  const release = await acquireSlot(opts.queueTimeoutMs ?? 30_000);
  try {
    const browser = await chromium.launch({ executablePath, headless: true, args: ["--disable-gpu", "--font-render-hinting=none", "--dns-prefetch-disable"] });
    browser.on("disconnected", release);
    return browser;
  } catch (e) {
    release();
    throw e;
  }
}

