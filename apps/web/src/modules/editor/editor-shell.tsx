"use client";

import { createBlankSlide, type CatalogElement } from "@Kavero/catalog-engine";
import type { Editor, EditorCommand, NewElement } from "@Kavero/editor-core";
import { CatalogFonts, SlideView } from "@Kavero/renderer";
import { Button } from "@Kavero/ui/components/button";
import {
  ArrowLeft, Circle, Code2, Copy, Play, ImagePlus, LayoutGrid, Minus, Plus, Redo2, Square, Tag, Trash2, Type, Undo2, ChevronUp, ChevronDown,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Canvas } from "./canvas";
import type { AddFont } from "./font-picker";
import { ExportMenu } from "./export-menu";
import { PreviewPlayer } from "./preview-player";
import { PropertiesPanel } from "./properties-panel";
import { useCatalogEditor, useEditorState, useRun, type SaveStatus } from "./use-catalog-editor";

export function CatalogEditorPage({ catalogId }: { catalogId: string }) {
  const { editor, loadError, assetUrls, saveStatus, uploadImage, uploadFont } = useCatalogEditor(catalogId);
  if (loadError) {
    return (
      <div className="p-8">
        <p className="mb-4 text-sm">{loadError === "not-found" ? "This catalog isn't in this browser." : `Could not open this catalog: ${loadError}`}</p>
        <Link href="/dashboard"><Button variant="outline"><ArrowLeft /> Back to catalogs</Button></Link>
      </div>
    );
  }
  if (!editor) return <p className="p-8 text-sm text-muted-foreground">Opening catalog…</p>;
  return <EditorShell editor={editor} assetUrls={assetUrls} saveStatus={saveStatus} uploadImage={uploadImage} uploadFont={uploadFont} />;
}

const SAVE_LABEL: Record<SaveStatus, string> = { saved: "Saved", saving: "Saving…", unsaved: "Unsaved changes", error: "Save failed" };

function EditorShell({ editor, assetUrls, saveStatus, uploadImage, uploadFont }: {
  editor: Editor;
  assetUrls: Record<string, string>;
  saveStatus: SaveStatus;
  uploadImage: (f: File) => Promise<{ assetId: string; width: number; height: number }>;
  uploadFont: AddFont;
}) {
  const state = useEditorState(editor);
  const run = useRun(editor);
  const doc = state.document;
  const slideIndex = Math.max(0, doc.slides.findIndex((s) => s.id === state.activeSlideId));
  const slide = doc.slides[slideIndex]!;
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [fitScale, setFitScale] = useState(0.5);
  const clipboard = useRef<CatalogElement[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const { width: W, height: H } = doc.settings;

  const [previewing, setPreviewing] = useState<false | "play" | "export">(false);

  /** Add an element centred on the slide and select it. */
  const addElement = useCallback(
    (element: Omit<NewElement, "position"> & { size?: [number, number] }) => {
      const [w, h] = element.size ?? [W * 0.4, H * 0.2];
      const { size: _s, ...rest } = element;
      const r = run({
        type: "element.add",
        slideId: slide.id,
        element: { ...rest, position: { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), width: Math.round(w), height: Math.round(h), rotation: 0 } } as NewElement,
      });
      if (r?.createdIds[0]) editor.select([r.createdIds[0]]);
    },
    [run, editor, slide.id, W, H],
  );

  async function addImage(file: File | undefined) {
    if (!file) return;
    try {
      const { assetId, width, height } = await uploadImage(file);
      const k = Math.min((W * 0.5) / width, (H * 0.6) / height, 1);
      addElement({ type: "image", content: { assetId, alt: file.name.replace(/\.[^.]+$/, "") }, size: [width * k, height * k] } as never);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable=true]")) return;
      const mod = e.metaKey || e.ctrlKey;
      const sel = editor.getState().selection;
      const cur = editor.getDocument().slides.find((s) => s.id === editor.getState().activeSlideId);
      if (!cur) return;
      const selected = cur.elements.filter((x) => sel.includes(x.id));
      const k = e.key.toLowerCase();

      if (mod && k === "z") { e.preventDefault(); e.shiftKey ? editor.redo() : editor.undo(); return; }
      if (mod && k === "y") { e.preventDefault(); editor.redo(); return; }
      if (mod && k === "a") { e.preventDefault(); editor.select(cur.elements.filter((x) => !x.hidden).map((x) => x.id)); return; }
      if (e.key === "Escape") { editor.select([]); return; }
      if (!selected.length) {
        if (e.key === "ArrowDown" || e.key === "PageDown") { const n = editor.getDocument().slides[slideIndex + 1]; if (n) { e.preventDefault(); editor.setActiveSlide(n.id); } }
        if (e.key === "ArrowUp" || e.key === "PageUp") { const p = editor.getDocument().slides[slideIndex - 1]; if (p) { e.preventDefault(); editor.setActiveSlide(p.id); } }
        if (mod && k === "v" && clipboard.current.length) paste();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        run({ type: "batch", commands: selected.map((x) => ({ type: "element.delete" as const, elementId: x.id })) });
        return;
      }
      if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const [dx, dy] = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key as "ArrowLeft"]!;
        run({ type: "batch", commands: selected.filter((x) => !x.locked).map((x) => ({ type: "element.move" as const, elementId: x.id, position: { x: x.position.x + dx, y: x.position.y + dy } })) });
        return;
      }
      if (mod && k === "c") { clipboard.current = structuredClone(selected); return; }
      if (mod && k === "x") { clipboard.current = structuredClone(selected); run({ type: "batch", commands: selected.map((x) => ({ type: "element.delete" as const, elementId: x.id })) }); return; }
      if (mod && k === "v" && clipboard.current.length) { e.preventDefault(); paste(); return; }
      if (mod && k === "d") { e.preventDefault(); clipboard.current = structuredClone(selected); paste(); return; }
      if (mod && k === "g") {
        e.preventDefault();
        const g = selected[0]?.groupId;
        if (e.shiftKey && g) run({ type: "element.ungroup", groupId: g });
        else if (selected.length > 1) run({ type: "element.group", elementIds: selected.map((x) => x.id) });
      }
    };
    function paste() {
      const commands: EditorCommand[] = clipboard.current.map((x) => {
        const { id: _id, groupId: _g, ...rest } = x;
        return { type: "element.add", slideId: editor.getState().activeSlideId, element: { ...rest, position: { ...x.position, x: x.position.x + 20, y: x.position.y + 20 } } as NewElement };
      });
      const r = run({ type: "batch", commands });
      if (r) {
        editor.select(r.createdIds);
        clipboard.current = clipboard.current.map((x) => ({ ...x, position: { ...x.position, x: x.position.x + 20, y: x.position.y + 20 } }));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, run, slideIndex]);

  const onFitScale = useCallback((s: number) => setFitScale(s), []);
  const scale = zoom === "fit" ? fitScale : zoom;
  const zoomBy = (f: number) => setZoom(Math.min(4, Math.max(0.1, Math.round(scale * f * 100) / 100)));
  const [listWidth, setListWidth] = useState(176);
  const listRef = useCallback((node: HTMLOListElement | null) => {
    if (!node) return;
    const ro = new ResizeObserver(([e]) => setListWidth(e!.contentRect.width));
    ro.observe(node);
  }, []);
  const thumbScale = Math.max(40, listWidth) / W;

  return (
    <div className="grid h-svh w-full min-w-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden">
      {/* Top bar */}
      <header className="flex min-w-0 items-center gap-2 border-b px-3 py-1.5">
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" /> Catalogs</Link>
        <input
          key={doc.metadata.title}
          defaultValue={doc.metadata.title}
          aria-label="Catalog name"
          className="ml-2 min-w-0 flex-1 truncate bg-transparent text-sm font-medium outline-none focus:underline"
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== doc.metadata.title) run({ type: "catalog.updateMetadata", changes: { title: v } }); else e.target.value = doc.metadata.title; }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        <span className={`shrink-0 text-xs ${saveStatus === "error" ? "text-destructive" : "text-muted-foreground"}`} aria-live="polite">{SAVE_LABEL[saveStatus]}</span>
        <Button variant="ghost" size="icon-sm" title="Undo (Ctrl+Z)" disabled={!state.canUndo} onClick={() => editor.undo()}><Undo2 /></Button>
        <Button variant="ghost" size="icon-sm" title="Redo (Ctrl+Shift+Z)" disabled={!state.canRedo} onClick={() => editor.redo()}><Redo2 /></Button>
        <ExportMenu doc={doc} onVideo={() => setPreviewing("export")} />
        <Button size="sm" className="ml-1" onClick={() => setPreviewing("play")} title="Play from this slide"><Play /> Preview</Button>
      </header>

      {/* Insert toolbar */}
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto border-b px-3 py-1">
        <Button variant="ghost" size="sm" title="Heading" aria-label="Heading" onClick={() => addElement({ type: "text", content: { paragraphs: [[{ text: "Heading" }]] }, style: { fontSize: Math.round(H * 0.06), fontWeight: 700, fontFamily: "token:heading" }, size: [W * 0.5, H * 0.1] } as never)}><Type /> <span className="hidden xl:inline">Heading</span></Button>
        <Button variant="ghost" size="sm" title="Text" aria-label="Text" onClick={() => addElement({ type: "text", content: { paragraphs: [[{ text: "Body text" }]] }, style: { fontSize: Math.round(H * 0.025) }, size: [W * 0.4, H * 0.08] } as never)}><Type className="size-3" /> <span className="hidden xl:inline">Text</span></Button>
        <Button variant="ghost" size="sm" title="Rectangle" aria-label="Rectangle" onClick={() => addElement({ type: "shape", content: { shape: "rect" }, size: [W * 0.2, H * 0.2] } as never)}><Square /> <span className="hidden xl:inline">Rectangle</span></Button>
        <Button variant="ghost" size="sm" title="Ellipse" aria-label="Ellipse" onClick={() => addElement({ type: "shape", content: { shape: "ellipse" }, size: [H * 0.2, H * 0.2] } as never)}><Circle /> <span className="hidden xl:inline">Ellipse</span></Button>
        <Button variant="ghost" size="sm" title="Line" aria-label="Line" onClick={() => addElement({ type: "shape", content: { shape: "line" }, style: { fill: "token:text", strokeWidth: 3 }, size: [W * 0.25, 20] } as never)}><Minus /> <span className="hidden xl:inline">Line</span></Button>
        <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(e) => addImage(e.target.files?.[0])} />
        <Button variant="ghost" size="sm" title="Image" aria-label="Image" onClick={() => fileInput.current?.click()}><ImagePlus /> <span className="hidden xl:inline">Image</span></Button>
        <Button variant="ghost" size="sm" title="Product" aria-label="Product" onClick={() => addElement({ type: "product", content: { productId: doc.products[0]?.id ?? "none" }, size: [W * 0.22, H * 0.5] } as never)}><Tag /> <span className="hidden xl:inline">Product</span></Button>
        <Button variant="ghost" size="sm" title="Product grid" aria-label="Product grid" onClick={() => addElement({ type: "product-grid", content: { products: [], columns: 3 }, size: [W * 0.8, H * 0.6] } as never)}><LayoutGrid /> <span className="hidden xl:inline">Product grid</span></Button>
        <Button variant="ghost" size="sm" title="HTML block" aria-label="HTML block" onClick={() => addElement({ type: "html", content: { html: SAMPLE_HTML, css: SAMPLE_CSS }, size: [W * 0.4, H * 0.3] } as never)}><Code2 /> <span className="hidden xl:inline">HTML</span></Button>
        <div className="ml-auto flex shrink-0 items-center gap-1 text-xs">
          <Button variant="ghost" size="icon-sm" title="Zoom out" onClick={() => zoomBy(0.8)}><Minus /></Button>
          <button type="button" className="w-12 text-center tabular-nums hover:underline" title="Fit to window" onClick={() => setZoom("fit")}>{Math.round(scale * 100)}%</button>
          <Button variant="ghost" size="icon-sm" title="Zoom in" onClick={() => zoomBy(1.25)}><Plus /></Button>
        </div>
      </div>

      <div className="grid min-h-0 grid-cols-[clamp(120px,16vw,200px)_minmax(0,1fr)_clamp(220px,24vw,272px)]">
        {/* Slide list */}
        <aside className="flex min-h-0 flex-col border-r">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs font-semibold">Slides</span>
            <Button variant="ghost" size="icon-sm" title="Add slide" onClick={() => { const r = run({ type: "slide.add", slide: createBlankSlide(`Slide ${doc.slides.length + 1}`), index: slideIndex + 1 }); if (r?.createdIds[0]) editor.setActiveSlide(r.createdIds[0]); }}><Plus /></Button>
          </div>
          <ol ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-3">
            {doc.slides.map((s, i) => (
              <li key={s.id} className="group">
                <div className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <span className="tabular-nums">{i + 1}</span>
                  <span className="truncate">{s.name}</span>
                  <span className="ml-auto hidden gap-0.5 group-hover:flex group-focus-within:flex">
                    <button type="button" title="Move up" disabled={i === 0} onClick={() => run({ type: "slide.move", slideId: s.id, toIndex: i - 1 })} className="disabled:opacity-30"><ChevronUp className="size-3.5" /></button>
                    <button type="button" title="Move down" disabled={i === doc.slides.length - 1} onClick={() => run({ type: "slide.move", slideId: s.id, toIndex: i + 1 })} className="disabled:opacity-30"><ChevronDown className="size-3.5" /></button>
                    <button type="button" title="Duplicate slide" onClick={() => { const r = run({ type: "slide.duplicate", slideId: s.id }); if (r?.createdIds[0]) editor.setActiveSlide(r.createdIds[0]); }}><Copy className="size-3.5" /></button>
                    <button type="button" title="Delete slide" disabled={doc.slides.length === 1} onClick={() => run({ type: "slide.delete", slideId: s.id })} className="disabled:opacity-30"><Trash2 className="size-3.5" /></button>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => editor.setActiveSlide(s.id)}
                  aria-current={s.id === slide.id}
                  aria-label={`Slide ${i + 1}: ${s.name}`}
                  className="block w-full ring-1 ring-border aria-current:ring-2 aria-current:ring-sky-500"
                >
                  <SlideView doc={doc} slide={s} scale={thumbScale} mode="edit" resolveAsset={(id) => assetUrls[id]} />
                </button>
              </li>
            ))}
          </ol>
        </aside>

        {/* Canvas */}
        <main className="min-h-0 min-w-0">
          <Canvas editor={editor} state={state} slide={slide} assetUrls={assetUrls} zoom={zoom} onFitScale={onFitScale} />
        </main>

        {/* Properties */}
        <aside className="min-h-0 overflow-y-auto border-l">
          <PropertiesPanel editor={editor} doc={doc} slide={slide} selection={state.selection} addFont={uploadFont} />
        </aside>
      </div>
      <CatalogFonts doc={doc} resolveAsset={(id) => assetUrls[id]} />
      {previewing && <PreviewPlayer doc={doc} startSlide={previewing === "export" ? 0 : slideIndex} openExport={previewing === "export"} assetUrls={assetUrls} onClose={() => setPreviewing(false)} />}
    </div>
  );
}

const SAMPLE_HTML = `<div class="badge">New</div>
<h2>Limited edition</h2>
<p>Style this block with your own <b>HTML</b> and <b>CSS</b>.</p>`;

const SAMPLE_CSS = `body { padding: 24px; }
h2 { margin: 12px 0 4px; font: 700 40px var(--kv-heading), sans-serif; }
p { margin: 0; font-size: 20px; color: var(--kv-muted); }
.badge { display: inline-block; padding: 4px 12px; border-radius: 999px;
  background: var(--kv-primary); color: var(--kv-on-primary); font-size: 14px; }`;
