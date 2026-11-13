"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Delete02Icon, ImageAdd01Icon, Link01Icon, Search01Icon, Upload01Icon } from "@hugeicons/core-free-icons";
import { catalogElementSchema, createBlockSlide, createId, PRESENTATION_BLOCKS, TEMPLATES, type CatalogAsset, type CatalogDocument, type CatalogSlide, type PresentationBlockKind } from "@Kavero/catalog-engine";
import type { Editor } from "@Kavero/editor-core";
import { SlideView } from "@Kavero/renderer";
import { Button } from "@Kavero/ui/components/button";
import { Input } from "@Kavero/ui/components/input";
import { Spinner } from "@Kavero/ui/components/spinner";
import { TooltipHint } from "@Kavero/ui/components/tooltip";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { makeTRPCClient } from "@/utils/trpc";
import { confirmAction } from "@/components/confirm-dialog";

import { TemplatePreview, type TemplateLayout } from "@/modules/catalog/template-preview";

import { MotionPropertiesPanel } from "./motion-properties-panel";
import { PropertiesPanel, type ExtensionDesignPropertyContent } from "./properties-panel";
import type { AddFont } from "./font-picker";
import { useRun } from "./use-catalog-editor";
import { usePublicConfig } from "@/lib/public-config";
import { MediaJobPreview } from "@/modules/ai/media-job-preview";
export type EditorLibraryTab = "design" | "motion" | "templates" | "blocks" | "media" | "uploads";

const client = makeTRPCClient();

export function EditorLibraryPanel({
  tab,
  editor,
  doc,
  slide,
  selection,
  assetUrls,
  addFont,
  productUi,
  extensionProperties,
  onPlay,
  userId,
  uploadImage,
  uploadVideo,
  removeUpload,
  setExternalAssetUrl,
}: {
  tab: EditorLibraryTab;
  editor: Editor;
  doc: CatalogDocument;
  slide: CatalogSlide;
  selection: string[];
  assetUrls: Record<string, string>;
  addFont: AddFont;
  productUi: React.ComponentProps<typeof PropertiesPanel>["productUi"];
  extensionProperties: ExtensionDesignPropertyContent[];
  onPlay: () => void;
  userId: string | null;
  uploadImage: (file: File, attribution?: NonNullable<CatalogAsset["attribution"]>) => Promise<{ assetId: string; width: number; height: number }>;
  uploadVideo: (file: File) => Promise<{ assetId: string; width: number; height: number }>;
  removeUpload: (assetId: string) => Promise<void>;
  setExternalAssetUrl: (assetId: string, url: string) => void;
}) {
  let content: ReactNode;
  if (tab === "design") content = <PropertiesPanel editor={editor} doc={doc} slide={slide} selection={selection} addFont={addFont} assetUrls={assetUrls} productUi={productUi} extensionProperties={extensionProperties} />;
  else if (tab === "motion") content = <MotionPropertiesPanel editor={editor} doc={doc} slide={slide} selection={selection} onPlay={onPlay} />;
  else if (tab === "templates") content = <TemplatesLibrary editor={editor} doc={doc} />;
  else if (tab === "blocks") content = <BlocksLibrary editor={editor} doc={doc} />;
  else if (tab === "media") content = <MediaLibrary editor={editor} doc={doc} slide={slide} assetUrls={assetUrls} uploadImage={uploadImage} uploadVideo={uploadVideo} userId={userId} setExternalAssetUrl={setExternalAssetUrl} />;
  else content = <UploadsLibrary editor={editor} doc={doc} slide={slide} assetUrls={assetUrls} uploadImage={uploadImage} removeUpload={removeUpload} />;
  return <div className="h-full min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain">{content}</div>;
}

function TemplatesLibrary({ editor, doc }: { editor: Editor; doc: CatalogDocument }) {
  const [busy, setBusy] = useState<string | null>(null);
  function insert(templateId: string) {
    const template = TEMPLATES.find((candidate) => candidate.id === templateId);
    if (!template) return;
    setBusy(template.id);
    try {
      const slides = template.build(doc).map((slide) => resolveTemplateTokens(slide, template.theme));
      const activeIndex = doc.slides.findIndex((candidate) => candidate.id === editor.getState().activeSlideId);
      const insertionIndex = activeIndex < 0 ? doc.slides.length : activeIndex + 1;
      const result = editor.execute({
        type: "batch",
        label: `Insert ${template.name} template`,
        commands: [
          ...slides.map((slide, index) => ({ type: "slide.add" as const, slide, index: insertionIndex + index })),
        ],
      });
      const firstSlideId = result.createdIds[0];
      if (firstSlideId) editor.setActiveSlide(firstSlideId);
      toast.success(`${template.name} slides added`, { description: `${slides.length} editable slides were added after the active slide. Their template styling was kept, and existing slides were preserved.` });
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid min-w-0 content-start gap-4 p-3">
      <div>
        <h2 className="text-sm font-semibold">Templates</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Add a complete, editable set of slides. Your current slides stay in place.</p>
      </div>
      {TEMPLATES.map((template) => (
        <article key={template.id} className="grid min-w-0 gap-2 rounded-xl border bg-card p-2">
          <TemplatePreview theme={template.theme} layout={template.layout as TemplateLayout} title={template.name} className="w-full" />
          <div className="min-w-0">
            <h3 className="text-xs font-medium">{template.name}</h3>
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{template.description}</p>
          </div>
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => insert(template.id)}>
            {busy === template.id ? <Spinner data-icon="inline-start" /> : <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />}
            Add {template.name} slides
          </Button>
        </article>
      ))}
    </div>
  );
}

function resolveTemplateTokens(slide: CatalogSlide, theme: CatalogDocument["theme"]): CatalogSlide {
  const resolve = (value: unknown): unknown => {
    if (typeof value === "string" && value.startsWith("token:")) {
      const token = value.slice("token:".length);
      return theme.colors[token] ?? theme.fonts[token] ?? value;
    }
    if (Array.isArray(value)) return value.map(resolve);
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, resolve(nested)]));
    }
    return value;
  };
  return resolve(slide) as CatalogSlide;
}

function imageElement(assetId: string, alt: string, x: number, y: number, width: number, height: number) {
  return catalogElementSchema.parse({
    id: createId("el"),
    type: "image",
    content: { assetId, alt },
    position: { x, y, width, height, rotation: 0 },
    style: { fit: "contain", borderRadius: 0 },
  });
}

function videoElement(assetId: string, posterAssetId: string | undefined, x: number, y: number, width: number, height: number) {
  return catalogElementSchema.parse({
    id: createId("el"), type: "video", content: { assetId, posterAssetId },
    position: { x, y, width, height, rotation: 0 }, style: { autoplay: false, loop: true, muted: true },
  });
}

function BlocksLibrary({ editor, doc }: { editor: Editor; doc: CatalogDocument }) {
  function addBlock(kind: PresentationBlockKind, name: string) {
    try {
      const slide = createBlockSlide(kind, name, doc.settings.width, doc.settings.height);
      const index = doc.slides.findIndex((item) => item.id === editor.getState().activeSlideId) + 1;
      const result = editor.execute({ type: "slide.add", slide, index });
      const id = result.createdIds[0];
      if (id) editor.setActiveSlide(id);
      toast.success(`${name} added as an editable slide`);
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <div className="grid min-w-0 content-start gap-3 p-3">
      <div>
        <h2 className="text-sm font-semibold">Building blocks</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Add a ready-made slide after the current one, then edit every text and shape.</p>
      </div>
      {PRESENTATION_BLOCKS.map((block) => <BlockCard key={block.id} block={block} doc={doc} onAdd={() => addBlock(block.id, block.name)} />)}
    </div>
  );
}

function BlockCard({ block, doc, onAdd }: { block: (typeof PRESENTATION_BLOCKS)[number]; doc: CatalogDocument; onAdd: () => void }) {
  const slide = useMemo(() => createBlockSlide(block.id, block.name, doc.settings.width, doc.settings.height), [block, doc.settings.width, doc.settings.height]);
  const scale = Math.min(320 / doc.settings.width, 180 / doc.settings.height);
  return (
    <button type="button" onClick={onAdd} className="group grid gap-2 rounded-xl border bg-card p-2 text-start transition-colors hover:bg-muted/40">
      <div className="flex aspect-video items-center justify-center overflow-hidden rounded-md border bg-muted/30">
        <SlideView doc={doc} slide={slide} scale={scale} mode="edit" className="shrink-0" />
      </div>
      <span className="text-xs font-medium">{block.name}</span>
      <span className="text-[11px] leading-snug text-muted-foreground">{block.description}</span>
    </button>
  );
}

function AssetGrid({ doc, assetUrls, onInsert, onRemove, emptyText = "Your image library is empty. Upload an image to keep it with this catalog." }: {
  doc: CatalogDocument;
  assetUrls: Record<string, string>;
  onInsert: (assetId: string, alt: string) => void;
  onRemove?: (assetId: string, name: string) => void;
  emptyText?: string;
}) {
  const images = doc.assets.filter((asset) => asset.kind === "image" && (assetUrls[asset.id] || (asset.attribution?.provider !== "GIPHY" && /^https?:\/\//i.test(asset.uri))));
  if (!images.length) return <div className="rounded-xl border border-dashed p-5 text-center text-xs leading-relaxed text-muted-foreground">{emptyText}</div>;
  return (
    <div className="grid min-w-0 grid-cols-2 gap-2">
      {images.map((asset) => (
        <div key={asset.id} className="group relative min-w-0 overflow-hidden rounded-lg border bg-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={assetUrls[asset.id] ?? asset.uri} alt={asset.name} className="aspect-square w-full bg-muted object-contain p-1" />
          <TooltipHint content={asset.name}><p tabIndex={0} className="truncate px-2 pt-1 text-[10px] font-medium">{asset.name}</p></TooltipHint>
          {asset.attribution && <p className="truncate px-2 pt-0.5 text-[9px] text-muted-foreground">{[asset.attribution.creator, asset.attribution.license, asset.attribution.provider].filter(Boolean).join(" · ")}</p>}
          <div className="flex items-center gap-1 p-1.5">
            <Button size="xs" variant="secondary" className="min-w-0 flex-1" onClick={() => onInsert(asset.id, asset.name)}><HugeiconsIcon icon={Add01Icon} data-icon="inline-start" /> Insert</Button>
            {onRemove && <Button size="icon-xs" variant="ghost" className="shrink-0 text-destructive" onClick={() => onRemove(asset.id, asset.name)} aria-label={`Remove ${asset.name} from uploads`} title="Remove from uploads"><HugeiconsIcon icon={Delete02Icon} /></Button>}
          </div>
        </div>
      ))}
    </div>
  );
}

type OpenverseImage = {
  id: string; title: string; url: string; thumbnail: string; creator?: string; creator_url?: string;
  license?: string; license_version?: string; license_url?: string; foreign_landing_url?: string; width?: number; height?: number;
};
type GiphyImage = {
  id: string; title?: string; url?: string;
  images?: { original?: { url?: string; width?: string; height?: string }; fixed_width?: { url?: string }; fixed_height?: { url?: string } };
};
const externalHttpUrl = (value: unknown) => typeof value === "string" && /^https?:\/\//i.test(value) ? value : undefined;

function MediaLibrary({ editor, doc, slide, assetUrls, uploadImage, uploadVideo, userId, setExternalAssetUrl }: {
  editor: Editor;
  doc: CatalogDocument;
  slide: CatalogSlide;
  assetUrls: Record<string, string>;
  uploadImage: (file: File, attribution?: NonNullable<CatalogAsset["attribution"]>) => Promise<{ assetId: string; width: number; height: number }>;
  uploadVideo: (file: File) => Promise<{ assetId: string; width: number; height: number }>;
  userId: string | null;
  setExternalAssetUrl: (assetId: string, url: string) => void;
}) {
  const run = useRun(editor);
  const [query, setQuery] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [source, setSource] = useState<"stock" | "gifs">("stock");
  const [stock, setStock] = useState<OpenverseImage[]>([]);
  const [gifs, setGifs] = useState<GiphyImage[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const { media } = usePublicConfig();
  const giphyKey = media.giphyApiKey;
  const openverseEnabled = media.openverseEnabled;
  const [generationPurpose, setGenerationPurpose] = useState<"image" | "video">("image");
  const [generationPrompt, setGenerationPrompt] = useState("");
  const [generationJobId, setGenerationJobId] = useState<string | null>(null);
  const [generationJobPurpose, setGenerationJobPurpose] = useState<"image" | "video">("image");
  const [generating, setGenerating] = useState(false);
  const sources: Array<"stock" | "gifs"> = [
    ...(openverseEnabled ? ["stock" as const] : []),
    ...(giphyKey ? ["gifs" as const] : []),
  ];
  const activeSource = sources.includes(source) ? source : sources[0] ?? null;
  const assets = useMemo(() => ({ ...doc, assets: doc.assets.filter((asset) => asset.name.toLowerCase().includes(query.trim().toLowerCase())) }), [doc, query]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(`kavero:media-job:${doc.id}`) ?? "null") as { id?: string; purpose?: "image" | "video" } | null;
      setGenerationJobId(stored?.id ?? null);
      if (stored?.purpose === "image" || stored?.purpose === "video") setGenerationJobPurpose(stored.purpose);
    } catch { /* local recovery is optional */ }
  }, [doc.id]);

  async function startGeneration() {
    if (!userId) return toast.error("Sign in to generate media.");
    if (generationPrompt.trim().length < 3) return toast.error("Enter a more detailed visual prompt.");
    setGenerating(true);
    try {
      const divisor = (a: number, b: number): number => b === 0 ? a : divisor(b, a % b);
      const common = divisor(doc.settings.width, doc.settings.height);
      const aspectRatio = `${Math.max(1, Math.round(doc.settings.width / common))}:${Math.max(1, Math.round(doc.settings.height / common))}`;
      const response = await fetch("/api/ai/media/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ purpose: generationPurpose, prompt: generationPrompt.trim(), aspectRatio }) });
      const data = await response.json() as { id?: string; error?: string };
      if (!response.ok || !data.id) throw new Error(data.error || "Could not start media generation.");
      setGenerationJobId(data.id);
      setGenerationJobPurpose(generationPurpose);
      try { localStorage.setItem(`kavero:media-job:${doc.id}`, JSON.stringify({ id: data.id, purpose: generationPurpose })); } catch { /* the job still runs without local recovery */ }
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function addGeneratedMedia(file: File, poster?: File) {
    const isVideo = file.type.startsWith("video/");
    const main = isVideo ? await uploadVideo(file) : await uploadImage(file);
    let width = main.width || doc.settings.width * 0.55;
    let height = main.height || doc.settings.height * 0.55;
    const maxWidth = doc.settings.width * 0.72;
    const maxHeight = doc.settings.height * 0.72;
    const scale = Math.min(maxWidth / width, maxHeight / height, 1);
    width = Math.round(width * scale); height = Math.round(height * scale);
    const x = Math.round((doc.settings.width - width) / 2);
    const y = Math.round((doc.settings.height - height) / 2);
    const posterId = poster ? (await uploadImage(poster)).assetId : undefined;
    const element = isVideo ? videoElement(main.assetId, posterId, x, y, width, height) : imageElement(main.assetId, file.name, x, y, width, height);
    const result = run({ type: "element.add", slideId: slide.id, element });
    if (!result) throw new Error("The generated media could not be added to this slide.");
    toast.success(isVideo ? "Video added to the active slide" : "Image added to the active slide");
  }

  useEffect(() => {
    if (!activeSource) {
      setSearching(false);
      setSearchError(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      setSearchError(null);
      const load = async () => {
        if (activeSource === "stock") {
          // Openverse limits anonymous requests to 20 images; asking for 24 returns HTTP 401.
          const params = new URLSearchParams({ q: query.trim() || "nature", page_size: "20", mature: "false" });
          const response = await fetch(`https://api.openverse.org/v1/images/?${params}`, { signal: controller.signal });
          if (!response.ok) throw new Error(response.status === 429 ? "The stock image service is busy. Try again shortly." : "Could not load stock images.");
          const data = await response.json() as { results?: OpenverseImage[] };
          setStock((data.results ?? []).filter((image) => image.id && externalHttpUrl(image.url) && externalHttpUrl(image.thumbnail)));
        } else {
          setGifs([]);
          if (!giphyKey) return;
          const params = new URLSearchParams({ api_key: giphyKey, limit: "24", rating: "g" });
          const queryText = query.trim().slice(0, 50);
          const endpoint = queryText ? "search" : "trending";
          if (queryText) params.set("q", queryText);
          const response = await fetch(`https://api.giphy.com/v1/gifs/${endpoint}?${params}`, { signal: controller.signal });
          if (!response.ok) throw new Error(response.status === 429 ? "GIPHY is busy. Try again shortly." : "Could not load GIFs.");
          const data = await response.json() as { data?: GiphyImage[] };
          setGifs((data.data ?? []).filter((gif) => externalHttpUrl(gif.url) && externalHttpUrl(gif.images?.original?.url) && externalHttpUrl(gif.images?.fixed_width?.url ?? gif.images?.fixed_height?.url)));
        }
      };
      void load().catch((error: unknown) => {
        if (!controller.signal.aborted) setSearchError((error as Error).message || "Media search failed.");
      }).finally(() => !controller.signal.aborted && setSearching(false));
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [activeSource, query, giphyKey]);

  function insert(assetId: string, alt: string, width = doc.settings.width * 0.45, height = doc.settings.height * 0.45) {
    const scale = Math.min((doc.settings.width * 0.68) / width, (doc.settings.height * 0.72) / height, 1);
    run({ type: "element.add", slideId: slide.id, element: imageElement(assetId, alt, Math.round((doc.settings.width - width * scale) / 2), Math.round((doc.settings.height - height * scale) / 2), Math.round(width * scale), Math.round(height * scale)) });
  }

  async function importImageUrl(url: string, name: string, attribution?: NonNullable<CatalogAsset["attribution"]>, width?: number, height?: number) {
    if (!userId) throw new Error("Sign in to add media to this catalog.");
    const [result] = await client.integrations.fetchImages.mutate({ urls: [url] });
    if (!result || !("dataUrl" in result) || !result.dataUrl) throw new Error((result && "error" in result && result.error) || "The source did not return a usable image.");
    const blob = await (await fetch(result.dataUrl)).blob();
    if (!blob.type.startsWith("image/")) throw new Error("The source did not return an image.");
    const safeName = name.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120) || "imported-image";
    const file = new File([blob], safeName.includes(".") ? safeName : `${safeName}.image`, { type: blob.type });
    const asset = await uploadImage(file, attribution);
    insert(asset.assetId, name, asset.width || width, asset.height || height);
    toast.success("Image added to this catalog");
  }

  async function importUrl() {
    let parsed: URL;
    try {
      parsed = new URL(sourceUrl.trim());
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Use an http or https image URL.");
    } catch (error) {
      return toast.error((error as Error).message || "Enter a valid image URL.");
    }
    setBusy(true);
    try {
      const name = decodeURIComponent(parsed.pathname.split("/").pop() || "imported-image");
      await importImageUrl(parsed.toString(), name, { provider: "External URL", sourceUrl: parsed.toString() });
      setSourceUrl("");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function addGif(gif: GiphyImage) {
    const media = gif.images?.original;
    const mediaUrl = media?.url;
    const sourceUrl = gif.url;
    if (!mediaUrl || !sourceUrl) return toast.error("This GIF has no usable media URL.");
    const existing = doc.assets.find((asset) => asset.kind === "image" && asset.attribution?.provider === "GIPHY" && asset.attribution.providerAssetId === gif.id);
    const assetId = existing?.id ?? createId("ast");
    const asset: CatalogAsset = existing ?? {
      id: assetId,
      kind: "image",
      mimeType: "image/gif",
      name: gif.title?.trim() || "GIPHY GIF",
      uri: sourceUrl,
      width: Number(media?.width) || undefined,
      height: Number(media?.height) || undefined,
      attribution: { provider: "GIPHY", providerAssetId: gif.id, sourceUrl },
    };
    const width = asset.width ?? doc.settings.width * 0.45;
    const height = asset.height ?? doc.settings.height * 0.45;
    const scale = Math.min((doc.settings.width * 0.68) / width, (doc.settings.height * 0.72) / height, 1);
    try {
      const result = run({
        type: "batch",
        label: "Add GIPHY GIF",
        commands: [
          ...(existing ? [] : [{ type: "asset.add" as const, asset }]),
          { type: "element.add", slideId: slide.id, element: imageElement(assetId, asset.name, Math.round((doc.settings.width - width * scale) / 2), Math.round((doc.settings.height - height * scale) / 2), Math.round(width * scale), Math.round(height * scale)) },
        ],
      });
      if (result) {
        setExternalAssetUrl(assetId, mediaUrl);
        toast.success("GIF added to the active slide");
      }
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  const externalAssets = activeSource === "stock" ? stock : [];

  return (
    <div className="grid min-w-0 content-start gap-4 p-3">
      <div>
        <h2 className="text-sm font-semibold">Media library</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Manage media for this catalog.</p>
      </div>
      <section className="grid gap-2 rounded-xl border bg-muted/10 p-2.5">
        <div><h3 className="text-xs font-semibold">Generate media</h3><p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">Preview generated images or videos, then add them to this slide.</p></div>
        <div className="grid grid-cols-2 gap-1 rounded-lg border bg-background p-1" role="group" aria-label="Media type">
          {(["image", "video"] as const).map((type) => <button key={type} type="button" aria-pressed={generationPurpose === type} onClick={() => setGenerationPurpose(type)} className="rounded-md px-2 py-1.5 text-xs font-medium capitalize aria-pressed:bg-primary/10 aria-pressed:text-primary">{type}</button>)}
        </div>
        <textarea value={generationPrompt} onChange={(event) => setGenerationPrompt(event.target.value)} maxLength={2000} rows={3} placeholder={generationPurpose === "image" ? "Describe the image to create…" : "Describe the video to create…"} className="min-h-20 resize-y rounded-md border bg-background px-2.5 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        <Button type="button" size="sm" disabled={generating || !userId || generationPrompt.trim().length < 3} onClick={() => void startGeneration()}>{generating ? <Spinner data-icon="inline-start" /> : <HugeiconsIcon icon={ImageAdd01Icon} data-icon="inline-start" />}{generating ? "Starting…" : `Generate ${generationPurpose}`}</Button>
        {!userId && <p className="text-[10px] text-muted-foreground">Sign in to use configured media providers.</p>}
        {generationJobId && <MediaJobPreview key={generationJobId} jobId={generationJobId} purpose={generationJobPurpose} onAdd={addGeneratedMedia} />}
      </section>
      {sources.length > 1 && <div className="grid grid-cols-2 rounded-lg border bg-muted/20 p-1" role="tablist" aria-label="Media sources">
        <button type="button" role="tab" aria-selected={activeSource === "stock"} onClick={() => setSource("stock")} className="rounded-md px-2 py-1.5 text-xs font-medium aria-selected:bg-background aria-selected:shadow-sm">Stock images</button>
        <button type="button" role="tab" aria-selected={activeSource === "gifs"} onClick={() => setSource("gifs")} className="rounded-md px-2 py-1.5 text-xs font-medium aria-selected:bg-background aria-selected:shadow-sm">GIFs</button>
      </div>}
      {activeSource && <>
      {sources.length === 1 && <h3 className="text-xs font-medium">{activeSource === "stock" ? "Stock images" : "GIFs"}</h3>}
      <label className="relative block">
        <HugeiconsIcon icon={Search01Icon} className="pointer-events-none absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} placeholder={activeSource === "gifs" ? "Search GIFs" : "Search stock images"} aria-label={`Search ${activeSource === "gifs" ? "GIFs" : "stock images"}`} className="ps-7" />
      </label>
      {activeSource === "stock" ? (
        <>
          <p className="text-[10px] leading-relaxed text-muted-foreground">Openverse images are openly licensed. Check each license and attribution before using it.</p>
          {searchError && <p role="status" className="rounded-lg border border-destructive/30 p-2 text-xs text-destructive">{searchError}</p>}
          {searching ? <div className="flex justify-center py-8"><Spinner /></div> : stock.length ? (
            <div className="grid grid-cols-2 gap-2">
              {externalAssets.map((image) => (
                <article key={image.id} className="min-w-0 overflow-hidden rounded-lg border bg-card">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.thumbnail} alt={image.title || "Stock image"} loading="lazy" className="aspect-square w-full bg-muted object-cover" />
                  <p className="truncate px-2 pt-1.5 text-[10px] font-medium" title={image.title}>{image.title || "Untitled image"}</p>
                  <p className="truncate px-2 pt-0.5 text-[9px] text-muted-foreground" title={image.creator || "Unknown creator"}>
                    {externalHttpUrl(image.creator_url) ? <a href={externalHttpUrl(image.creator_url)} target="_blank" rel="noreferrer" className="underline underline-offset-2">{image.creator || "Unknown creator"}</a> : image.creator || "Unknown creator"}
                    {" · "}
                    {externalHttpUrl(image.license_url) ? <a href={externalHttpUrl(image.license_url)} target="_blank" rel="noreferrer" className="underline underline-offset-2">{image.license?.toUpperCase() ?? "License"}</a> : image.license?.toUpperCase() ?? "License"}
                  </p>
                  <div className="flex items-center gap-1 p-1.5">
                    <Button size="xs" variant="secondary" className="min-w-0 flex-1" disabled={busy || !userId} onClick={() => void (async () => {
                      setBusy(true);
                      try {
                        await importImageUrl(image.url, image.title || "openverse-image", {
                          provider: "Openverse", creator: image.creator || undefined, creatorUrl: externalHttpUrl(image.creator_url),
                          license: image.license ? `${image.license}${image.license_version ? ` ${image.license_version}` : ""}` : undefined,
                          licenseUrl: externalHttpUrl(image.license_url), sourceUrl: externalHttpUrl(image.foreign_landing_url),
                        }, image.width, image.height);
                      } catch (error) { toast.error((error as Error).message); }
                      finally { setBusy(false); }
                    })()}><HugeiconsIcon icon={Add01Icon} data-icon="inline-start" /> Add</Button>
                    <a href={externalHttpUrl(image.foreign_landing_url) ?? image.url} target="_blank" rel="noreferrer" className="rounded-md px-1.5 py-1 text-[10px] text-muted-foreground underline underline-offset-2">Source</a>
                  </div>
                </article>
              ))}
            </div>
          ) : !searchError && <p className="py-6 text-center text-xs text-muted-foreground">No stock images found.</p>}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 rounded-lg border bg-card px-2 py-1.5" aria-label="Powered by GIPHY">
            <span className="text-[10px] text-muted-foreground">GIF search</span><span className="text-xs font-semibold">Powered by GIPHY</span>
          </div>
          {searchError ? <p role="status" className="rounded-lg border border-destructive/30 p-2 text-xs text-destructive">{searchError}</p>
          : searching ? <div className="flex justify-center py-8"><Spinner /></div>
          : gifs.length ? <div className="grid grid-cols-2 gap-2">
            {gifs.map((gif) => <button key={gif.id} type="button" onClick={() => addGif(gif)} title={`Add ${gif.title || "GIF"}`} className="overflow-hidden rounded-lg border bg-card text-start transition-colors hover:border-primary">
              {/* GIPHY media is displayed directly and is never downloaded or cached by Kavero. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={gif.images?.fixed_width?.url ?? gif.images?.fixed_height?.url} alt={gif.title || "GIPHY GIF"} loading="lazy" className="aspect-square w-full bg-muted object-contain" />
              <span className="block truncate px-2 py-1.5 text-[10px]">{gif.title || "Add GIF to slide"}</span>
            </button>)}
          </div> : !searchError && <p className="py-6 text-center text-xs text-muted-foreground">No GIFs found.</p>}
        </>
      )}
      </>}
      <div className="grid gap-2 rounded-xl border p-2">
        <label htmlFor="media-source-url" className="text-xs font-medium">Import an image URL</label>
        <div className="flex gap-1.5">
          <Input id="media-source-url" type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://example.com/image.jpg" className="min-w-0" />
          <Button size="icon" variant="secondary" disabled={!sourceUrl.trim() || busy || !userId} onClick={() => void importUrl()} aria-label="Import image from URL" title="Import image from URL">
            {busy ? <Spinner /> : <HugeiconsIcon icon={Link01Icon} />}
          </Button>
        </div>
        {!userId && <p className="text-[11px] leading-relaxed text-muted-foreground"><Link href="/login" className="font-medium text-foreground underline underline-offset-2">Sign in</Link> to save media to this catalog.</p>}
      </div>
      <div className="grid gap-2 border-t pt-3">
        <h3 className="text-xs font-medium">In this catalog</h3>
        <AssetGrid doc={assets} assetUrls={assetUrls} onInsert={(id, alt) => {
          const asset = doc.assets.find((candidate) => candidate.id === id);
          insert(id, alt, asset?.width ?? doc.settings.width * 0.45, asset?.height ?? doc.settings.height * 0.45);
        }} />
      </div>
    </div>
  );
}

function UploadsLibrary({ editor, doc, slide, assetUrls, uploadImage, removeUpload }: {
  editor: Editor;
  doc: CatalogDocument;
  slide: CatalogSlide;
  assetUrls: Record<string, string>;
  uploadImage: (file: File, attribution?: NonNullable<CatalogAsset["attribution"]>) => Promise<{ assetId: string; width: number; height: number }>;
  removeUpload: (assetId: string) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const run = useRun(editor);

  async function remove(assetId: string, name: string) {
    const usage = doc.slides.flatMap((candidate, index) => {
      const count = candidate.elements.filter((element) => JSON.stringify(element.content).includes(`"${assetId}"`)).length
        + Number(candidate.background.kind === "image" && candidate.background.assetId === assetId);
      return count ? [`Slide ${index + 1} “${candidate.name}” (${count} placement${count === 1 ? "" : "s"})`] : [];
    });
    const productUsage = doc.products.filter((product) => product.imageAssetIds.includes(assetId)).length;
    const detail = [...usage, ...(productUsage ? [`${productUsage} product image reference${productUsage === 1 ? "" : "s"}`] : [])].join("\n");
    const description = detail
      ? `This removes the upload from the library and removes its ${detail}. This cannot be undone.`
      : "This permanently removes the upload from this catalog. This cannot be undone.";
    if (!await confirmAction({ title: `Remove “${name}” from this catalog?`, description, confirmLabel: "Remove upload", destructive: true })) return;
    try {
      await removeUpload(assetId);
      toast.success(`Removed “${name}” from uploads`);
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    const failures: string[] = [];
    try {
      for (const file of Array.from(files)) {
        try {
          const asset = await uploadImage(file);
          const width = asset.width || doc.settings.width * 0.45;
          const height = asset.height || doc.settings.height * 0.45;
          const scale = Math.min((doc.settings.width * 0.68) / width, (doc.settings.height * 0.72) / height, 1);
          run({ type: "element.add", slideId: slide.id, element: imageElement(asset.assetId, file.name.replace(/\.[^.]+$/, ""), Math.round((doc.settings.width - width * scale) / 2), Math.round((doc.settings.height - height * scale) / 2), Math.round(width * scale), Math.round(height * scale)) });
        } catch (error) {
          failures.push(`${file.name}: ${(error as Error).message}`);
        }
      }
      if (failures.length) toast.error(`${failures.length} file${failures.length === 1 ? "" : "s"} could not be uploaded`, { description: failures.slice(0, 2).join(" · ") });
      else toast.success(`${files.length} image${files.length === 1 ? "" : "s"} uploaded and added to the slide`);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="grid min-w-0 content-start gap-4 p-3">
      <div>
        <h2 className="text-sm font-semibold">Uploads</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Images stay in this catalog’s local library and are included when the catalog is synced or exported.</p>
      </div>
      <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(event) => void upload(event.target.files)} />
      <div className="grid justify-items-center gap-2 rounded-xl border border-dashed bg-muted/20 p-5 text-center">
        <span className="grid size-10 place-items-center rounded-full bg-background text-primary"><HugeiconsIcon icon={ImageAdd01Icon} /></span>
        <p className="text-xs font-medium">Upload images from your device</p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">PNG, JPEG, GIF, WebP and SVG · up to 25 MB each</p>
        <Button size="sm" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? <Spinner data-icon="inline-start" /> : <HugeiconsIcon icon={Upload01Icon} data-icon="inline-start" />}
          {busy ? "Uploading…" : "Choose images"}
        </Button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium">In this catalog</h3>
        <span className="text-[11px] text-muted-foreground">{doc.assets.filter((asset) => asset.kind === "image" && asset.uri.startsWith("local://")).length} images</span>
      </div>
      <AssetGrid doc={{ ...doc, assets: doc.assets.filter((asset) => asset.uri.startsWith("local://")) }} assetUrls={assetUrls} onInsert={(id, alt) => {
        const asset = doc.assets.find((candidate) => candidate.id === id);
        const width = asset?.width ?? doc.settings.width * 0.45;
        const height = asset?.height ?? doc.settings.height * 0.45;
        const scale = Math.min((doc.settings.width * 0.68) / width, (doc.settings.height * 0.72) / height, 1);
        run({ type: "element.add", slideId: slide.id, element: imageElement(id, alt, Math.round((doc.settings.width - width * scale) / 2), Math.round((doc.settings.height - height * scale) / 2), Math.round(width * scale), Math.round(height * scale)) });
      }} onRemove={(id, name) => void remove(id, name)} />
    </div>
  );
}
