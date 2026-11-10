import { readLimited, safeFetch, type UrlGuardOptions } from "./safe-fetch";

/** Largest font file accepted (same as the editor's upload limit). */
export const MAX_FONT_BYTES = 15 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export type FontMime = "font/woff2" | "font/woff" | "font/otf" | "font/ttf";

/** Font format from the file's first bytes; throws for anything that isn't a single font file. */
export function sniffFont(bytes: Uint8Array): FontMime {
  if (bytes.byteLength < 12) throw new Error("That isn't a font file (too small).");
  const tag = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (tag === "wOF2") return "font/woff2";
  if (tag === "wOFF") return "font/woff";
  if (tag === "OTTO") return "font/otf";
  if (tag === "true" || (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0)) return "font/ttf";
  if (tag === "ttcf") throw new Error("Font collections (.ttc) aren't supported. Use a single .ttf, .otf, .woff or .woff2 file.");
  throw new Error("That isn't a TTF, OTF, WOFF or WOFF2 font file.");
}

/** Download a font file from a public https URL (no private addresses, ≤ 15 MB, ≤ 5 redirects). */
export async function downloadFont(raw: string, opts: UrlGuardOptions = {}): Promise<{ bytes: Uint8Array; mimeType: FontMime }> {
  let url = raw;
  for (let hop = 0; ; hop++) {
    if (!/^https:\/\//i.test(url) && !opts.allowLocal) throw new Error("Font URLs must use https://");
    const res = await safeFetch(url, { signal: AbortSignal.timeout(30_000), headers: { accept: "font/woff2,font/woff,font/ttf,font/otf,application/octet-stream;q=0.9,*/*;q=0.5" } }, opts);
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel();
      if (hop >= MAX_REDIRECTS) throw new Error("Too many redirects");
      url = new URL(res.headers.get("location")!, url).toString();
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`Couldn't download the font (HTTP ${res.status})`);
    }
    if (Number(res.headers.get("content-length") ?? 0) > MAX_FONT_BYTES) throw new Error("Font files must be under 15 MB");
    const bytes = await readLimited(res.body, MAX_FONT_BYTES, "Font files must be under 15 MB");
    return { bytes, mimeType: sniffFont(bytes) };
  }
}

export interface GoogleFace { weight: number; style: "normal" | "italic"; url: string }

/** Google Fonts family names: letters, digits and spaces (e.g. "Playfair Display", "Noto Sans Arabic"). */
export const GOOGLE_FAMILY = /^[A-Za-z0-9][A-Za-z0-9 ]{0,79}$/;

const cssUrl = (family: string, weights: number[], italic: boolean) => {
  const axis = italic ? `ital,wght@${[...weights.map((w) => `0,${w}`), ...weights.map((w) => `1,${w}`)].join(";")}` : `wght@${weights.join(";")}`;
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:${axis}&display=swap`;
};

/** Parses @font-face rules; only files on fonts.gstatic.com are accepted. */
export function parseGoogleCss(css: string): GoogleFace[] {
  const faces: GoogleFace[] = [];
  for (const block of css.match(/@font-face\s*{[^}]*}/g) ?? []) {
    const weight = Number(/font-weight:\s*(\d+)/.exec(block)?.[1] ?? 400);
    const style = /font-style:\s*italic/.test(block) ? "italic" : "normal";
    const url = /src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+)\)/.exec(block)?.[1];
    if (url && !faces.some((f) => f.weight === weight && f.style === style)) faces.push({ weight, style, url });
  }
  return faces;
}

/**
 * Faces of a Google Fonts family. Asks as a non-browser client, so Google answers
 * with one complete TTF per face (every script, no unicode-range splitting).
 * Weights the family doesn't have are skipped; throws if the family doesn't exist.
 */
export async function googleFontFaces(family: string, weights: number[], italic: boolean): Promise<{ faces: GoogleFace[]; missingWeights: number[] }> {
  if (!GOOGLE_FAMILY.test(family)) throw new Error("Use the family name exactly as on fonts.google.com, e.g. \"Playfair Display\".");
  const fetchCss = async (ws: number[]) => {
    const res = await safeFetch(cssUrl(family, ws, italic), { signal: AbortSignal.timeout(20_000), headers: { "user-agent": "Kavero/1.0" } });
    const text = new TextDecoder().decode(await readLimited(res.body, 512 * 1024, "Unexpected response from Google Fonts"));
    return res.ok ? text : null;
  };
  const all = await fetchCss(weights);
  if (all) {
    const faces = parseGoogleCss(all);
    return { faces, missingWeights: weights.filter((w) => !faces.some((f) => f.weight === w)) };
  }
  // A weight the family lacks fails the whole request: retry one weight at a time.
  const faces: GoogleFace[] = [];
  for (const w of weights) {
    const css = await fetchCss([w]);
    if (css) faces.push(...parseGoogleCss(css));
  }
  if (!faces.length) {
    const any = await fetchCss([400]);
    throw new Error(any ? `"${family}" has none of the weights ${weights.join(", ")}.` : `Google Fonts has no family called "${family}". Check the exact name on fonts.google.com.`);
  }
  return { faces, missingWeights: weights.filter((w) => !faces.some((f) => f.weight === w)) };
}
