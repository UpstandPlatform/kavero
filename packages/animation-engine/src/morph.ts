import type { CatalogElement, CatalogSlide } from "@Kavero/catalog-engine";

/**
 * Morph (PowerPoint-style "magic move"): elements that appear on both slides
 * glide from their old position, size, rotation, colors and font size to the new
 * ones. Everything else cross-fades. Pure functions of progress, like the rest
 * of the engine, so preview, website and video match.
 */

export type MorphPair = [from: CatalogElement, to: CatalogElement];

/** Identities an element answers to: its id and the id of what it was copied from. */
const identities = (el: CatalogElement) => (el.morphKey ? [el.id, el.morphKey] : [el.id]);

/** What an element shows, used to match elements that weren't copied from each other. */
function signature(el: CatalogElement): string | null {
  switch (el.type) {
    case "text": {
      const t = el.content.paragraphs.map((runs) => runs.map((r) => r.text).join("")).join("\n").trim();
      return t ? `text:${t}` : null;
    }
    case "image": return `image:${el.content.assetId}`;
    case "product": return `product:${el.content.productId}`;
    case "product-grid": return el.content.products.length ? `grid:${el.content.products.map((p) => p.productId).join(",")}` : null;
    case "button": return `button:${el.content.label}`;
    case "shape": return `shape:${el.content.shape}`;
    case "video": return `video:${el.content.assetId ?? el.content.url ?? ""}`;
    case "icon": return `icon:${el.content.name}`;
    case "html": return `html:${el.content.html.length}:${el.content.html.slice(0, 200)}`;
  }
}

/**
 * Pair elements of two slides. In order of confidence:
 * 1. copies of the same element (duplicated slide, copy/paste),
 * 2. the same custom layer name,
 * 3. the same content (same text, image, product…) when it is unique on both slides.
 * Each element is used at most once and only elements of the same type are paired.
 */
export function matchMorph(from: CatalogSlide, to: CatalogSlide): MorphPair[] {
  const a = from.elements.filter((e) => !e.hidden).sort((x, y) => x.zIndex - y.zIndex);
  const b = to.elements.filter((e) => !e.hidden).sort((x, y) => x.zIndex - y.zIndex);
  const usedA = new Set<string>();
  const usedB = new Set<string>();
  const pairs: MorphPair[] = [];
  const pair = (x: CatalogElement, y: CatalogElement) => {
    usedA.add(x.id);
    usedB.add(y.id);
    pairs.push([x, y]);
  };

  for (const y of b) {
    const ids = new Set(identities(y));
    const x = a.find((e) => !usedA.has(e.id) && e.type === y.type && identities(e).some((k) => ids.has(k)));
    if (x) pair(x, y);
  }
  for (const y of b) {
    if (usedB.has(y.id) || !y.name) continue;
    const x = a.find((e) => !usedA.has(e.id) && e.type === y.type && e.name === y.name);
    if (x) pair(x, y);
  }
  const bySig = (list: CatalogElement[], used: Set<string>) => {
    const m = new Map<string, CatalogElement[]>();
    for (const e of list) {
      if (used.has(e.id)) continue;
      const s = signature(e);
      if (s) m.set(s, [...(m.get(s) ?? []), e]);
    }
    return m;
  };
  const sigA = bySig(a, usedA);
  for (const [s, ys] of bySig(b, usedB)) {
    const xs = sigA.get(s);
    if (xs?.length === 1 && ys.length === 1) pair(xs[0]!, ys[0]!);
  }
  return pairs.sort((p, q) => p[1].zIndex - q[1].zIndex);
}

// ---------- Interpolation ----------

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type Rgba = [number, number, number, number];

/** Parses #rgb, #rrggbb, #rrggbbaa, rgb() and rgba(); anything else is not interpolated. */
export function parseColor(v: string): Rgba | null {
  const s = v.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,4})$/.exec(s);
  if (m) {
    const [r, g, b, a = "f"] = m[1]!.split("");
    return [parseInt(r! + r, 16), parseInt(g! + g, 16), parseInt(b! + b, 16), parseInt(a + a, 16) / 255];
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (m) {
    const n = parseInt(m[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) / 255 : 1];
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [+m[1]!, +m[2]!, +m[3]!, alpha];
  }
  if (s === "transparent") return [0, 0, 0, 0];
  return null;
}

function mixColor(a: string, b: string, t: number, resolve: (v: string) => string): string | null {
  const x = parseColor(resolve(a));
  const y = parseColor(resolve(b));
  if (!x || !y) return null;
  const c = x.map((v, i) => lerp(v, y[i]!, t));
  return `rgba(${Math.round(c[0]!)}, ${Math.round(c[1]!)}, ${Math.round(c[2]!)}, ${+c[3]!.toFixed(3)})`;
}

function mixValue(a: unknown, b: unknown, t: number, resolve: (v: string) => string): unknown {
  if (typeof a === "number" && typeof b === "number") return lerp(a, b, t);
  if (typeof a === "string" && typeof b === "string") return a === b ? b : (mixColor(a, b, t, resolve) ?? (t < 0.5 ? a : b));
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const out: Record<string, unknown> = { ...(b as Record<string, unknown>) };
    for (const k of Object.keys(out)) if (k in (a as object)) out[k] = mixValue((a as Record<string, unknown>)[k], out[k], t, resolve);
    return out;
  }
  return t < 0.5 && a !== undefined ? a : b;
}

/** Rotate the short way round (350° → 10° turns 20°, not 340°). */
function mixAngle(a: number, b: number, t: number) {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return a + d * t;
}

export interface MorphFrame {
  /** The element at this moment: incoming content, interpolated geometry and style. */
  to: CatalogElement;
  /** Set when the content differs: the outgoing content in the same interpolated box, to cross-fade. */
  from?: CatalogElement;
  /** Cross-fade weight of `to` (0 → 1). */
  mix: number;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * One morphing element at progress t (0 → 1, already eased).
 * `resolve` turns theme tokens into CSS colors so token colors interpolate too.
 */
export function morphElement(a: CatalogElement, b: CatalogElement, t: number, resolve: (v: string) => string = (v) => v): MorphFrame {
  const position = {
    x: lerp(a.position.x, b.position.x, t),
    y: lerp(a.position.y, b.position.y, t),
    width: lerp(a.position.width, b.position.width, t),
    height: lerp(a.position.height, b.position.height, t),
    rotation: mixAngle(a.position.rotation, b.position.rotation, t),
  };
  const style = mixValue((a as { style?: unknown }).style, (b as { style?: unknown }).style, t, resolve);
  const opacity = lerp(a.opacity, b.opacity, t);
  const to = { ...b, position, style, opacity, animations: [] } as CatalogElement;
  if (same(a.content, b.content)) return { to, mix: 1 };
  return { to, from: { ...a, position, style, opacity, animations: [] } as CatalogElement, mix: t };
}
