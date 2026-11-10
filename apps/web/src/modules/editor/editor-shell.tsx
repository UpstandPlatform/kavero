"use client";

import { createBlankSlide, type CatalogElement, type CatalogSlide } from "@Kavero/catalog-engine";
import type { Editor, EditorCommand, NewElement } from "@Kavero/editor-core";
import { CatalogFonts, SlideView } from "@Kavero/renderer";
import { Button } from "@Kavero/ui/components/button";
import {
  ArrowLeft, Circle, Code2, Copy, Globe, Keyboard, PackagePlus, Play, Sparkles, ImagePlus, LayoutGrid, Minus, Plus, Redo2, Square, Tag, Trash2, Type, Undo2, ChevronUp, ChevronDown,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Canvas } from "./canvas";
import type { AddFont } from "./font-picker";
import { AiEditDialog } from "./ai-edit-dialog";
import { ContextMenuProvider, useContextMenu } from "./context-menu";
import { createActions, kbd } from "./editor-actions";
import { slideMenu } from "./editor-menus";
import { ExportMenu } from "./export-menu";
import { LayersPanel } from "./layers-panel";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { useEditorKeyboard } from "./use-editor-keyboard";
import { ProductImportDialog } from "./product-import-dialog";
import { ProductFormDialog } from "./product-form";
import { ProductPickerDialog, type PickOptions, type ProductUi } from "./product-picker";
import { ProductsPanel } from "./products-panel";
import { PublishDialog } from "./publish-dialog";
import { PreviewPlayer } from "./preview-player";
import { PropertiesPanel } from "./properties-panel";
import { authClient } from "@/lib/auth-client";
import { pullCatalog, refreshFromCloud } from "@/modules/catalog/cloud-sync";
import { localCatalogs } from "@/modules/catalog/local-catalogs";

import { FALLBACK_IMAGE_SIZE, useCatalogEditor, useEditorState, useRun, type SaveStatus } from "./use-catalog-editor";
import { CLOUD_LABEL, useCloudAutoSync } from "./use-cloud-autosync";

export function CatalogEditorPage({ catalogId }: { catalogId: string }) {
  const { data: session, isPending } = authClient.useSession();
  const userId = session?.user.id ?? null;
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const ready = readyFor === catalogId;

  // Before opening, pull a newer cloud version (e.g. edited by an AI agent over MCP).
  // Only once: after the editor is up, a pull would replace the document under it.
  useEffect(() => {
    if (isPending || ready) return;
    if (!userId) return setReadyFor(catalogId);
    let cancelled = false;
    (async () => {
      // Opened from a link (e.g. an AI agent's editorUrl) and not in this browser yet: fetch it from the cloud.
      if (!(await localCatalogs().get(catalogId))) {
        await pullCatalog(catalogId, userId).then(() => toast.success("Downloaded from your cloud"), () => undefined);
        return "current" as const;
      }
      return refreshFromCloud(catalogId, userId);
    })()
      .then((r) => {
        if (r === "pulled") toast.success("Loaded the latest version from the cloud");
        if (r === "conflict") toast.warning("This catalog also changed in the cloud. Resolve it from the dashboard with Sync now.");
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setReadyFor(catalogId));
    return () => {
      cancelled = true;
    };
  }, [catalogId, userId, isPending, ready]);

  if (!ready) return <p className="p-8 text-sm text-muted-foreground">Opening catalog…</p>;
  return <LoadedEditor catalogId={catalogId} userId={userId} />;
}

function LoadedEditor({ catalogId, userId }: { catalogId: string; userId: string | null }) {
  const { editor, loadError, assetUrls, saveStatus, uploadImage, uploadFont, reloadFromStorage, keepMine } = useCatalogEditor(catalogId);
  const cloudStatus = useCloudAutoSync(catalogId, userId, saveStatus);
  if (loadError) {
    return (
      <div className="p-8">
        <p className="mb-4 text-sm">{loadError === "not-found" ? "This catalog isn't in this browser." : `Could not open this catalog: ${loadError}`}</p>
        <Link href="/dashboard"><Button variant="outline"><ArrowLeft /> Back to catalogs</Button></Link>
      </div>
    );
  }
  if (!editor) return <p className="p-8 text-sm text-muted-foreground">Opening catalog…</p>;
  return (
    <ContextMenuProvider>
      <EditorShell editor={editor} assetUrls={assetUrls} saveStatus={saveStatus} cloudLabel={CLOUD_LABEL[cloudStatus]} uploadImage={uploadImage} uploadFont={uploadFont} onReload={reloadFromStorage} onKeepMine={keepMine} />
    </ContextMenuProvider>
  );
}

const SAVE_LABEL: Record<SaveStatus, string> = { saved: "Saved", saving: "Saving…", unsaved: "Unsaved changes", error: "Save failed", conflict: "Not saved: changed elsewhere" };

function EditorShell({ editor, assetUrls, saveStatus, cloudLabel, uploadImage, uploadFont, onReload, onKeepMine }: {
  onReload: () => void;
  onKeepMine: () => void;
  cloudLabel: string | null;
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
  // Undefined only for a document without slides, until the editor adds a blank one.
  const slide = doc.slides[slideIndex] as CatalogSlide | undefined;
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [fitScale, setFitScale] = useState(0.5);
  const fileInput = useRef<HTMLInputElement>(null);
  const { width: W, height: H } = doc.settings;

  const [previewing, setPreviewing] = useState<false | "play" | "export">(false);
  const [publishing, setPublishing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [aiEditing, setAiEditing] = useState(false);
  const [picking, setPicking] = useState<PickOptions | null>(null);
  const [productForm, setProductForm] = useState<{ productId?: string; onSaved?: (id: string) => void; key: number } | null>(null);

  /** Add an element centred on the slide and select it. */
  const addElement = useCallback(
    (element: Omit<NewElement, "position"> & { size?: [number, number] }) => {
      const [w, h] = element.size ?? [W * 0.4, H * 0.2];
      const { size: _s, ...rest } = element;
      const r = run({
        type: "element.add",
        slideId: slide!.id,
        element: { ...rest, position: { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), width: Math.round(w), height: Math.round(h), rotation: 0 } } as NewElement,
      });
      if (r?.createdIds[0]) editor.select([r.createdIds[0]]);
    },
    [run, editor, slide?.id, W, H],
  );

  async function addImage(file: File | undefined) {
    if (!file) return;
    try {
      const r = await uploadImage(file);
      const { assetId } = r;
      const width = r.width || FALLBACK_IMAGE_SIZE.width, height = r.height || FALLBACK_IMAGE_SIZE.height;
      const k = Math.min((W * 0.5) / width, (H * 0.6) / height, 1);
      addElement({ type: "image", content: { assetId, alt: file.name.replace(/\.[^.]+$/, "") }, size: [width * k, height * k] } as never);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const actions = useMemo(() => createActions({ editor, run, uploadImage }), [editor, run, uploadImage]);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [sidebar, setSidebar] = useState<"slides" | "layers" | "products">("slides");

  const productUi = useMemo<ProductUi>(() => ({
    pick: setPicking,
    edit: (productId, onSaved) => setProductForm({ productId, onSaved, key: Date.now() }),
    import: () => setImporting(true),
  }), []);
  const insertProduct = (productId: string) => addElement({ type: "product", content: { productId }, size: [W * 0.22, H * 0.5] } as never);
  const insertGrid = (productIds: string[]) => {
    const columns = Math.min(4, Math.max(1, productIds.length <= 4 ? productIds.length : Math.ceil(productIds.length / 2)));
    addElement({ type: "product-grid", content: { products: productIds.map((productId) => ({ productId })), columns }, size: [W * 0.8, H * 0.6] } as never);
  };
  const [renamingSlide, setRenamingSlide] = useState<string | null>(null);
  const openMenu = useContextMenu();

  const onFitScale = useCallback((s: number) => setFitScale(s), []);
  const scale = zoom === "fit" ? fitScale : zoom;
  const zoomBy = useCallback((f: number) => setZoom((z) => Math.min(4, Math.max(0.1, Math.round((z === "fit" ? fitScale : z) * f * 100) / 100))), [fitScale]);
  const view = useMemo(() => ({ zoomIn: () => zoomBy(1.25), zoomOut: () => zoomBy(0.8), zoomFit: () => setZoom("fit"), showShortcuts: () => setShortcutsOpen(true) }), [zoomBy]);
  useEditorKeyboard(editor, actions, view);
  const [listWidth, setListWidth] = useState(176);
  const listRef = useCallback((node: HTMLOListElement | null) => {
    if (!node) return;
    const ro = new ResizeObserver(([e]) => setListWidth(e!.contentRect.width));
    ro.observe(node);
    return () => ro.disconnect();
  }, []);
  const thumbScale = Math.max(40, listWidth) / W;

  if (!slide) return <p className="p-8 text-sm text-muted-foreground">Opening catalog…</p>;
  const conflict = saveStatus === "conflict";

  return (
    <div className={`grid h-svh w-full min-w-0 overflow-hidden ${conflict ? "grid-rows-[auto_auto_auto_minmax(0,1fr)]" : "grid-rows-[auto_auto_minmax(0,1fr)]"}`}>
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
        {cloudLabel && <span className="hidden shrink-0 text-xs text-muted-foreground lg:inline" aria-live="polite">· {cloudLabel}</span>}
        <Button variant="ghost" size="icon-sm" title="Undo (Ctrl+Z)" disabled={!state.canUndo} onClick={() => editor.undo()}><Undo2 /></Button>
        <Button variant="ghost" size="icon-sm" title="Redo (Ctrl+Shift+Z)" disabled={!state.canRedo} onClick={() => editor.redo()}><Redo2 /></Button>
        <Button variant="ghost" size="sm" onClick={() => setAiEditing(true)} title="Edit with AI"><Sparkles /> <span className="hidden lg:inline">AI</span></Button>
        <ExportMenu doc={doc} onVideo={() => setPreviewing("export")} />
        <Button variant="outline" size="sm" onClick={() => setPublishing(true)} title="Publish as a website"><Globe /> Publish</Button>
        <Button size="sm" className="ml-1" onClick={() => setPreviewing("play")} title="Play from this slide"><Play /> Preview</Button>
      </header>

      {conflict && (
        <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs">
          <span className="min-w-0 flex-1">
            This catalog was changed in another tab or updated from the cloud while you were editing. Your recent edits are not saved yet.
          </span>
          <Button size="xs" variant="outline" onClick={onReload} title="Discard the edits made here and open the latest saved version">Load latest version</Button>
          <Button size="xs" onClick={onKeepMine} title="Save this tab’s version over the other changes">Keep my version</Button>
        </div>
      )}

      {/* Insert toolbar */}
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto border-b px-3 py-1">
        <Button variant="ghost" size="sm" title="Heading" aria-label="Heading" onClick={() => addElement({ type: "text", content: { paragraphs: [[{ text: "Heading" }]] }, style: { fontSize: Math.round(H * 0.06), fontWeight: 700, fontFamily: "token:heading" }, size: [W * 0.5, H * 0.1] } as never)}><Type /> <span className="hidden xl:inline">Heading</span></Button>
        <Button variant="ghost" size="sm" title="Text" aria-label="Text" onClick={() => addElement({ type: "text", content: { paragraphs: [[{ text: "Body text" }]] }, style: { fontSize: Math.round(H * 0.025) }, size: [W * 0.4, H * 0.08] } as never)}><Type className="size-3" /> <span className="hidden xl:inline">Text</span></Button>
        <Button variant="ghost" size="sm" title="Rectangle" aria-label="Rectangle" onClick={() => addElement({ type: "shape", content: { shape: "rect" }, size: [W * 0.2, H * 0.2] } as never)}><Square /> <span className="hidden xl:inline">Rectangle</span></Button>
        <Button variant="ghost" size="sm" title="Ellipse" aria-label="Ellipse" onClick={() => addElement({ type: "shape", content: { shape: "ellipse" }, size: [H * 0.2, H * 0.2] } as never)}><Circle /> <span className="hidden xl:inline">Ellipse</span></Button>
        <Button variant="ghost" size="sm" title="Line" aria-label="Line" onClick={() => addElement({ type: "shape", content: { shape: "line" }, style: { fill: "token:text", strokeWidth: 3 }, size: [W * 0.25, 20] } as never)}><Minus /> <span className="hidden xl:inline">Line</span></Button>
        <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(e) => addImage(e.target.files?.[0])} />
        <Button variant="ghost" size="sm" title="Image" aria-label="Image" onClick={() => fileInput.current?.click()}><ImagePlus /> <span className="hidden xl:inline">Image</span></Button>
        <Button variant="ghost" size="sm" title="Product card" aria-label="Product card" aria-haspopup="dialog" onClick={() => productUi.pick({ multiple: false, title: "Add a product card", confirmLabel: "Add to slide", onConfirm: ([id]) => id && insertProduct(id) })}><Tag /> <span className="hidden xl:inline">Product</span></Button>
        <Button variant="ghost" size="sm" title="Product grid" aria-label="Product grid" aria-haspopup="dialog" onClick={() => productUi.pick({ multiple: true, title: "Add a product grid", confirmLabel: "Add grid to slide", onConfirm: insertGrid })}><LayoutGrid /> <span className="hidden xl:inline">Product grid</span></Button>
        <Button variant="ghost" size="sm" title="HTML block" aria-label="HTML block" onClick={() => addElement({ type: "html", content: { html: SAMPLE_HTML, css: SAMPLE_CSS }, size: [W * 0.4, H * 0.3] } as never)}><Code2 /> <span className="hidden xl:inline">HTML</span></Button>
        <Button variant="ghost" size="sm" title="Import products from MCP" aria-label="Import products from MCP" onClick={() => setImporting(true)}><PackagePlus /> <span className="hidden xl:inline">Import products</span></Button>
        <div className="ml-auto flex shrink-0 items-center gap-1 text-xs">
          <Button variant="ghost" size="icon-sm" title="Zoom out" onClick={() => zoomBy(0.8)}><Minus /></Button>
          <button type="button" className="w-12 text-center tabular-nums hover:underline" title="Fit to window" onClick={() => setZoom("fit")}>{Math.round(scale * 100)}%</button>
          <Button variant="ghost" size="icon-sm" title={`Zoom in (${kbd("Ctrl+=")})`} onClick={() => zoomBy(1.25)}><Plus /></Button>
          <Button variant="ghost" size="icon-sm" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" onClick={() => setShortcutsOpen(true)}><Keyboard /></Button>
        </div>
      </div>

      <div className="grid min-h-0 grid-cols-[clamp(140px,17vw,220px)_minmax(0,1fr)_clamp(220px,24vw,272px)]">
        {/* Slides / Layers */}
        <aside className="flex min-h-0 flex-col border-r">
          <div className="flex flex-wrap items-center gap-0.5 px-2 py-2" role="tablist" aria-label="Sidebar">
            {(["slides", "layers", "products"] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={sidebar === t} onClick={() => setSidebar(t)}
                title={t === "layers" ? `Layers on this slide (${slide.elements.length})` : t === "products" ? `Products in this catalog (${doc.products.length})` : "Slides"}
                className="rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground capitalize aria-selected:bg-muted aria-selected:text-foreground">
                {t}
              </button>
            ))}
            {sidebar === "slides" && <Button variant="ghost" size="icon-sm" className="ml-auto" title={`Add slide (${kbd("Ctrl+M")})`} onClick={() => actions.addSlide()}><Plus /></Button>}
          </div>
          {sidebar === "products" ? (
            <ProductsPanel editor={editor} doc={doc} assetUrls={assetUrls} ui={productUi} onInsert={insertProduct} />
          ) : sidebar === "layers" ? (
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
              <LayersPanel editor={editor} slide={slide} selection={state.selection} actions={actions} />
            </div>
          ) : (
          <ol ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-3">
            {doc.slides.map((s, i) => (
              <li key={s.id} className="group" onContextMenu={(e) => { editor.setActiveSlide(s.id); openMenu(e, slideMenu(actions, s.id, i, doc.slides.length, () => setRenamingSlide(s.id))); }}>
                <div className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <span className="tabular-nums">{i + 1}</span>
                  {renamingSlide === s.id ? (
                    <input autoFocus defaultValue={s.name} aria-label="Slide name" className="h-5 min-w-0 flex-1 rounded border border-input bg-background px-1 text-[11px] text-foreground outline-none"
                      onBlur={(e) => { actions.renameSlide(s.id, e.target.value); setRenamingSlide(null); }}
                      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setRenamingSlide(null); }} />
                  ) : (
                    <span className="truncate" onDoubleClick={() => setRenamingSlide(s.id)}>{s.name}</span>
                  )}
                  <span className="ml-auto hidden gap-0.5 group-hover:flex group-focus-within:flex">
                    <button type="button" title="Move up" disabled={i === 0} onClick={() => actions.moveSlide(s.id, i - 1)} className="disabled:opacity-30"><ChevronUp className="size-3.5" /></button>
                    <button type="button" title="Move down" disabled={i === doc.slides.length - 1} onClick={() => actions.moveSlide(s.id, i + 1)} className="disabled:opacity-30"><ChevronDown className="size-3.5" /></button>
                    <button type="button" title="Duplicate slide" onClick={() => actions.duplicateSlide(s.id)}><Copy className="size-3.5" /></button>
                    <button type="button" title="Delete slide" disabled={doc.slides.length === 1} onClick={() => actions.deleteSlide(s.id)} className="disabled:opacity-30"><Trash2 className="size-3.5" /></button>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => editor.setActiveSlide(s.id)}
                  aria-current={s.id === slide.id}
                  aria-label={`Slide ${i + 1}: ${s.name}`}
                  className="block w-full overflow-hidden rounded-md ring-1 ring-border aria-current:ring-2 aria-current:ring-sky-500"
                >
                  <SlideView doc={doc} slide={s} scale={thumbScale} mode="edit" resolveAsset={(id) => assetUrls[id]} />
                </button>
              </li>
            ))}
          </ol>
          )}
        </aside>

        {/* Canvas */}
        <main className="min-h-0 min-w-0">
          <Canvas editor={editor} state={state} slide={slide} assetUrls={assetUrls} zoom={zoom} onFitScale={onFitScale} actions={actions} />
        </main>

        {/* Properties */}
        <aside className="min-h-0 overflow-y-auto border-l">
          <PropertiesPanel editor={editor} doc={doc} slide={slide} selection={state.selection} addFont={uploadFont} assetUrls={assetUrls} productUi={productUi} />
        </aside>
      </div>
      <CatalogFonts doc={doc} resolveAsset={(id) => assetUrls[id]} />
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {aiEditing && <AiEditDialog editor={editor} doc={doc} slideId={slide.id} assetUrls={assetUrls} onClose={() => setAiEditing(false)} />}
      {importing && <ProductImportDialog editor={editor} doc={doc} uploadImage={uploadImage} activeSlideIndex={slideIndex} onClose={() => setImporting(false)} />}
      {picking && <ProductPickerDialog doc={doc} assetUrls={assetUrls} options={picking} ui={productUi} onClose={() => setPicking(null)} />}
      {productForm && (
        <ProductFormDialog
          key={productForm.key} editor={editor} doc={doc} productId={productForm.productId} assetUrls={assetUrls} uploadImage={uploadImage}
          onSaved={productForm.onSaved} onClose={() => setProductForm(null)}
        />
      )}
      {publishing && <PublishDialog doc={doc} onClose={() => setPublishing(false)} />}
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
