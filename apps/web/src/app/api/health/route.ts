import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { ffmpegPath } from "@Kavero/export-chromium";
import { sql } from "drizzle-orm";

import { objectStorage } from "@/modules/storage/object-storage";
import { db } from "@/services";

import pkg from "../../../../package.json";

export const runtime = "nodejs";
// Never prerender or cache: every request runs the probes.
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 3000;

// Mirrors the lookup order in @Kavero/export-chromium (browser.ts) without launching anything.
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

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS).unref()),
  ]);
}

async function checkDb() {
  try {
    await withTimeout(db.execute(sql`select 1`));
    return true;
  } catch {
    return false;
  }
}

async function checkStorage() {
  const key = `health/probe-${randomUUID()}`;
  const probe = new Uint8Array([1]);
  try {
    const storage = objectStorage();
    await withTimeout(storage.put(key, probe));
    const read = await withTimeout(storage.get(key));
    await withTimeout(storage.delete(key));
    return read?.length === 1 && read[0] === 1;
  } catch {
    return false;
  }
}

function checkChrome() {
  return CHROME_CANDIDATES.some((p) => !!p && existsSync(p));
}

function checkFfmpeg() {
  try {
    return existsSync(ffmpegPath());
  } catch {
    return false;
  }
}

/** Liveness/readiness probe. 200 when the database answers, 503 otherwise. Never includes config or secrets. */
export async function GET() {
  const [dbOk, storageOk] = await Promise.all([checkDb(), checkStorage()]);
  const body = {
    status: dbOk ? (storageOk ? "ok" : "degraded") : "error",
    db: dbOk,
    storage: storageOk,
    chrome: checkChrome(),
    ffmpeg: checkFfmpeg(),
    version: pkg.version,
  };
  return Response.json(body, { status: dbOk ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
