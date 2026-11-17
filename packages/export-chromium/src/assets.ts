import { randomUUID } from "node:crypto";

/**
 * Catalog assets for an export, decoded once in Node and served to headless
 * Chrome over a private URL instead of being pushed into the page as data: URLs.
 *
 * Passing every image as base64 through page.evaluate makes one huge DevTools
 * message and keeps all of it in the renderer's JS heap; with a large, high
 * resolution catalog Chrome runs out of memory and the export fails with
 * "Target page, context or browser has been closed".
 */
export interface AssetStore {
  /** assetId → URL the render page loads it from. */
  urls: Record<string, string>;
  /** Path prefix (under the app origin) that openRenderPage serves from `files`. */
  prefix: string;
  files: Map<string, { body: Buffer; contentType: string }>;
}

const DATA_URL = /^data:([^;,]+)(;base64)?,/;

export function createAssetStore(assets: Record<string, string>, appUrl: string): AssetStore {
  const origin = new URL(appUrl).origin;
  const prefix = `/__kavero_export_asset/${randomUUID()}/`;
  const urls: Record<string, string> = {};
  const files = new Map<string, { body: Buffer; contentType: string }>();
  for (const [id, value] of Object.entries(assets)) {
    const match = DATA_URL.exec(value);
    if (!match) {
      urls[id] = value; // already a URL the page may load (checked by the page's network rules)
      continue;
    }
    const raw = value.slice(match[0].length);
    const body = match[2] ? Buffer.from(raw, "base64") : Buffer.from(decodeURIComponent(raw), "utf8");
    const key = encodeURIComponent(id);
    files.set(key, { body, contentType: match[1]! });
    urls[id] = `${origin}${prefix}${key}`;
  }
  return { urls, prefix, files };
}
