"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, ImageAdd01Icon, Link01Icon, Search01Icon, Upload01Icon } from "@hugeicons/core-free-icons";
import { catalogElementSchema, createBlockSlide, createId, PRESENTATION_BLOCKS, TEMPLATES, type CatalogDocument, type CatalogSlide, type PresentationBlockKind } from "@Kavero/catalog-engine";
import type { Editor } from "@Kavero/editor-core";
import { Button } from "@Kavero/ui/components/button";
import { Input } from "@Kavero/ui/components/input";
import { Spinner } from "@Kavero/ui/components/spinner";
import { TooltipHint } from "@Kavero/ui/components/tooltip";
import Link from "next/link";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { makeTRPCClient } from "@/utils/trpc";

import { TemplatePreview, type TemplateLayout } from "@/modules/catalog/template-preview";

import { PropertiesPanel } from "./properties-panel";
import type { AddFont } from "./font-picker";
import { useRun } from "./use-catalog-editor";

export type EditorLibraryTab = "design" | "templates" | "blocks" | "media" | "uploads";

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
  userId,
  uploadImage,
}: {
  tab: EditorLibraryTab;
  editor: Editor;
  doc: CatalogDocument;
  slide: CatalogSlide;
  selection: string[];
  assetUrls: Record<string, string>;
  addFont: AddFont;
  productUi: React.ComponentProps<typeof PropertiesPanel>["productUi"];
  userId: string | null;
  uploadImage: (file: File) => Promise<{ assetId: string; width: number; height: number }>;
}) {
  let content: ReactNode;
  if (tab === "design") content = <PropertiesPanel editor={editor} doc={doc} slide={slide} selection={selection} addFont={addFont} assetUrls={assetUrls} productUi={productUi} />;
  else if (tab === "templates") content = <TemplatesLibrary editor={editor} doc={doc} />;
  else if (tab === "blocks") content = <BlocksLibrary editor={editor} doc={doc} />;
  else if (tab === "media") content = <MediaLibrary editor={editor} doc={doc} slide={slide} assetUrls={assetUrls} uploadImage={uploadImage} userId={userId} />;
  else content = <UploadsLibrary editor={editor} doc={doc} slide={slide} assetUrls={assetUrls} uploadImage={uploadImage} />;
  return <div className="h-full min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain">{content}</div>;
}

function TemplatesLibrary({ editor, doc }: { editor: Editor; doc: CatalogDocument }) {
  const [busy, setBusy] = useState<string | null>(null);
  function insert(templateId: string) {
    const template = TEMPLATES.find((candidate) => candidate.id === templateId);
    if (!template) return;
    setBusy(template.id);
    try {
      const slides = template.build(doc);
      const result = editor.execute({
        type: "batch",
        label: `Insert ${template.name} template`,
        commands: [
          { type: "catalog.updateTheme", theme: template.theme },
          ...slides.map((slide) => ({ type: "slide.add" as const, slide })),
        ],
      });
      const firstSlideId = result.createdIds[0];
      if (firstSlideId) editor.setActiveSlide(firstSlideId);
      toast.success(`${template.name} slides added`, { description: `${slides.length} editable slides were added and the catalog style was updated.` });
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

function imageElement(assetId: string, alt: string, x: number, y: number, width: number, height: number) {
  return catalogElementSchema.parse({
    id: createId("el"),
    type: "image",
    content: { assetId, alt },
    position: { x, y, width, height, rotation: 0 },
    style: { fit: "contain", borderRadius: 0 },
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
      {PRESENTATION_BLOCKS.map((block) => (
        <button key={block.id} type="button" onClick={() => addBlock(block.id, block.name)} className="group grid gap-2 rounded-xl border bg-card p-2 text-start transition-colors hover:bg-muted/40">
          <div className="grid aspect-video grid-cols-3 gap-1 overflow-hidden rounded-md border bg-muted/30 p-[7%]">
            <span className="col-span-3 h-2 rounded-sm bg-primary/70" />
            <span className="col-span-2 h-1.5 rounded-sm bg-foreground/40" />
            <span className="row-span-2 rounded-sm bg-primary/15" />
            <span className="col-span-2 h-1 rounded-sm bg-muted-foreground/30" />
          </div>
          <span className="text-xs font-medium">{block.name}</span>
          <span className="text-[11px] leading-snug text-muted-foreground">{block.description}</span>
        </button>
      ))}
    </div>
  );
}

function AssetGrid({ doc, assetUrls, onInsert }: {
  doc: CatalogDocument;
  assetUrls: Record<string, string>;
  onInsert: (assetId: string, alt: string) => void;
}) {
  const images = doc.assets.filter((asset) => asset.kind === "image" && assetUrls[asset.id]);
  if (!images.length) return <div className="rounded-xl border border-dashed p-5 text-center text-xs leading-relaxed text-muted-foreground">Your image library is empty. Upload an image to keep it with this catalog.</div>;
  return (
    <div className="grid min-w-0 grid-cols-2 gap-2">
      {images.map((asset) => (
        <div key={asset.id} className="group relative min-w-0 overflow-hidden rounded-lg border bg-card">
          {/* Local object URLs are created by this editor from the catalog's IndexedDB blobs. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={assetUrls[asset.id]} alt={asset.name} className="aspect-square w-full bg-muted object-contain p-1" />
          <TooltipHint content={asset.name}><p tabIndex={0} className="truncate px-2 pt-1 text-[10px] font-medium">{asset.name}</p></TooltipHint>
          <div className="flex items-center gap-1 p-1.5">
            <Button size="xs" variant="secondary" className="min-w-0 flex-1" onClick={() => onInsert(asset.id, asset.name)}><HugeiconsIcon icon={Add01Icon} data-icon="inline-start" /> Insert</Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function MediaLibrary({ editor, doc, slide, assetUrls, uploadImage, userId }: {
  editor: Editor;
  doc: CatalogDocument;
  slide: CatalogSlide;
  assetUrls: Record<string, string>;
  uploadImage: (file: File) => Promise<{ assetId: string; width: number; height: number }>;
  userId: string | null;
}) {
  const run = useRun(editor);
  const [query, setQuery] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const assets = useMemo(() => ({ ...doc, assets: doc.assets.filter((asset) => asset.name.toLowerCase().includes(query.trim().toLowerCase())) }), [doc, query]);

  function insert(assetId: string, alt: string, width = doc.settings.width * 0.45, height = doc.settings.height * 0.45) {
    const scale = Math.min((doc.settings.width * 0.68) / width, (doc.settings.height * 0.72) / height, 1);
    run({ type: "element.add", slideId: slide.id, element: imageElement(assetId, alt, Math.round((doc.settings.width - width * scale) / 2), Math.round((doc.settings.height - height * scale) / 2), Math.round(width * scale), Math.round(height * scale)) });
  }

  async function importUrl() {
    if (!userId) return toast.error("Sign in to import an image from a URL.");
    let parsed: URL;
    try {
      parsed = new URL(sourceUrl.trim());
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Use an http or https image URL.");
    } catch (error) {
      return toast.error((error as Error).message || "Enter a valid image URL.");
    }
    setBusy(true);
    try {
      const [result] = await client.integrations.fetchImages.mutate({ urls: [parsed.toString()] });
      if (!result || !("dataUrl" in result) || !result.dataUrl) throw new Error("The URL did not return a usable image.");
      const blob = await (await fetch(result.dataUrl)).blob();
      if (!blob.type.startsWith("image/")) throw new Error("The URL did not return an image.");
      const name = decodeURIComponent(parsed.pathname.split("/").pop() || "imported-image").replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120);
      const file = new File([blob], name.includes(".") ? name : `${name}.image`, { type: blob.type });
      const asset = await uploadImage(file);
      insert(asset.assetId, file.name, asset.width, asset.height);
      setSourceUrl("");
      toast.success("Image imported into this catalog");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-w-0 content-start gap-4 p-3">
      <div>
        <h2 className="text-sm font-semibold">Media library</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Browse images already saved with this catalog or import an image you have permission to use.</p>
      </div>
      <label className="relative block">
        <HugeiconsIcon icon={Search01Icon} className="pointer-events-none absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this catalog" aria-label="Search catalog media" className="ps-7" />
      </label>
      <div className="grid gap-2 rounded-xl border p-2">
        <label htmlFor="media-source-url" className="text-xs font-medium">Import from URL</label>
        <div className="flex gap-1.5">
          <Input id="media-source-url" type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://example.com/image.jpg" className="min-w-0" />
          <Button size="icon" variant="secondary" disabled={!sourceUrl.trim() || busy || !userId} onClick={() => void importUrl()} aria-label="Import image from URL" title="Import image from URL">
            {busy ? <Spinner /> : <HugeiconsIcon icon={Link01Icon} />}
          </Button>
        </div>
        {!userId && <p className="text-[11px] leading-relaxed text-muted-foreground"><Link href="/login" className="font-medium text-foreground underline underline-offset-2">Sign in</Link> to securely import an image URL. Local uploads work without an account.</p>}
      </div>
      <AssetGrid doc={assets} assetUrls={assetUrls} onInsert={(id, alt) => {
        const asset = doc.assets.find((candidate) => candidate.id === id);
        insert(id, alt, asset?.width ?? doc.settings.width * 0.45, asset?.height ?? doc.settings.height * 0.45);
      }} />
    </div>
  );
}

function UploadsLibrary({ editor, doc, slide, assetUrls, uploadImage }: {
  editor: Editor;
  doc: CatalogDocument;
  slide: CatalogSlide;
  assetUrls: Record<string, string>;
  uploadImage: (file: File) => Promise<{ assetId: string; width: number; height: number }>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const run = useRun(editor);

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
        <span className="text-[11px] text-muted-foreground">{doc.assets.filter((asset) => asset.kind === "image").length} images</span>
      </div>
      <AssetGrid doc={doc} assetUrls={assetUrls} onInsert={(id, alt) => {
        const asset = doc.assets.find((candidate) => candidate.id === id);
        const width = asset?.width ?? doc.settings.width * 0.45;
        const height = asset?.height ?? doc.settings.height * 0.45;
        const scale = Math.min((doc.settings.width * 0.68) / width, (doc.settings.height * 0.72) / height, 1);
        run({ type: "element.add", slideId: slide.id, element: imageElement(id, alt, Math.round((doc.settings.width - width * scale) / 2), Math.round((doc.settings.height - height * scale) / 2), Math.round(width * scale), Math.round(height * scale)) });
      }} />
    </div>
  );
}
