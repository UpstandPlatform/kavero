import type { CatalogDocument } from "@Kavero/catalog-engine";

const SYSTEM_FONTS = new Set(["system-ui", "sans-serif", "serif", "monospace", "Arial", "Helvetica", "Georgia", "Times New Roman"]);

/** Families provided by font files stored in the catalog. */
export function embeddedFamilies(doc: CatalogDocument): Set<string> {
  return new Set(doc.assets.filter((a) => a.kind === "font" && a.family).map((a) => a.family!));
}

/** Font families used by the theme and by text elements. */
export function usedFonts(doc: CatalogDocument): string[] {
  const fonts = new Set(Object.values(doc.theme.fonts));
  for (const s of doc.slides) for (const e of s.elements) {
    if (e.type === "text" && !e.style.fontFamily.startsWith("token:")) fonts.add(e.style.fontFamily);
  }
  return [...fonts].filter((f) => f && !SYSTEM_FONTS.has(f));
}

/** A Google Fonts stylesheet URL for families that aren't embedded in the catalog, or null. */
export function googleFontsUrl(families: string[], embedded: Set<string> = new Set()): string | null {
  const remote = families.filter((f) => !embedded.has(f));
  if (!remote.length) return null;
  const q = remote.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:ital,wght@0,400;0,600;0,700;1,400`).join("&");
  return `https://fonts.googleapis.com/css2?${q}&display=swap`;
}

const FORMAT: Record<string, string> = {
  "font/woff2": "woff2", "font/woff": "woff", "font/ttf": "truetype", "font/otf": "opentype",
  "application/font-woff2": "woff2", "application/font-woff": "woff", "application/x-font-ttf": "truetype",
};

/** @font-face rules for every embedded font whose file can be resolved to a URL. */
export function fontFaceCss(doc: CatalogDocument, resolveAsset: (id: string) => string | undefined): string {
  return doc.assets
    .filter((a) => a.kind === "font" && a.family)
    .map((a) => {
      const url = resolveAsset(a.id);
      if (!url) return "";
      const fmt = FORMAT[a.mimeType];
      const family = a.family!.replace(/["\\]/g, "");
      return `@font-face{font-family:"${family}";src:url("${url}")${fmt ? ` format("${fmt}")` : ""};font-weight:${a.fontWeight ?? 400};font-style:${a.fontStyle ?? "normal"};font-display:block}`;
    })
    .join("\n");
}
