"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, ArrowLeft01Icon, CircleIcon, Clock01Icon, CodeIcon, Copy01Icon, Delete02Icon, DragDropVerticalIcon, GlobeIcon, Heading01Icon, ImageAdd01Icon, KeyboardIcon, LayoutGridIcon, MessageMultiple01Icon, MinusSignIcon, PenTool01Icon, PlayIcon, Presentation01Icon, PuzzleIcon, Redo02Icon, SquareIcon, TextIcon, Undo02Icon, Upload01Icon, ZoomInIcon, ZoomOutIcon } from "@hugeicons/core-free-icons";
import { createBlankSlide, createId, parseCatalogDocument, productCardStyleSchema, productGridStyleSchema, PRODUCTS_EXTENSION_ID, type CatalogDocument, type CatalogElement, type CatalogSlide } from "@Kavero/catalog-engine";
import type { Editor, EditorCommand, NewElement } from "@Kavero/editor-core";
import { CatalogFonts, SlideView } from "@Kavero/renderer";
import { Button } from "@Kavero/ui/components/button";
import { Input } from "@Kavero/ui/components/input";
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
import { ExtensionStoreDialog } from "./extensions/extension-store-dialog";
import { useEditorExtensions } from "./extensions/use-editor-extensions";
import { ExtensionUiBoundary } from "./extensions/extension-ui-boundary";
import { ContentEditingContext } from "./content/content-editing";
import { useContentTools } from "./content/content-tools";

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
  const { editor, loadError, assetUrls, saveStatus, uploadImage, removeUpload, setExternalAssetUrl, uploadFont, reloadFromStorage, keepMine } = useCatalogEditor(catalogId);
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
      <EditorShell editor={editor} userId={userId} assetUrls={assetUrls} saveStatus={saveStatus} cloudLabel={CLOUD_LABEL[cloudStatus]} uploadImage={uploadImage} removeUpload={removeUpload} setExternalAssetUrl={setExternalAssetUrl} uploadFont={uploadFont} onReload={reloadFromStorage} onKeepMine={keepMine} />
    </ContextMenuProvider>
  );
}

const SAVE_LABEL: Record<SaveStatus, string> = { saved: "Saved", saving: "Saving…", unsaved: "Unsaved changes", error: "Save failed", conflict: "Not saved: changed elsewhere" };
function EditorShell({ editor, userId, assetUrls, saveStatus, cloudLabel, uploadImage, removeUpload, setExternalAssetUrl, uploadFont, onReload, onKeepMine }: {
  onReload: () => void;
  onKeepMine: () => void;
  cloudLabel: string | null;
  editor: Editor;
  userId: string | null;
  assetUrls: Record<string, string>;
  saveStatus: SaveStatus;
  uploadImage: (f: File, attribution?: NonNullable<CatalogDocument["assets"][number]["attribution"]>) => Promise<{ assetId: string; width: number; height: number }>;
  removeUpload: (assetId: string) => Promise<void>;
  setExternalAssetUrl: (assetId: string, url: string) => void;
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
  const [extensionStoreOpen, setExtensionStoreOpen] = useState(false);
  /** Pen tool: the next clicks on the slide draw a vector path. */
  const [penActive, setPenActive] = useState(false);

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

  const contentTools = useContentTools({ editor, doc, run, addElement });

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
  const [hoveredChatAnnotation, setHoveredChatAnnotation] = useState<EditorChatAnnotationRef | null>(null);
  const [chatHistoryOpen, setChatHistoryOpen] = useState(false);
  const cancelAnnotationMode = useCallback(() => setAnnotationMode(false), []);
  const [sidebar, setSidebar] = useState("slides");
  const [libraryTab, setLibraryTab] = useState<EditorLibraryTab>("design");
  const workspace = useWorkspace();

  function addElementsToChat(slideId: string, elementIds: string[], openChat = false) {
    const alreadyAttached = new Set(chatAnnotations.map((item) => `${item.slideId}\u0000${item.elementId}`));
    const pending = [...new Set(elementIds)].filter((elementId) => !alreadyAttached.has(`${slideId}\u0000${elementId}`));
    const additions = pending.slice(0, Math.max(0, 8 - chatAnnotations.length));
    if (pending.length > additions.length) toast.info("You can attach up to 8 slide elements to chat at a time.");
    if (additions.length) {
      setChatAnnotations((current) => {
        const keys = new Set(current.map((item) => `${item.slideId}\u0000${item.elementId}`));
        return [...current, ...additions.filter((elementId) => !keys.has(`${slideId}\u0000${elementId}`)).map((elementId) => ({ slideId, elementId }))].slice(0, 8);
      });
    }
    if (openChat) {
      setAnnotationMode(false);
      if (!workspace.isOpen("chat")) workspace.toggle("chat");
    }
  }

  const productUi = useMemo<ProductUi>(() => ({
    pick: setPicking,
    edit: (productId, onSaved) => setProductForm({ productId, onSaved, key: Date.now() }),
    import: () => setImporting(true),
  }), []);
  const insertProduct = (productId: string) => addElement({
    type: "extension", extensionId: PRODUCTS_EXTENSION_ID, kind: "card", content: { productId },
    style: productCardStyleSchema.parse({}), size: [W * 0.22, H * 0.5],
  } as never);
  const insertGrid = (productIds: string[]) => {
    const columns = Math.min(4, Math.max(1, productIds.length <= 4 ? productIds.length : Math.ceil(productIds.length / 2)));
    addElement({
      type: "extension", extensionId: PRODUCTS_EXTENSION_ID, kind: "grid",
      content: { products: productIds.map((productId) => ({ productId })), columns },
      style: productGridStyleSchema.parse({}), size: [W * 0.8, H * 0.6],
    } as never);
  };
  const {
    contributions: extensionContributions,
    panels: extensionPanels,
    properties: extensionProperties,
    canvasWidgets: extensionCanvasWidgets,
    toolGroups: extensionToolGroups,
    renderers: extensionRenderers,
    effects: extensionEffects,
    pptxRenderers: extensionPptxRenderers,
    prepareDocumentForExport,
    storeEntries: extensionStoreEntries,
    actOnExtension,
    runExtension,
    applyExtensionEffect,
    getExtensionElementMenuItems,
  } = useEditorExtensions({
    editor,
    state,
    slide,
    assetUrls,
    userId,
    productUi,
    insertProduct,
    insertGrid,
    importProducts: () => setImporting(true),
    showSidebar: setSidebar,
    closeStore: () => setExtensionStoreOpen(false),
  });
  const [renamingSlide, setRenamingSlide] = useState<string | null>(null);
  const openMenu = useContextMenu();

  const onFitScale = useCallback((s: number) => setFitScale(s), []);
  const scale = zoom === "fit" ? fitScale : zoom;
  const zoomBy = useCallback((f: number) => setZoom((z) => Math.min(4, Math.max(0.1, Math.round((z === "fit" ? fitScale : z) * f * 100) / 100))), [fitScale]);
  const view = useMemo(() => ({ zoomIn: () => zoomBy(1.25), zoomOut: () => zoomBy(0.8), zoomFit: () => setZoom("fit"), showShortcuts: () => setShortcutsOpen(true), togglePen: () => setPenActive((active) => !active) }), [zoomBy]);
  useEditorKeyboard(editor, actions, view);
  const [listWidth, setListWidth] = useState(176);
  const slideListElement = useRef<HTMLOListElement | null>(null);
  const [previewSlideIds, setPreviewSlideIds] = useState<string[] | null>(null);
  const previewSlideIdsRef = useRef<string[] | null>(null);
  const previousSlideTops = useRef<Map<string, number> | null>(null);
  const pointerSlideDrag = useRef<{ slideId: string; pointerId: number; startX: number; startY: number; started: boolean; origin: HTMLLIElement } | null>(null);
  const slideDragPreviewElement = useRef<HTMLDivElement | null>(null);
  const slideDragPosition = useRef({ left: 12, top: 12 });
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

  useEffect(() => {
    if (!hoveredChatAnnotation || hoveredChatAnnotation.slideId === slide?.id) return;
    const slideNode = [...(slideListElement.current?.querySelectorAll<HTMLElement>("[data-sortable-slide-id]") ?? [])]
      .find((node) => node.dataset.sortableSlideId === hoveredChatAnnotation.slideId);
    slideNode?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [hoveredChatAnnotation, slide?.id]);

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

  function updateSlideDragPreview(clientX: number, clientY: number) {
    const width = Math.min(220, Math.max(120, window.innerWidth - 24));
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, clientX + 16));
    const top = Math.max(12, Math.min(window.innerHeight - 160, clientY + 16));
    slideDragPosition.current = { left, top };
    if (slideDragPreviewElement.current) {
      slideDragPreviewElement.current.style.left = left + "px";
      slideDragPreviewElement.current.style.top = top + "px";
    }
  }

  function onSlideDragStart(event: React.PointerEvent<HTMLLIElement>, slideId: string) {
    if (event.button !== 0 || !event.isPrimary || pointerSlideDrag.current) return;
    const target = event.target;
    if (target instanceof Element && target.closest("button, input, textarea, select") && !target.closest("[data-slide-drag-surface]")) return;
    pointerSlideDrag.current = { slideId, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, started: false, origin: event.currentTarget };
  }

  function onSlideDragMove(event: React.PointerEvent<HTMLLIElement>, slideId: string) {
    const drag = pointerSlideDrag.current;
    if (!drag || drag.slideId !== slideId || drag.pointerId !== event.pointerId) return;
    if (!drag.started) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
      event.preventDefault();
      drag.started = true;
      drag.origin.setPointerCapture(event.pointerId);
      setKeyboardDraggingSlideId(null);
      updateSlideDragPreview(event.clientX, event.clientY);
      startSlideReorder(slideId);
    } else {
      updateSlideDragPreview(event.clientX, event.clientY);
    }
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

  function onSlideDragEnd(event: React.PointerEvent<HTMLLIElement>, slideId: string) {
    const drag = pointerSlideDrag.current;
    if (!drag || drag.slideId !== slideId || drag.pointerId !== event.pointerId) return;
    pointerSlideDrag.current = null;
    if (drag.started) commitSlideReorder(slideId);
  }

  function onSlideDragCancel(event: React.PointerEvent<HTMLLIElement>, slideId: string) {
    const drag = pointerSlideDrag.current;
    if (!drag || drag.slideId !== slideId || drag.pointerId !== event.pointerId) return;
    pointerSlideDrag.current = null;
    if (drag.started) cancelSlideReorder();
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
    <ContentEditingContext.Provider value={contentTools.openEditor}>
    <div className="flex h-svh w-full min-w-0 flex-col overflow-hidden">
      {contentTools.dialogs}
      {/* Top bar */}
      <header className="flex min-w-0 items-center gap-2 border-b px-3 py-1.5">
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><HugeiconsIcon icon={ArrowLeft01Icon} className="size-3.5" /> Catalogs</Link>
        <Input
          key={doc.metadata.title}
          defaultValue={doc.metadata.title}
          aria-label="Catalog name"
          className="ml-2 h-6 min-w-0 flex-1 truncate rounded-none border-transparent bg-transparent px-0 py-0 text-sm leading-6 font-medium shadow-none focus-visible:border-transparent focus-visible:bg-transparent focus-visible:ring-0 focus-visible:underline"
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== doc.metadata.title) run({ type: "catalog.updateMetadata", changes: { title: v } }); else e.target.value = doc.metadata.title; }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        <span className={`shrink-0 text-xs ${saveStatus === "error" ? "text-destructive" : "text-muted-foreground"}`} aria-live="polite">{SAVE_LABEL[saveStatus]}</span>
        {cloudLabel && <span className="hidden shrink-0 text-xs text-muted-foreground lg:inline" aria-live="polite">· {cloudLabel}</span>}
        <TooltipHint content={`Undo (${kbd("Ctrl+Z")})`}><Button variant="ghost" size="icon-sm" aria-label="Undo" disabled={!state.canUndo} onClick={() => editor.undo()}><HugeiconsIcon icon={Undo02Icon} /></Button></TooltipHint>
        <TooltipHint content={`Redo (${kbd("Ctrl+Shift+Z")})`}><Button variant="ghost" size="icon-sm" aria-label="Redo" disabled={!state.canRedo} onClick={() => editor.redo()}><HugeiconsIcon icon={Redo02Icon} /></Button></TooltipHint>
        <TooltipHint content="Chat with your AI model about this catalog"><Button variant={workspace.isOpen("chat") ? "secondary" : "ghost"} size="icon-sm" aria-label="Chat" aria-pressed={workspace.isOpen("chat")} onClick={() => workspace.toggle("chat")}><HugeiconsIcon icon={MessageMultiple01Icon} /></Button></TooltipHint>
        <ExportMenu doc={doc} onVideo={() => setPreviewing("export")} prepareDocument={prepareDocumentForExport} extensionRenderers={extensionPptxRenderers} />
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
                {
                  id: "pen", icon: <HugeiconsIcon icon={PenTool01Icon} />, label: "Pen",
                  description: "Draw lines and curves: click to add points, drag to curve, click the first point to close. Enter or Esc finishes. Double-click a path later to edit its points; animate it with Draw in Motion.",
                  shortcut: "P", active: penActive, onClick: () => setPenActive((active) => !active),
                },
              ],
              [
                { id: "image", icon: <HugeiconsIcon icon={ImageAdd01Icon} />, label: "Image", description: "Upload a photo, logo or illustration from your computer. You can also paste images onto the slide.", onClick: () => fileInput.current?.click() },
                { id: "html", icon: <HugeiconsIcon icon={CodeIcon} />, label: "HTML block", description: "Add your own HTML and CSS, rendered safely in a sandbox (no scripts).", onClick: () => addElement({ type: "html", content: { html: SAMPLE_HTML, css: SAMPLE_CSS }, size: [W * 0.4, H * 0.3] } as never) },
              ],
              contentTools.tools,
              ...extensionToolGroups,
              [
                { id: "chat", icon: <HugeiconsIcon icon={MessageMultiple01Icon} />, label: "Chat", description: "Talk to your connected AI model about this catalog. It proposes edits you preview and apply.", active: workspace.isOpen("chat"), onClick: () => workspace.toggle("chat") },
              ],
            ]}
            bottom={
              <>
                <RailButton tool={{ id: "shortcuts", icon: <HugeiconsIcon icon={KeyboardIcon} />, label: "Keyboard shortcuts", description: "See every shortcut for editing, arranging, aligning and navigating.", shortcut: "?", onClick: () => setShortcutsOpen(true) }} />
                <RailButton tool={{ id: "extensions", icon: <HugeiconsIcon icon={PuzzleIcon} />, label: "Extensions", description: "Install and manage the approved extensions available to this catalog.", active: extensionStoreOpen, onClick: () => setExtensionStoreOpen(true) }} />
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
              onZoomChange={setZoom}
              actions={actions}
              annotationMode={annotationMode}
              highlightedAnnotation={hoveredChatAnnotation}
              onAnnotateElement={(slideId, elementId) => addElementsToChat(slideId, [elementId])}
              onAddElementsToChat={(slideId, elementIds) => addElementsToChat(slideId, elementIds, true)}
              getExtensionElementMenuItems={getExtensionElementMenuItems}
              onCancelAnnotation={cancelAnnotationMode}
              extensionRenderers={extensionRenderers}
              extensionEffects={extensionEffects}
              penActive={penActive}
              onPenFinished={() => setPenActive(false)}
            />
            {penActive && (
              <div className="pointer-events-none absolute top-3 left-1/2 z-20 -translate-x-1/2 rounded-full border bg-background/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-md backdrop-blur">
                Click to add points · drag to curve · click the first point to close · Enter or Esc to finish
              </div>
            )}
            {extensionCanvasWidgets.length > 0 && (
              <div aria-label="Canvas widgets" className="pointer-events-none absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-9rem)] flex-wrap items-end gap-2">
                {extensionCanvasWidgets.map(({ id, extensionId, content }) => (
                  <div key={id} className="pointer-events-auto">
                    <ExtensionUiBoundary extensionId={extensionId}>{content}</ExtensionUiBoundary>
                  </div>
                ))}
              </div>
            )}
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
              { id: "motion", label: "Motion", icon: <HugeiconsIcon icon={PlayIcon} /> },
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
                    <EditorLibraryPanel tab={libraryTab} editor={editor} doc={doc} slide={slide} selection={state.selection} assetUrls={assetUrls} addFont={uploadFont} productUi={productUi} extensionProperties={extensionProperties} onPlay={() => setPreviewing("play")} userId={userId} uploadImage={uploadImage} removeUpload={removeUpload} setExternalAssetUrl={setExternalAssetUrl} />
                  </div>
                </div>
              ),
            };
          }
          if (id === "chat") return {
            header: (
              <>
                <span className="truncate text-xs font-medium">Chat</span>
                {userId && <TooltipHint content={chatHistoryOpen ? "Return to chat" : "Chat history"}>
                  <Button variant={chatHistoryOpen ? "secondary" : "ghost"} size="icon-xs" aria-label={chatHistoryOpen ? "Return to chat" : "Chat history"} aria-pressed={chatHistoryOpen} onClick={() => setChatHistoryOpen((open) => !open)}>
                    <HugeiconsIcon icon={Clock01Icon} />
                  </Button>
                </TooltipHint>}
              </>
            ),
            body: (
              <EditorChat
                editor={editor}
                doc={doc}
                assetUrls={assetUrls}
                historyOpen={chatHistoryOpen}
                onHistoryOpenChange={setChatHistoryOpen}
                annotations={chatAnnotations}
                annotationMode={annotationMode}
                hoveredAnnotation={hoveredChatAnnotation}
                onAnnotationModeChange={setAnnotationMode}
                onHoveredAnnotationChange={setHoveredChatAnnotation}
                onAnnotationsSent={(sent) => {
                  const sentKeys = new Set(sent.map((annotation) => `${annotation.slideId}\u0000${annotation.elementId}`));
                  setChatAnnotations((current) => current.filter((annotation) => !sentKeys.has(`${annotation.slideId}\u0000${annotation.elementId}`)));
                  setHoveredChatAnnotation((current) => current && sentKeys.has(`${current.slideId}\u0000${current.elementId}`) ? null : current);
                }}
                onRemoveAnnotation={(annotation) => {
                  setChatAnnotations((current) => current.filter((item) => item.slideId !== annotation.slideId || item.elementId !== annotation.elementId));
                  setHoveredChatAnnotation((current) => current?.slideId === annotation.slideId && current.elementId === annotation.elementId ? null : current);
                }}
              />
            ),
          };
          return {
            header: (
              <>
                <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto" role="tablist" aria-label="Pages and extensions">
                  {[
                    { id: "slides", label: "Slides" },
                    { id: "layers", label: "Layers" },
                    ...extensionPanels.map(({ id, label }) => ({ id, label })),
                  ].map((tab) => (
                    <button key={tab.id} type="button" role="tab" aria-selected={sidebar === tab.id} onClick={() => setSidebar(tab.id)}
                      className="shrink-0 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground aria-selected:bg-muted aria-selected:text-foreground">
                      {tab.label}
                    </button>
                  ))}
                </div>
                {sidebar === "slides" && <Button variant="ghost" size="icon-xs" className="ml-auto" title={`Add slide (${kbd("Ctrl+M")})`} aria-label="Add slide" onClick={() => actions.addSlide()}><HugeiconsIcon icon={Add01Icon} /></Button>}
              </>
            ),
            body:
              sidebar === "layers" ? (
                <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pt-2">
                  <LayersPanel editor={editor} slide={slide} selection={state.selection} actions={actions} getExtensionElementMenuItems={getExtensionElementMenuItems} />
                </div>
              ) : sidebar === "slides" ? (
                <>
                  <span className="sr-only" aria-live="polite">{slideReorderAnnouncement}</span>
                  <ol ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
                  {slidesForList.map((s, i) => (
                    <li
                      key={s.id}
                      data-slide-id={s.id}
                      data-sortable-slide-id={s.id}
                      data-dragging={draggingSlideId === s.id ? "true" : undefined}
                      className="group relative rounded-lg transition-[background-color,box-shadow,opacity] duration-150 data-[dragging=true]:select-none data-[dragging=true]:bg-primary/5 data-[dragging=true]:opacity-25 data-[dragging=true]:shadow-md"
                      onPointerDown={(e) => onSlideDragStart(e, s.id)}
                      onPointerMove={(e) => onSlideDragMove(e, s.id)}
                      onPointerUp={(e) => onSlideDragEnd(e, s.id)}
                      onPointerCancel={(e) => onSlideDragCancel(e, s.id)}
                      onLostPointerCapture={(e) => onSlideDragCancel(e, s.id)}
                      onDragStart={(e) => e.preventDefault()}
                      onContextMenu={(e) => { editor.setActiveSlide(s.id); openMenu(e, slideMenu(actions, s.id, i, slidesForList.length, () => setRenamingSlide(s.id))); }}
                    >
                      <div className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                        <span className="tabular-nums">{i + 1}</span>
                        {renamingSlide === s.id ? (
                          <Input autoFocus defaultValue={s.name} aria-label="Slide name" className="h-5 min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 py-0 text-[11px] text-foreground shadow-none focus-visible:border-0 focus-visible:bg-transparent focus-visible:ring-0"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                            onBlur={(e) => { actions.renameSlide(s.id, e.target.value); setRenamingSlide(null); }}
                            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setRenamingSlide(null); }} />
                        ) : (
                          <span className="truncate" onDoubleClick={() => setRenamingSlide(s.id)}>{s.name}</span>
                        )}
                        <div className="ml-auto flex items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                          <TooltipHint content="Drag to reorder. Press Space, then ↑/↓ to move with the keyboard.">
                            <button
                              type="button"
                              data-slide-drag-surface
                              aria-label={`Reorder slide ${i + 1}: ${s.name}`}
                              aria-pressed={draggingSlideId === s.id}
                              aria-keyshortcuts="Space ArrowUp ArrowDown Escape"
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
                        data-slide-drag-surface
                        onClick={() => editor.setActiveSlide(s.id)}
                        aria-current={s.id === slide.id}
                        aria-label={`Slide ${i + 1}: ${s.name}`}
                        className="block w-full touch-none cursor-grab overflow-hidden rounded-md ring-1 ring-border aria-current:ring-2 aria-current:ring-sky-500 active:cursor-grabbing"
                      >
                        <SlideView doc={doc} slide={s} scale={thumbScale} mode="edit" highlightedElementId={hoveredChatAnnotation?.slideId === s.id ? hoveredChatAnnotation.elementId : undefined} resolveAsset={(id) => assetUrls[id]} extensionRenderers={extensionRenderers} extensionEffects={extensionEffects} />
                      </button>
                    </li>
                  ))}
                  </ol>
                </>
              ) : (
                <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                  {(() => {
                    const panel = extensionPanels.find((item) => item.id === sidebar);
                    return panel
                      ? <ExtensionUiBoundary key={panel.id} extensionId={panel.id}>{panel.content}</ExtensionUiBoundary>
                      : <p className="p-4 text-xs text-muted-foreground">This extension panel is unavailable.</p>;
                  })()}
                </div>
              ),
          };
        }}
      />
      {draggingSlideId && pointerSlideDrag.current?.started && (() => {
        const draggingSlide = doc.slides.find((item) => item.id === draggingSlideId);
        if (!draggingSlide) return null;
        const position = (previewSlideIds ?? doc.slides.map((item) => item.id)).indexOf(draggingSlideId) + 1;
        return (
          <div
            ref={slideDragPreviewElement}
            aria-hidden="true"
            className="pointer-events-none fixed z-[100] w-[min(220px,calc(100vw-24px))] overflow-hidden rounded-xl border border-primary/70 bg-background/90 p-1.5 opacity-75 shadow-2xl ring-1 ring-primary/20 backdrop-blur-sm"
            style={{ left: slideDragPosition.current.left, top: slideDragPosition.current.top }}
          >
            <div className="flex items-center justify-between gap-2 px-1 pb-1.5 text-[10px] font-medium">
              <span className="truncate">{draggingSlide.name}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{position} / {doc.slides.length}</span>
            </div>
            <div className="overflow-hidden rounded-md ring-1 ring-border">
              <SlideView doc={doc} slide={draggingSlide} scale={220 / W} mode="edit" resolveAsset={(id) => assetUrls[id]} extensionRenderers={extensionRenderers} extensionEffects={extensionEffects} />
            </div>
          </div>
        );
      })()}
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
      {previewing && <PreviewPlayer doc={doc} startSlide={previewing === "export" ? 0 : slideIndex} openExport={previewing === "export"} assetUrls={assetUrls} extensionRenderers={extensionRenderers} extensionEffects={extensionEffects} prepareDocument={(format, document) => prepareDocumentForExport(format, document)} onClose={() => setPreviewing(false)} />}
      {extensionStoreOpen && <ExtensionStoreDialog extensions={extensionStoreEntries} selectedElementCount={state.selection.length} onAction={actOnExtension} onRun={runExtension} onApply={applyExtensionEffect} onClose={() => setExtensionStoreOpen(false)} />}
    </div>
    </ContentEditingContext.Provider>
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
