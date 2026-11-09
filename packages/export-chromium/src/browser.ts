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

export async function launchBrowser(): Promise<Browser> {
  const executablePath = CHROME_CANDIDATES.find((p) => p && existsSync(p));
  if (!executablePath) {
    throw new Error("No Chrome or Chromium found. Install Chrome or set KAVERO_CHROME_PATH.");
  }
  return chromium.launch({ executablePath, headless: true, args: ["--disable-gpu", "--font-render-hinting=none"] });
}

