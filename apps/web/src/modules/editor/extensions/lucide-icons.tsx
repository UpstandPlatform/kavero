"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { StarIcon } from "@hugeicons/core-free-icons";
import { buildIconIndex, createIconElementInput, searchIcons, type IconIndexEntry } from "@Kavero/catalog-engine";
import { Button } from "@Kavero/ui/components/button";
import { Input } from "@Kavero/ui/components/input";
import { SimpleSelect } from "@Kavero/ui/components/simple-select";
import { Slider } from "@Kavero/ui/components/slider";
import { memo, useDeferredValue, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type { EditorExtension, EditorExtensionContext } from "./types";

export const LUCIDE_ICONS_EXTENSION_ID = "com.kavero.lucide-icons";
const PAGE_SIZE = 120;

// The icon set (~2,000 icons) is loaded on first use in its own chunk, not with the editor.
let iconIndex: Promise<IconIndexEntry[]> | null = null;
function loadIconIndex() {
  iconIndex ??= import("lucide").then((module) => buildIconIndex(module.icons as never)).catch((error) => {
    iconIndex = null;
    throw error;
  });
  return iconIndex;
}

const IconPreview = memo(function IconPreview({ entry, strokeWidth }: { entry: IconIndexEntry; strokeWidth: number }) {
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {entry.nodes.map(([Tag, attributes], index) => <Tag key={index} {...attributes} />)}
    </svg>
  );
});

function LucideIconsPanel({ context }: { context: EditorExtensionContext }) {
  const [icons, setIcons] = useState<IconIndexEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [size, setSize] = useState(96);
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [color, setColor] = useState("token:text");
  const [hex, setHex] = useState("#111827");

  useEffect(() => {
    let cancelled = false;
    loadIconIndex().then((index) => !cancelled && setIcons(index), () => !cancelled && setFailed(true));
    return () => { cancelled = true; };
  }, []);
  useEffect(() => setShown(PAGE_SIZE), [deferredQuery]);

  const doc = context.doc;
  const results = useMemo(() => (icons ? searchIcons(icons, deferredQuery) : []), [icons, deferredQuery]);
  const colorOptions = useMemo(() => [
    ...Object.keys(doc.theme.colors).map((key) => ({ value: `token:${key}`, label: `Theme · ${key}` })),
    { value: "custom", label: "Custom color" },
  ], [doc.theme.colors]);
  const validHex = /^#[0-9a-f]{6}$/i.test(hex);

  function insert(entry: IconIndexEntry) {
    const iconColor = color === "custom" ? (validHex ? hex : "token:text") : color;
    try {
      context.editor.execute({
        type: "element.add",
        slideId: context.activeSlideId,
        element: createIconElementInput(entry, { slideWidth: doc.settings.width, slideHeight: doc.settings.height, size, color: iconColor, strokeWidth }) as never,
      });
      toast.success(`Added the ${entry.title.toLowerCase()} icon.`);
    } catch (error) {
      toast.error((error as Error).message || "Could not add the icon.");
    }
  }

  return (
    <div className="grid gap-3 p-3">
      <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search icons" aria-label="Search Lucide icons" />
      <div className="grid gap-3 rounded-xl border p-3">
        <label className="grid gap-1.5 text-xs font-medium">
          <span className="flex justify-between">Size <span className="tabular-nums text-muted-foreground">{size}px</span></span>
          <Slider min={16} max={480} step={4} value={[size]} onValueChange={(value) => setSize(Array.isArray(value) ? value[0] ?? 96 : value)} aria-label="Icon size" />
        </label>
        <label className="grid gap-1.5 text-xs font-medium">
          <span className="flex justify-between">Stroke width <span className="tabular-nums text-muted-foreground">{strokeWidth}</span></span>
          <Slider min={0.5} max={4} step={0.25} value={[strokeWidth]} onValueChange={(value) => setStrokeWidth(Array.isArray(value) ? value[0] ?? 2 : value)} aria-label="Stroke width" />
        </label>
        <div className="grid gap-1.5">
          <span className="text-xs font-medium">Color</span>
          <SimpleSelect aria-label="Icon color" value={color} onValueChange={(value) => setColor(value ?? "token:text")} options={colorOptions} />
          {color === "custom" && (
            <div className="flex items-center gap-2">
              <input type="color" value={validHex ? hex : "#111827"} onChange={(event) => setHex(event.target.value)} aria-label="Pick a custom color" className="size-8 cursor-pointer rounded border bg-transparent" />
              <Input value={hex} onChange={(event) => setHex(event.target.value)} aria-label="Hex color" aria-invalid={!validHex} className="font-mono text-xs" />
            </div>
          )}
        </div>
      </div>
      {failed ? (
        <p className="text-xs text-muted-foreground">The icon set could not be loaded. Check your connection and reopen this panel.</p>
      ) : !icons ? (
        <p className="text-xs text-muted-foreground" aria-live="polite">Loading icons…</p>
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground" aria-live="polite">{results.length.toLocaleString()} {results.length === 1 ? "icon" : "icons"}</p>
          <div className="grid grid-cols-5 gap-1.5">
            {results.slice(0, shown).map((entry) => (
              <button
                key={entry.name}
                type="button"
                title={entry.title}
                aria-label={`Add ${entry.title} icon`}
                onClick={() => insert(entry)}
                className="grid aspect-square place-items-center rounded-lg border bg-background text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                <IconPreview entry={entry} strokeWidth={strokeWidth} />
              </button>
            ))}
          </div>
          {results.length > shown && <Button variant="outline" size="sm" onClick={() => setShown((count) => count + PAGE_SIZE)}>Show more icons</Button>}
          {!results.length && <p className="text-xs text-muted-foreground">No icons match “{query}”.</p>}
        </>
      )}
      <p className="text-[11px] text-muted-foreground">Icons from Lucide (ISC license). They are stored as vector shapes, so they follow theme colors and export to PDF, video and PowerPoint.</p>
    </div>
  );
}

/** Built-in Lucide icon picker: search the icon set and add icons to the active slide as vector icons. */
export const lucideIconsExtension: EditorExtension = {
  manifest: {
    id: LUCIDE_ICONS_EXTENSION_ID,
    name: "Lucide icons",
    description: "Search more than 1,500 open-source Lucide icons and add them to your slides with your theme colors.",
    version: "1.0.0",
    apiVersion: "1.0.0",
    publisher: { id: "kavero", name: "Kavero" },
    capabilities: ["catalog.read", "catalog.write", "editor.ui"],
    types: ["plugin"],
    defaultEnabled: true,
    categories: ["Design", "Icons"],
    homepage: "https://lucide.dev",
    license: "ISC",
  },
  contribute: (context) => ({
    panels: [{
      id: "icons",
      label: "Icons",
      icon: <HugeiconsIcon icon={StarIcon} />,
      content: <LucideIconsPanel context={context} />,
    }],
  }),
};
