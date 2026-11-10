"use client";

import { Button } from "@Kavero/ui/components/button";
import { Input } from "@Kavero/ui/components/input";
import { Search, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

/** Subset of the Local Font Access API (Chrome/Edge 103+). */
interface LocalFontData {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
  blob(): Promise<Blob>;
}
type QueryLocalFonts = () => Promise<LocalFontData[]>;

export type FontFace = { family: string; weight: number; style: "normal" | "italic"; source: "local" | "upload"; name: string };
export type AddFont = (blob: Blob, face: FontFace) => Promise<void>;

const WEIGHTS: [RegExp, number][] = [
  [/thin|hairline/i, 100], [/extra\s*light|ultra\s*light/i, 200], [/light/i, 300],
  [/medium/i, 500], [/semi\s*bold|demi\s*bold/i, 600], [/extra\s*bold|ultra\s*bold/i, 800],
  [/bold/i, 700], [/black|heavy/i, 900],
];

export function faceFromName(name: string): { weight: number; style: "normal" | "italic" } {
  return {
    weight: WEIGHTS.find(([re]) => re.test(name))?.[1] ?? 400,
    style: /italic|oblique/i.test(name) ? "italic" : "normal",
  };
}

const MAX_FACES = 8;

/**
 * Lets the user pick a font installed on their computer (Chrome/Edge) or upload a
 * font file. The chosen faces are copied into the catalog so exports keep them.
 */
export function FontPicker({ onAdd, onPick, onClose }: { onAdd: AddFont; onPick: (family: string) => void; onClose: () => void }) {
  const [fonts, setFonts] = useState<LocalFontData[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const supported = typeof window !== "undefined" && "queryLocalFonts" in window;

  // Move focus into the picker (the search box autofocuses when there is one) and give it back on close.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (!panel.current?.contains(document.activeElement)) (panel.current?.querySelector<HTMLElement>("input:not([type=file])") ?? panel.current)?.focus();
    return () => previous?.focus?.();
  }, []);

  async function loadLocal() {
    try {
      const list = await (window as unknown as { queryLocalFonts: QueryLocalFonts }).queryLocalFonts();
      if (!list.length) setError("No fonts were shared. Allow font access for this site and try again.");
      setFonts(list);
    } catch (e) {
      setError((e as Error).name === "SecurityError" || (e as Error).name === "NotAllowedError"
        ? "Font access was blocked. Allow “Fonts” for this site in the browser’s site settings, or upload a font file instead."
        : (e as Error).message);
    }
  }

  useEffect(() => {
    if (supported) void loadLocal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const families = useMemo(() => {
    const map = new Map<string, LocalFontData[]>();
    for (const f of fonts ?? []) map.set(f.family, [...(map.get(f.family) ?? []), f]);
    const q = query.trim().toLowerCase();
    return [...map.entries()].filter(([fam]) => !q || fam.toLowerCase().includes(q)).sort(([a], [b]) => a.localeCompare(b));
  }, [fonts, query]);

  async function chooseLocal(family: string, faces: LocalFontData[]) {
    setBusy(family);
    try {
      // Prefer the common faces when a family has many.
      const ranked = [...faces].sort((a, b) => score(a.style) - score(b.style)).slice(0, MAX_FACES);
      for (const f of ranked) {
        const { weight, style } = faceFromName(f.style);
        await onAdd(await f.blob(), { family, weight, style, source: "local", name: f.fullName });
      }
      onPick(family);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    try {
      let family = "";
      for (const file of [...files]) {
        if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) throw new Error(`${file.name} isn't a font file (.ttf, .otf, .woff, .woff2)`);
        const base = file.name.replace(/\.[^.]+$/, "");
        // "Inter-BoldItalic" → family "Inter"
        family = family || base.replace(/[-_ ]?(thin|hairline|extra\s*light|light|regular|book|medium|semi\s*bold|bold|extra\s*bold|black|heavy|italic|oblique)+$/gi, "").replace(/[-_]+/g, " ").trim() || base;
        await onAdd(file, { family, ...faceFromName(base), source: "upload", name: file.name });
      }
      onPick(family);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        onClose();
      }}
    >
      <div ref={panel} tabIndex={-1} className="flex max-h-[80vh] w-[min(440px,100%)] flex-col overflow-hidden rounded-xl border bg-background shadow-xl outline-none" role="dialog" aria-modal="true" aria-label="Choose a font">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-sm font-semibold">Fonts on this computer</h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close"><X /></Button>
        </div>
        <div className="border-b px-4 py-2 text-[11px] text-muted-foreground">
          The font file is copied into this catalog so previews, PDF and video exports look the same anywhere. Only use fonts whose license allows embedding.
        </div>
        {supported ? (
          <>
            <div className="relative border-b px-4 py-2">
              <Search className="pointer-events-none absolute top-1/2 left-6 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search fonts" aria-label="Search fonts" autoFocus className="pl-7" />
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto py-1">
              {error && <li className="px-4 py-3 text-xs text-destructive">{error} {error.includes("blocked") || error.includes("shared") ? <button className="underline" onClick={() => { setError(null); void loadLocal(); }}>Try again</button> : null}</li>}
              {!fonts && !error && <li className="px-4 py-3 text-xs text-muted-foreground">Asking the browser for your fonts…</li>}
              {families.map(([family, faces]) => (
                <li key={family}>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => chooseLocal(family, faces)}
                    className="flex w-full items-baseline gap-2 px-4 py-1.5 text-left hover:bg-muted disabled:opacity-50"
                  >
                    <span className="truncate text-base" style={{ fontFamily: `"${family}"` }}>{family}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{busy === family ? "Adding…" : `${faces.length} style${faces.length === 1 ? "" : "s"}`}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="px-4 py-4 text-xs text-muted-foreground">This browser can't list installed fonts (Chrome and Edge can). Upload the font files instead.</p>
        )}
        <div className="flex justify-end border-t px-4 py-2">
          <input ref={fileInput} type="file" multiple accept=".ttf,.otf,.woff,.woff2" className="hidden" onChange={(e) => upload(e.target.files)} />
          <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}><Upload /> Upload font files</Button>
        </div>
      </div>
    </div>
  );
}

function score(style: string) {
  const s = style.toLowerCase();
  if (s === "regular" || s === "normal" || s === "book") return 0;
  if (s === "bold") return 1;
  if (s === "italic") return 2;
  if (s === "bold italic") return 3;
  return 4;
}
