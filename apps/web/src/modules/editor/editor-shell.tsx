"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, ArrowLeft01Icon, CircleIcon, CodeIcon, Copy01Icon, Delete02Icon, DragDropVerticalIcon, GlobeIcon, Heading01Icon, ImageAdd01Icon, KeyboardIcon, LayoutGridIcon, MessageMultiple01Icon, MinusSignIcon, PackageAddIcon, PlayIcon, Presentation01Icon, Redo02Icon, SquareIcon, Tag01Icon, TextIcon, Undo02Icon, Upload01Icon, ZoomInIcon, ZoomOutIcon } from "@hugeicons/core-free-icons";
import { createBlankSlide, type CatalogElement, type CatalogSlide } from "@Kavero/catalog-engine";
import type { Editor, EditorCommand, NewElement } from "@Kavero/editor-core";
import { CatalogFonts, SlideView } from "@Kavero/renderer";
import { Button } from "@Kavero/ui/components/button";
import { TooltipHint } from "@Kavero/ui/components/tooltip";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Canvas } from "./canvas";
import type { AddFont } from "./font-picker";
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
import { EditorLibraryPanel, type EditorLibraryTab } from "./editor-library-panel";
import { RailButton, ToolRail } from "./tool-rail";
import { Workspace, WorkspaceMenu, useWorkspace } from "./workspace";
import { EditorChat, type EditorChatAnnotationRef } from "@/modules/chat/editor-chat";
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
        <Link href="/dashboard"><Button variant="outline"><HugeiconsIcon icon={ArrowLeft01Icon} /> Back to catalogs</Button></Link>
      </div>
    );
  }
  if (!editor) return <p className="p-8 text-sm text-muted-foreground">Opening catalog…</p>;
  return (
    <ContextMenuProvider>
      <EditorShell editor={editor} userId={userId} assetUrls={assetUrls} saveStatus={saveStatus} cloudLabel={CLOUD_LABEL[cloudStatus]} uploadImage={uploadImage} uploadFont={uploadFont} onReload={reloadFromStorage} onKeepMine={keepMine} />
    </ContextMenuProvider>
  );
}

const SAVE_LABEL: Record<SaveStatus, string> = { saved: "Saved", saving: "Saving…", unsaved: "Unsaved changes", error: "Save failed", conflict: "Not saved: changed elsewhere" };

function EditorShell({ editor, userId, assetUrls, saveStatus, cloudLabel, uploadImage, uploadFont, onReload, onKeepMine }: {
  onReload: () => void;
  onKeepMine: () => void;
  cloudLabel: string | null;
  editor: Editor;
  userId: string | null;
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
  const [annotationMode, setAnnotationMode] = useState(false);
  const [chatAnnotations, setChatAnnotations] = useState<EditorChatAnnotationRef[]>([]);
  const cancelAnnotationMode = useCallback(() => setAnnotationMode(false), []);
  const [sidebar, setSidebar] = useState<"slides" | "layers" | "products">("slides");
  const [libraryTab, setLibraryTab] = useState<EditorLibraryTab>("design");
  const workspace = useWorkspace();

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
  const slideListElement = useRef<HTMLOListElement | null>(null);
  const [previewSlideIds, setPreviewSlideIds] = useState<string[] | null>(null);
  const previewSlideIdsRef = useRef<string[] | null>(null);
  const previousSlideTops = useRef<Map<string, number> | null>(null);
  const pointerSlideDrag = useRef<{ slideId: string; pointerId: number } | null>(null);
  const [draggingSlideId, setDraggingSlideId] = useState<string | null>(null);
  const [keyboardDraggingSlideId, setKeyboardDraggingSlideId] = useState<string | null>(null);
  const [slideReorderAnnouncement, setSlideReorderAnnouncement] = useState("");
  const listRef = useCallback((node: HTMLOListElement | null) => {
    slideListElement.current = node;
    if (!node) return;
    const ro = new ResizeObserver(([e]) => setListWidth(e!.contentRect.width));
    ro.observe(node);
    return () => {
      ro.disconnect();
      if (slideListElement.current === node) slideListElement.current = null;
    };
  }, []);
  const thumbScale = Math.max(40, listWidth) / W;
  const slidesForList = previewSlideIds
    ? previewSlideIds.map((id) => doc.slides.find((s) => s.id === id)).filter((s): s is CatalogSlide => !!s)
    : doc.slides;

  function snapshotSlideTops() {
    const positions = new Map<string, number>();
    slideListElement.current?.querySelectorAll<HTMLElement>("[data-sortable-slide-id]").forEach((node) => {
      const id = node.dataset.sortableSlideId;
      if (id) positions.set(id, node.getBoundingClientRect().top);
    });
    return positions;
  }

  function updatePreviewSlideOrder(next: string[]) {
    const current = previewSlideIdsRef.current ?? doc.slides.map((s) => s.id);
    if (current.length === next.length && current.every((id, index) => id === next[index])) return;
    previousSlideTops.current = snapshotSlideTops();
    previewSlideIdsRef.current = next;
    setPreviewSlideIds(next);
  }

  function startSlideReorder(slideId: string) {
    const order = doc.slides.map((s) => s.id);
    previewSlideIdsRef.current = order;
    previousSlideTops.current = null;
    setPreviewSlideIds(order);
    setDraggingSlideId(slideId);
    editor.setActiveSlide(slideId);
  }

  function commitSlideReorder(slideId: string) {
    const order = previewSlideIdsRef.current ?? doc.slides.map((s) => s.id);
    const from = doc.slides.findIndex((s) => s.id === slideId);
    const to = order.indexOf(slideId);
    if (from >= 0 && to >= 0 && from !== to) actions.moveSlide(slideId, to);
    previewSlideIdsRef.current = null;
    previousSlideTops.current = null;
    setPreviewSlideIds(null);
    setDraggingSlideId(null);
  }

  function cancelSlideReorder() {
    if (!previewSlideIdsRef.current) return;
    previousSlideTops.current = snapshotSlideTops();
    previewSlideIdsRef.current = null;
    setPreviewSlideIds(null);
    setDraggingSlideId(null);
  }

  function movePreviewSlide(slideId: string, direction: -1 | 1) {
    const order = previewSlideIdsRef.current ?? doc.slides.map((s) => s.id);
    const from = order.indexOf(slideId);
    const to = Math.max(0, Math.min(order.length - 1, from + direction));
    if (from < 0 || from === to) return to;
    const next = [...order];
    next.splice(from, 1);
    next.splice(to, 0, slideId);
    updatePreviewSlideOrder(next);
    return to;
  }

  function onSlideDragStart(event: React.PointerEvent<HTMLButtonElement>, slideId: string) {
    if (event.button !== 0 || !event.isPrimary || pointerSlideDrag.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerSlideDrag.current = { slideId, pointerId: event.pointerId };
    setKeyboardDraggingSlideId(null);
    startSlideReorder(slideId);
  }

  function onSlideDragMove(event: React.PointerEvent<HTMLButtonElement>, slideId: string) {
    const drag = pointerSlideDrag.current;
    if (!drag || drag.slideId !== slideId || drag.pointerId !== event.pointerId) return;
    const list = slideListElement.current;
    if (!list) return;
    const bounds = list.getBoundingClientRect();
    const edge = 36;
    if (event.clientY < bounds.top + edge) list.scrollTop -= Math.max(4, (bounds.top + edge - event.clientY) / 2);
    else if (event.clientY > bounds.bottom - edge) list.scrollTop += Math.max(4, (event.clientY - bounds.bottom + edge) / 2);

    const otherItems = [...list.querySelectorAll<HTMLElement>("[data-sortable-slide-id]")]
      .filter((node) => node.dataset.sortableSlideId !== slideId);
    const target = otherItems.findIndex((node) => event.clientY < node.getBoundingClientRect().top + node.getBoundingClientRect().height / 2);
    const order = [...(previewSlideIdsRef.current ?? doc.slides.map((s) => s.id)).filter((id) => id !== slideId)];
    order.splice(target < 0 ? otherItems.length : target, 0, slideId);
    updatePreviewSlideOrder(order);
  }

  function onSlideDragEnd(event: React.PointerEvent<HTMLButtonElement>, slideId: string) {
    const drag = pointerSlideDrag.current;
    if (!drag || drag.slideId !== slideId || drag.pointerId !== event.pointerId) return;
    pointerSlideDrag.current = null;
    commitSlideReorder(slideId);
  }

  function onSlideDragCancel(event: React.PointerEvent<HTMLButtonElement>, slideId: string) {
    const drag = pointerSlideDrag.current;
    if (!drag || drag.slideId !== slideId || drag.pointerId !== event.pointerId) return;
    pointerSlideDrag.current = null;
    cancelSlideReorder();
    setKeyboardDraggingSlideId(null);
  }

  useLayoutEffect(() => {
    const previous = previousSlideTops.current;
    const list = slideListElement.current;
    if (!previous || !list) return;
    previousSlideTops.current = null;
    list.querySelectorAll<HTMLElement>("[data-sortable-slide-id]").forEach((node) => {
      const id = node.dataset.sortableSlideId;
      const oldTop = id ? previous.get(id) : undefined;
      if (oldTop === undefined) return;
      const offset = oldTop - node.getBoundingClientRect().top;
      if (Math.abs(offset) < 1) return;
      node.style.transition = "none";
      node.style.transform = `translateY(${offset}px)`;
      node.style.willChange = "transform";
      void node.offsetHeight;
      node.style.transition = "transform 180ms cubic-bezier(0.2, 0, 0, 1)";
      node.style.transform = "translateY(0)";
      window.setTimeout(() => {
        node.style.transition = "";
        node.style.transform = "";
        node.style.willChange = "";
      }, 220);
    });
  }, [previewSlideIds]);

  if (!slide) return <p className="p-8 text-sm text-muted-foreground">Opening catalog…</p>;
  const conflict = saveStatus === "conflict";

  return (
    <div className="flex h-svh w-full min-w-0 flex-col overflow-hidden">
      {/* Top bar */}
      <header className="flex min-w-0 items-center gap-2 border-b px-3 py-1.5">
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><HugeiconsIcon icon={ArrowLeft01Icon} className="size-3.5" /> Catalogs</Link>
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
        <TooltipHint content={`Undo (${kbd("Ctrl+Z")})`}><Button variant="ghost" size="icon-sm" aria-label="Undo" disabled={!state.canUndo} onClick={() => editor.undo()}><HugeiconsIcon icon={Undo02Icon} /></Button></TooltipHint>
        <TooltipHint content={`Redo (${kbd("Ctrl+Shift+Z")})`}><Button variant="ghost" size="icon-sm" aria-label="Redo" disabled={!state.canRedo} onClick={() => editor.redo()}><HugeiconsIcon icon={Redo02Icon} /></Button></TooltipHint>
        <TooltipHint content="Chat with your AI model about this catalog"><Button variant={workspace.isOpen("chat") ? "secondary" : "ghost"} size="icon-sm" aria-label="Chat" aria-pressed={workspace.isOpen("chat")} onClick={() => workspace.toggle("chat")}><HugeiconsIcon icon={MessageMultiple01Icon} /></Button></TooltipHint>
        <ExportMenu doc={doc} onVideo={() => setPreviewing("export")} />
        <TooltipHint content="Publish as a website"><Button variant="outline" size="icon-sm" aria-label="Publish" onClick={() => setPublishing(true)}><HugeiconsIcon icon={GlobeIcon} /></Button></TooltipHint>
        <TooltipHint content="Preview from this slide"><Button size="icon-sm" className="ml-1" aria-label="Preview" onClick={() => setPreviewing("play")}><HugeiconsIcon icon={PlayIcon} /></Button></TooltipHint>
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

      <Workspace
        api={workspace}
        rail={
          <ToolRail
            groups={[
              [
                { id: "heading", icon: <HugeiconsIcon icon={Heading01Icon} />, label: "Heading", description: "Add a large title in the theme's heading font.", onClick: () => addElement({ type: "text", content: { paragraphs: [[{ text: "Heading" }]] }, style: { fontSize: Math.round(H * 0.06), fontWeight: 700, fontFamily: "token:heading" }, size: [W * 0.5, H * 0.1] } as never) },
                { id: "text", icon: <HugeiconsIcon icon={TextIcon} />, label: "Text", description: "Add a paragraph of body text. Double-click it on the slide to type.", onClick: () => addElement({ type: "text", content: { paragraphs: [[{ text: "Body text" }]] }, style: { fontSize: Math.round(H * 0.025) }, size: [W * 0.4, H * 0.08] } as never) },
              ],
              [
                { id: "rect", icon: <HugeiconsIcon icon={SquareIcon} />, label: "Rectangle", description: "Add a rectangle for backgrounds, cards and color blocks.", onClick: () => addElement({ type: "shape", content: { shape: "rect" }, size: [W * 0.2, H * 0.2] } as never) },
                { id: "ellipse", icon: <HugeiconsIcon icon={CircleIcon} />, label: "Ellipse", description: "Add a circle or ellipse.", onClick: () => addElement({ type: "shape", content: { shape: "ellipse" }, size: [H * 0.2, H * 0.2] } as never) },
                { id: "line", icon: <HugeiconsIcon icon={MinusSignIcon} />, label: "Line", description: "Add a divider line.", onClick: () => addElement({ type: "shape", content: { shape: "line" }, style: { fill: "token:text", strokeWidth: 3 }, size: [W * 0.25, 20] } as never) },
              ],
              [
                { id: "image", icon: <HugeiconsIcon icon={ImageAdd01Icon} />, label: "Image", description: "Upload a photo, logo or illustration from your computer. You can also paste images onto the slide.", onClick: () => fileInput.current?.click() },
                { id: "product", icon: <HugeiconsIcon icon={Tag01Icon} />, label: "Product card", description: "Pick a product from this catalog and add its card: photo, name, price and details.", onClick: () => productUi.pick({ multiple: false, title: "Add a product card", confirmLabel: "Add to slide", onConfirm: ([id]) => id && insertProduct(id) }) },
                { id: "grid", icon: <HugeiconsIcon icon={LayoutGridIcon} />, label: "Product grid", description: "Pick several products and lay them out as a grid of cards.", onClick: () => productUi.pick({ multiple: true, title: "Add a product grid", confirmLabel: "Add grid to slide", onConfirm: insertGrid }) },
                { id: "html", icon: <HugeiconsIcon icon={CodeIcon} />, label: "HTML block", description: "Add your own HTML and CSS, rendered safely in a sandbox (no scripts).", onClick: () => addElement({ type: "html", content: { html: SAMPLE_HTML, css: SAMPLE_CSS }, size: [W * 0.4, H * 0.3] } as never) },
              ],
              [
                { id: "import", icon: <HugeiconsIcon icon={PackageAddIcon} />, label: "Import products", description: "Bring products in from a connected store or MCP source, or paste a list.", onClick: () => setImporting(true) },
                { id: "chat", icon: <HugeiconsIcon icon={MessageMultiple01Icon} />, label: "Chat", description: "Talk to your connected AI model about this catalog. It proposes edits you preview and apply.", active: workspace.isOpen("chat"), onClick: () => workspace.toggle("chat") },
              ],
            ]}
            bottom={
              <>
                <RailButton tool={{ id: "shortcuts", icon: <HugeiconsIcon icon={KeyboardIcon} />, label: "Keyboard shortcuts", description: "See every shortcut for editing, arranging, aligning and navigating.", shortcut: "?", onClick: () => setShortcutsOpen(true) }} />
                <WorkspaceMenu api={workspace} />
              </>
            }
          />
        }
        center={
          <>
            <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(e) => addImage(e.target.files?.[0])} />
            <Canvas
              editor={editor}
              state={state}
              slide={slide}
              assetUrls={assetUrls}
              zoom={zoom}
              onFitScale={onFitScale}
              actions={actions}
              annotationMode={annotationMode}
              onAnnotateElement={(slideId, elementId) => {
                setChatAnnotations((current) => {
                  if (current.some((item) => item.slideId === slideId && item.elementId === elementId)) return current;
                  if (current.length >= 8) {
                    toast.info("You can attach up to 8 slide elements to chat at a time.");
                    return current;
                  }
                  return [...current, { slideId, elementId }];
                });
              }}
              onCancelAnnotation={cancelAnnotationMode}
            />
            {/* Zoom */}
            <div className="absolute right-3 bottom-3 z-10 flex items-center gap-0.5 rounded-lg border bg-background/90 p-0.5 text-xs shadow-sm backdrop-blur">
              <Button variant="ghost" size="icon-sm" title={`Zoom out (${kbd("Ctrl+-")})`} aria-label="Zoom out" onClick={() => zoomBy(0.8)}><HugeiconsIcon icon={ZoomOutIcon} /></Button>
              <TooltipHint content={`Fit to window (${kbd("Ctrl+0")})`}><button type="button" aria-label="Fit to window" className="w-12 rounded-md py-1 text-center tabular-nums hover:bg-muted" onClick={() => setZoom("fit")}>{Math.round(scale * 100)}%</button></TooltipHint>
              <Button variant="ghost" size="icon-sm" title={`Zoom in (${kbd("Ctrl+=")})`} aria-label="Zoom in" onClick={() => zoomBy(1.25)}><HugeiconsIcon icon={ZoomInIcon} /></Button>
            </div>
          </>
        }
        renderPanel={(id) => {
          if (id === "properties") {
            const tabs: { id: EditorLibraryTab; label: string; icon: React.ReactNode }[] = [
              { id: "design", label: "Design", icon: <HugeiconsIcon icon={Heading01Icon} /> },
              { id: "templates", label: "Templates", icon: <HugeiconsIcon icon={Presentation01Icon} /> },
              { id: "blocks", label: "Blocks", icon: <HugeiconsIcon icon={LayoutGridIcon} /> },
              { id: "media", label: "Media", icon: <HugeiconsIcon icon={ImageAdd01Icon} /> },
              { id: "uploads", label: "Uploads", icon: <HugeiconsIcon icon={Upload01Icon} /> },
            ];
            return {
              header: <span className="truncate text-xs font-medium">{tabs.find((tab) => tab.id === libraryTab)?.label}</span>,
              body: (
                <div className="flex min-h-0 flex-1 overflow-hidden">
                  <div className="flex w-14 shrink-0 flex-col items-stretch gap-1 border-e p-1" role="tablist" aria-label="Design libraries" aria-orientation="vertical">
                    {tabs.map((tab) => (
                      <button key={tab.id} type="button" role="tab" aria-selected={libraryTab === tab.id} aria-label={tab.label} onClick={() => setLibraryTab(tab.id)}
                        className="grid min-h-12 content-center justify-items-center gap-1 rounded-md px-0.5 py-1 text-[9px] font-medium leading-none text-muted-foreground transition-colors hover:bg-muted/60 aria-selected:bg-primary/10 aria-selected:text-primary">
                        {tab.icon}<span>{tab.label}</span>
                      </button>
                    ))}
                  </div>
                  <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                    <EditorLibraryPanel tab={libraryTab} editor={editor} doc={doc} slide={slide} selection={state.selection} assetUrls={assetUrls} addFont={uploadFont} productUi={productUi} userId={userId} uploadImage={uploadImage} />
                  </div>
                </div>
              ),
            };
          }
          if (id === "chat") return {
            body: (
              <EditorChat
                editor={editor}
                doc={doc}
                assetUrls={assetUrls}
                annotations={chatAnnotations}
                annotationMode={annotationMode}
                onAnnotationModeChange={setAnnotationMode}
                onRemoveAnnotation={(annotation) => setChatAnnotations((current) => current.filter((item) => item.slideId !== annotation.slideId || item.elementId !== annotation.elementId))}
              />
            ),
          };
          return {
            header: (
              <>
                <div className="flex min-w-0 items-center gap-0.5" role="tablist" aria-label="Pages panel">
                  {(["slides", "layers", "products"] as const).map((t) => (
                    <button key={t} type="button" role="tab" aria-selected={sidebar === t} onClick={() => setSidebar(t)}
                      className="rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground capitalize aria-selected:bg-muted aria-selected:text-foreground">
                      {t}
                    </button>
                  ))}
                </div>
                {sidebar === "slides" && <Button variant="ghost" size="icon-xs" className="ml-auto" title={`Add slide (${kbd("Ctrl+M")})`} aria-label="Add slide" onClick={() => actions.addSlide()}><HugeiconsIcon icon={Add01Icon} /></Button>}
              </>
            ),
            body:
              sidebar === "products" ? (
                <ProductsPanel editor={editor} doc={doc} assetUrls={assetUrls} ui={productUi} onInsert={insertProduct} />
              ) : sidebar === "layers" ? (
                <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pt-2">
                  <LayersPanel editor={editor} slide={slide} selection={state.selection} actions={actions} />
                </div>
              ) : (
                <>
                  <span className="sr-only" aria-live="polite">{slideReorderAnnouncement}</span>
                  <ol ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
                  {slidesForList.map((s, i) => (
                    <li
                      key={s.id}
                      data-slide-id={s.id}
                      data-sortable-slide-id={s.id}
                      data-dragging={draggingSlideId === s.id ? "true" : undefined}
                      className="group relative rounded-lg transition-[background-color,box-shadow,opacity] duration-150 data-[dragging=true]:bg-primary/5 data-[dragging=true]:shadow-md"
                      onContextMenu={(e) => { editor.setActiveSlide(s.id); openMenu(e, slideMenu(actions, s.id, i, slidesForList.length, () => setRenamingSlide(s.id))); }}
                    >
                      <div className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                        <span className="tabular-nums">{i + 1}</span>
                        {renamingSlide === s.id ? (
                          <input autoFocus defaultValue={s.name} aria-label="Slide name" className="h-5 min-w-0 flex-1 rounded border border-input bg-background px-1 text-[11px] text-foreground outline-none"
                            onBlur={(e) => { actions.renameSlide(s.id, e.target.value); setRenamingSlide(null); }}
                            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setRenamingSlide(null); }} />
                        ) : (
                          <span className="truncate" onDoubleClick={() => setRenamingSlide(s.id)}>{s.name}</span>
                        )}
                        <div className="ml-auto flex items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                          <TooltipHint content="Drag to reorder. Press Space, then ↑/↓ to move with the keyboard.">
                            <button
                              type="button"
                              aria-label={`Reorder slide ${i + 1}: ${s.name}`}
                              aria-pressed={draggingSlideId === s.id}
                              aria-keyshortcuts="Space ArrowUp ArrowDown Escape"
                              onPointerDown={(e) => onSlideDragStart(e, s.id)}
                              onPointerMove={(e) => onSlideDragMove(e, s.id)}
                              onPointerUp={(e) => onSlideDragEnd(e, s.id)}
                              onPointerCancel={(e) => onSlideDragCancel(e, s.id)}
                              onLostPointerCapture={(e) => onSlideDragCancel(e, s.id)}
                              onKeyDown={(e) => {
                                const keyboardDragging = keyboardDraggingSlideId === s.id;
                                if (!keyboardDragging && (e.key === " " || e.key === "Enter")) {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setKeyboardDraggingSlideId(s.id);
                                  startSlideReorder(s.id);
                                  setSlideReorderAnnouncement(`Picked up slide ${i + 1} of ${slidesForList.length}. Use the arrow keys to move it, then press Space to drop or Escape to cancel.`);
                                  return;
                                }
                                if (!keyboardDragging) return;
                                if (e.key === "Tab") {
                                  e.stopPropagation();
                                  cancelSlideReorder();
                                  setKeyboardDraggingSlideId(null);
                                  setSlideReorderAnnouncement(`Canceled moving slide ${i + 1}.`);
                                  return;
                                }
                                if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  const nextIndex = movePreviewSlide(s.id, e.key === "ArrowUp" ? -1 : 1);
                                  setSlideReorderAnnouncement(`Slide ${s.name}, position ${nextIndex + 1} of ${slidesForList.length}.`);
                                  return;
                                }
                                if (e.key === "Escape") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  cancelSlideReorder();
                                  setKeyboardDraggingSlideId(null);
                                  setSlideReorderAnnouncement(`Canceled moving slide ${i + 1}.`);
                                  return;
                                }
                                if (e.key === " " || e.key === "Enter") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  const position = (previewSlideIdsRef.current ?? doc.slides.map((item) => item.id)).indexOf(s.id) + 1;
                                  commitSlideReorder(s.id);
                                  setKeyboardDraggingSlideId(null);
                                  setSlideReorderAnnouncement(`Dropped slide ${s.name} at position ${position} of ${slidesForList.length}.`);
                                }
                              }}
                              className="touch-none cursor-grab rounded p-1 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing"
                            >
                              <HugeiconsIcon icon={DragDropVerticalIcon} className="size-3.5" />
                            </button>
                          </TooltipHint>
                          <TooltipHint content="Duplicate slide"><button type="button" aria-label={`Duplicate slide ${i + 1}`} onClick={() => actions.duplicateSlide(s.id)}><HugeiconsIcon icon={Copy01Icon} className="size-3.5" /></button></TooltipHint>
                          <TooltipHint content="Delete slide"><button type="button" aria-label={`Delete slide ${i + 1}`} disabled={slidesForList.length === 1} onClick={() => actions.deleteSlide(s.id)} className="disabled:opacity-30"><HugeiconsIcon icon={Delete02Icon} className="size-3.5" /></button></TooltipHint>
                        </div>
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
                </>
              ),
          };
        }}
      />
      <CatalogFonts doc={doc} resolveAsset={(id) => assetUrls[id]} />
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
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
