import { iconNodeSchema, type IconNode } from "./schema";

const escapeAttribute = (value: string | number) => String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * Standalone SVG markup for a stored icon (24×24 grid, stroked like Lucide). `color` must already be
 * resolved from theme tokens. Node data is schema-validated geometry, and is escaped again here.
 */
export function iconSvgMarkup(nodes: readonly IconNode[], options: { color: string; strokeWidth?: number; size?: number }) {
  const size = options.size ?? 24;
  const body = nodes.map(([tag, attributes]) =>
    `<${tag} ${Object.entries(attributes).map(([key, value]) => `${key}="${escapeAttribute(key === "fill" && value === "currentColor" ? options.color : value)}"`).join(" ")}/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${escapeAttribute(options.color)}" stroke-width="${escapeAttribute(options.strokeWidth ?? 2)}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

/** One searchable icon of an icon set. */
export interface IconIndexEntry {
  /** Kebab-case name, e.g. `alarm-clock`. */
  name: string;
  /** Human label, e.g. `Alarm clock`. */
  title: string;
  /** Other names that resolve to the same shapes. */
  aliases: string[];
  nodes: IconNode[];
}

type RawIconNode = readonly (readonly [string, Readonly<Record<string, string | number | undefined>>])[];

/** `AlarmClockCheck` → `alarm-clock-check`; numbers start a new word (`Grid2x2` → `grid-2x2`). */
export function kebabIconName(name: string) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/(^|[^0-9])([a-z])([0-9])/g, "$1$2-$3")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

/**
 * Turn an icon library export (`{ PascalName: [[tag, attrs], …] }`, as `lucide`'s `icons`) into a
 * searchable index. Exports sharing the same node array become aliases of one entry; shapes or
 * attributes outside the stored icon format are dropped.
 */
export function buildIconIndex(icons: Readonly<Record<string, RawIconNode>>): IconIndexEntry[] {
  const byNodes = new Map<RawIconNode, IconIndexEntry>();
  for (const [exportName, raw] of Object.entries(icons)) {
    if (!Array.isArray(raw)) continue;
    const name = kebabIconName(exportName);
    const existing = byNodes.get(raw);
    if (existing) {
      if (name !== existing.name && !existing.aliases.includes(name)) existing.aliases.push(name);
      continue;
    }
    const nodes = raw.flatMap(([tag, attributes]) => {
      const clean = Object.fromEntries(Object.entries(attributes).filter(([key, value]) => key !== "key" && value !== undefined)) as Record<string, string | number>;
      const parsed = iconNodeSchema.safeParse([tag, clean]);
      return parsed.success ? [parsed.data] : [];
    });
    if (!nodes.length) continue;
    const title = name.replace(/-/g, " ");
    byNodes.set(raw, { name, title: title.charAt(0).toUpperCase() + title.slice(1), aliases: [], nodes });
  }
  return [...byNodes.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Rank icons for a query: exact name, then name prefix, then word prefix, then substring;
 * aliases count slightly less than the main name. Every query word must match.
 */
export function searchIcons(index: readonly IconIndexEntry[], query: string): IconIndexEntry[] {
  const words = query.toLowerCase().trim().split(/[\s_-]+/).filter(Boolean);
  if (!words.length) return [...index];
  const joined = words.join("-");
  const scoreName = (name: string) => {
    if (name === joined) return 100;
    if (name.startsWith(joined)) return 80;
    const parts = name.split("-");
    if (!words.every((word) => name.includes(word))) return 0;
    return words.every((word) => parts.some((part) => part.startsWith(word))) ? 60 : 30;
  };
  return index
    .map((entry) => ({ entry, score: Math.max(scoreName(entry.name), ...entry.aliases.map((alias) => scoreName(alias) - 5)) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.entry.name.length - b.entry.name.length || a.entry.name.localeCompare(b.entry.name))
    .map(({ entry }) => entry);
}

/** The `element.add` payload for an icon, centred on a slide of the given size. */
export function createIconElementInput(entry: Pick<IconIndexEntry, "name" | "nodes">, options: { slideWidth: number; slideHeight: number; size?: number; color?: string; strokeWidth?: number }) {
  const size = Math.round(Math.max(8, Math.min(options.size ?? 96, options.slideWidth, options.slideHeight)));
  return {
    type: "icon" as const,
    name: entry.name,
    position: { x: Math.round((options.slideWidth - size) / 2), y: Math.round((options.slideHeight - size) / 2), width: size, height: size, rotation: 0 },
    content: { name: entry.name, library: "lucide" as const, nodes: entry.nodes.map(([tag, attributes]) => [tag, { ...attributes }] as IconNode) },
    style: { color: options.color ?? "token:text", strokeWidth: options.strokeWidth ?? 2 },
  };
}
