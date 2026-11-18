"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { BookOpen01Icon, FileAttachmentIcon, FileDownloadIcon, FileScriptIcon, Film01Icon, Image01Icon, Loading02Icon, PackageIcon, Presentation01Icon } from "@hugeicons/core-free-icons";
import { checkExportCompatibility, documentDirection, parseCatalogDocument, safeFileName, type CatalogDocument } from "@Kavero/catalog-engine";
import type { PptxExtensionRendererRegistry } from "@Kavero/export-pptx";
import { Button } from "@Kavero/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@Kavero/ui/components/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@Kavero/ui/components/dropdown-menu";
import { zipSync } from "fflate";
import { useState } from "react";
import { toast } from "sonner";

import { downloadProjectFile, localCatalogs } from "@/modules/catalog/local-catalogs";

import { flushEditorSave } from "./use-catalog-editor";
import { loadPublicConfig } from "@/lib/public-config";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function referencedAssetIds(doc: CatalogDocument) {
  const ids = new Set<string>();
  const assets = new Set(doc.assets.map((asset) => asset.id));
  const products = new Map(doc.products.map((product) => [product.id, product]));
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      if (assets.has(value)) ids.add(value);
      products.get(value)?.imageAssetIds.forEach((id) => ids.add(id));
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  for (const slide of doc.slides) {
    if (slide.background.kind === "image") ids.add(slide.background.assetId);
    for (const element of slide.elements) {
      visit(element.content);
    }
  }
  return ids;
}

/** Every stored image and font of the catalog as data: URLs, for exporters. */
export async function collectAssets(
  doc: CatalogDocument,
  kinds: ("image" | "font" | "video")[] = ["image", "font"],
  options: { includeExternalUrls?: boolean; referencedOnly?: boolean } = {},
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const referenced = options.referencedOnly ? referencedAssetIds(doc) : null;
  for (const a of doc.assets) {
    if (!kinds.includes(a.kind)) continue;
    if (referenced && a.kind !== "font" && !referenced.has(a.id)) continue;
    const stored = await localCatalogs().getAsset(a.id);
    if (stored) out[a.id] = await blobToDataUrl(new Blob([stored.blob], { type: a.mimeType }));
    else if (options.includeExternalUrls !== false && a.attribution?.provider !== "GIPHY" && /^https:\/\//i.test(a.uri)) out[a.id] = a.uri;
  }
  return out;
}

/**
 * The catalog's stored files for a server export, as raw blobs (no base64): media the
 * slides use plus every font. Linked https media is passed as URLs instead.
 */
export async function collectAssetFiles(
  doc: CatalogDocument,
  kinds: ("image" | "font" | "video")[] = ["image", "font"],
  options: { includeExternalUrls?: boolean } = {},
): Promise<{ files: Map<string, Blob>; urls: Record<string, string> }> {
  const files = new Map<string, Blob>();
  const urls: Record<string, string> = {};
  const referenced = referencedAssetIds(doc);
  for (const a of doc.assets) {
    if (!kinds.includes(a.kind)) continue;
    if (a.kind !== "font" && !referenced.has(a.id)) continue;
    const stored = await localCatalogs().getAsset(a.id);
    if (stored) files.set(a.id, new Blob([stored.blob], { type: a.mimeType }));
    else if (options.includeExternalUrls !== false && a.attribution?.provider !== "GIPHY" && /^https:\/\//i.test(a.uri)) urls[a.id] = a.uri;
  }
  return { files, urls };
}

const MB = 1024 * 1024;

/**
 * Sends a server export as multipart form data: a JSON `payload` plus one
 * `asset:<id>` part per file. Checks the server's size limit first, and turns a
 * dropped connection into an explanation instead of "Failed to fetch".
 */
export async function postExport(url: string, payload: Record<string, unknown>, assets: { files: Map<string, Blob>; urls: Record<string, string> }): Promise<Response> {
  const form = new FormData();
  form.append("payload", JSON.stringify({ ...payload, assets: assets.urls }));
  let bytes = 0;
  for (const [id, blob] of assets.files) {
    form.append(`asset:${id}`, blob, id);
    bytes += blob.size;
  }
  const limitMb = (await loadPublicConfig()).exports?.maxRequestMb;
  if (limitMb && bytes > limitMb * MB) {
    throw new Error(`This catalog's images and fonts add up to ${Math.ceil(bytes / MB)} MB, over this server's ${limitMb} MB export limit. Use smaller images, or raise "Largest export" in Admin → System → Exports.`);
  }
  try {
    return await fetch(url, { method: "POST", body: form });
  } catch (error) {
    throw new Error(`Couldn't reach the export service (${(error as Error).message}). The upload was ${Math.ceil(bytes / MB)} MB; if the server stopped or restarted, try again.`);
  }
}

export function missingReferencedMedia(doc: CatalogDocument, assets: Record<string, string>) {
  const referenced = referencedAssetIds(doc);
  return doc.assets.filter((asset) => referenced.has(asset.id) && ["image", "video"].includes(asset.kind) && !assets[asset.id]);
}

export function hasUnstoredVideoUrl(doc: CatalogDocument) {
  return doc.slides.some((slide) => slide.elements.some((element) => element.type === "video" && !element.content.assetId && !!element.content.url));
}

export function fileName(doc: CatalogDocument, ext: string) {
  return safeFileName(doc.metadata.title, ext);
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * One self-contained .html file: the catalog, its images, fonts and videos as data
 * URLs, and the standalone player (navigation, animations, transitions, Morph).
 * Upload it anywhere or open it straight from disk.
 */
export async function buildSingleHtml(doc: CatalogDocument, assets: Record<string, string>, player: string) {
  const lang = doc.metadata.language.replace(/[^\w-]/g, "") || "en";
  const title = escapeHtml(doc.metadata.title || "Catalog");
  const description = doc.metadata.description ? `<meta name="description" content="${escapeHtml(doc.metadata.description)}">` : "";
  // JSON and JS go inside <script>: "<" can never close the tag early.
  const data = JSON.stringify({ doc, assets }).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const js = player.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html>
<html lang="${lang}" dir="${documentDirection(doc)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${description}
<meta name="generator" content="Kavero">
<style>html,body{margin:0;height:100%;background:#000}#kavero{position:fixed;inset:0}noscript{color:#fff;font:16px system-ui,sans-serif;display:block;padding:2rem}</style>
</head>
<body>
<div id="kavero"></div>
<noscript>This catalog needs JavaScript to play.</noscript>
<script id="kavero-data" type="application/json">${data}</script>
<script>${js}</script>
</body>
</html>
`;
}

const MIME_EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif", "image/svg+xml": "svg",
  "video/mp4": "mp4", "video/webm": "webm", "font/ttf": "ttf", "font/otf": "otf", "font/woff": "woff", "font/woff2": "woff2",
};

/** Bytes and a file extension for a data: URL. */
function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; ext: string } {
  const comma = dataUrl.indexOf(",");
  const header = dataUrl.slice(5, comma);
  const isBase64 = /;base64$/i.test(header);
  const mime = header.replace(/;base64$/i, "").split(";")[0]!.toLowerCase();
  const ext = MIME_EXT[mime] ?? (mime.split("/")[1] || "bin").replace(/[^a-z0-9]/g, "");
  const raw = dataUrl.slice(comma + 1);
  if (isBase64) {
    const bin = atob(raw);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, ext };
  }
  return { bytes: new TextEncoder().encode(decodeURIComponent(raw)), ext };
}

function flipbookHtml(doc: CatalogDocument, assets: Record<string, string>) {
  const lang = doc.metadata.language.replace(/[^\w-]/g, "") || "en";
  const title = escapeHtml(doc.metadata.title || "Catalog");
  const description = doc.metadata.description ? `<meta name="description" content="${escapeHtml(doc.metadata.description)}">` : "";
  const data = JSON.stringify({ doc, assets }).split("<").join("\\u003c");
  return `<!doctype html>
<html lang="${lang}" dir="${documentDirection(doc)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${description}
<meta name="generator" content="Kavero">
<style>html,body{margin:0;height:100%;background:#1b1b22}#kavero{position:fixed;inset:0}noscript{color:#fff;font:16px system-ui,sans-serif;display:block;padding:2rem}</style>
</head>
<body>
<div id="kavero"></div>
<noscript>This flipbook needs JavaScript to open.</noscript>
<script id="kavero-data" type="application/json">${data}</script>
<script src="./kavero-flipbook.js"></script>
</body>
</html>
`;
}

/**
 * A .zip holding a standalone flipbook: index.html, the flipbook script, and an
 * assets/ folder with the images, fonts and videos as separate files. Opens in
 * any browser by double-clicking index.html — no server needed.
 */
export function buildFlipbookZip(doc: CatalogDocument, assets: Record<string, string>, player: string): { blob: Blob; bytes: number } {
  const files: Record<string, Uint8Array> = {};
  const assetMap: Record<string, string> = {};
  for (const [id, value] of Object.entries(assets)) {
    if (/^https?:\/\//i.test(value)) { assetMap[id] = value; continue; } // keep already-linked media
    if (!value.startsWith("data:")) continue;
    const { bytes, ext } = dataUrlToBytes(value);
    const path = `assets/${id}.${ext}`;
    files[path] = bytes;
    assetMap[id] = `./${path}`;
  }
  files["kavero-flipbook.js"] = new TextEncoder().encode(player);
  files["index.html"] = new TextEncoder().encode(flipbookHtml(doc, assetMap));
  files["README.txt"] = new TextEncoder().encode(
    `${doc.metadata.title || "Catalog"} — flipbook

Double-click index.html to open it in any web browser. Keep this folder together: the assets folder and kavero-flipbook.js must sit next to index.html.
Made with Kavero.
`,
  );
  // Media is already compressed; store it, and only deflate the text files.
  const zipped = zipSync(files, { level: 0 });
  return { blob: new Blob([zipped as BlobPart], { type: "application/zip" }), bytes: zipped.length };
}

function showWarnings(title: string, warnings: string[]) {
  const unique = [...new Set(warnings)];
  if (!unique.length) return toast.success(title);
  toast.success(title, { description: unique.slice(0, 3).join(" "), duration: 8000 });
}

export function ExportMenu({ doc, onVideo, prepareDocument, extensionRenderers }: {
  doc: CatalogDocument;
  onVideo: () => void;
  prepareDocument?: (format: "pdf" | "images" | "pptx" | "html", document: CatalogDocument) => Promise<CatalogDocument>;
  extensionRenderers?: PptxExtensionRendererRegistry;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function run(kind: string, fn: () => Promise<void>) {
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const exportPdf = (pageNumbers: boolean) =>
    run("pdf", async () => {
      const document = prepareDocument ? await prepareDocument("pdf", doc) : doc;
      const res = await postExport("/api/export/pdf", { document, pageNumbers }, await collectAssetFiles(document));
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "PDF export failed");
      download(await res.blob(), fileName(document, "pdf"));
      showWarnings("PDF exported", checkExportCompatibility(document, "pdf").map((w) => w.message));
    });

  const exportImages = (width: 1920 | 3840) =>
    run("jpg", async () => {
      const document = prepareDocument ? await prepareDocument("images", doc) : doc;
      const res = await postExport("/api/export/images", { document, width, quality: 90 }, await collectAssetFiles(document));
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Image export failed");
      download(await res.blob(), fileName(document, "zip"));
      showWarnings(`${document.slides.length} slide image${document.slides.length === 1 ? "" : "s"} exported`, checkExportCompatibility(document, "pdf").map((w) => w.message.replace("PDF is static", "Images are static")));
    });

  const exportPowerPoint = () =>
    run("pptx", async () => {
      const document = prepareDocument ? await prepareDocument("pptx", doc) : doc;
      // Built in the browser, so it also works offline.
      const { exportPptx } = await import("@Kavero/export-pptx");
      const { data, warnings } = await exportPptx<Blob>(document, { assets: await collectAssets(document, ["image", "video"]), extensionRenderers });
      download(data, fileName(document, "pptx"));
      const hasVideo = document.slides.some((slide) => slide.elements.some((element) => element.type === "video"));
      showWarnings(hasVideo ? "PowerPoint exported — video is embedded with its cover image" : "PowerPoint exported — text, shapes and images stay editable", warnings);
    });

  const exportHtml = () =>
    run("html", async () => {
      const document = prepareDocument ? await prepareDocument("html", doc) : doc;
      const res = await fetch("/kavero-player.js");
      if (!res.ok) throw new Error("The website player is missing. Run `bun run build:player` in apps/web.");
      const assets = await collectAssets(document, ["image", "font", "video"]);
      const html = await buildSingleHtml(document, assets, await res.text());
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      download(blob, fileName(doc, "html"));
      const mb = blob.size / 1024 / 1024;
      const warnings = [
        ...(mb > 25 ? [`The file is ${mb.toFixed(0)} MB — compress large images or videos for faster loading.`] : []),
        ...(document.assets.some((a) => a.kind === "video" && !assets[a.id]) ? ["Some videos aren't stored in this catalog and stay linked."] : []),
      ];
      showWarnings("Website exported — one HTML file you can upload anywhere", warnings);
    });

  const exportFlipbook = () =>
    run("flipbook", async () => {
      const document = prepareDocument ? await prepareDocument("html", doc) : doc;
      const res = await fetch("/kavero-flipbook.js");
      if (!res.ok) throw new Error("The flipbook player is missing. Run `bun run build:player` in apps/web.");
      const assets = await collectAssets(document, ["image", "font", "video"]);
      const { blob, bytes } = buildFlipbookZip(document, assets, await res.text());
      download(blob, fileName(document, "zip"));
      const mb = bytes / 1024 / 1024;
      showWarnings("Flipbook exported — a .zip you can open in any browser", mb > 50 ? [`The zip is ${mb.toFixed(0)} MB; compress large media for easier sharing.`] : []);
    });

  return (
    <Tooltip>
      <DropdownMenu>
      <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="outline" size="icon-sm" aria-label="Export" disabled={!!busy} />} />}>
        {busy ? <HugeiconsIcon icon={Loading02Icon} className="animate-spin" /> : <HugeiconsIcon icon={FileDownloadIcon} />}
      </TooltipTrigger>
      <DropdownMenuContent align="end" className="w-60 bg-card">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Export as</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => exportPdf(false)}><HugeiconsIcon icon={FileAttachmentIcon} /> PDF</DropdownMenuItem>
          <DropdownMenuItem onClick={() => exportPdf(true)}><HugeiconsIcon icon={FileAttachmentIcon} /> PDF with page numbers</DropdownMenuItem>
          <DropdownMenuItem onClick={() => exportImages(1920)}><HugeiconsIcon icon={Image01Icon} /> JPG images (.zip)</DropdownMenuItem>
          <DropdownMenuItem onClick={() => exportImages(3840)}><HugeiconsIcon icon={Image01Icon} /> JPG images, 4K (.zip)</DropdownMenuItem>
          <DropdownMenuItem onClick={exportPowerPoint}><HugeiconsIcon icon={Presentation01Icon} /> PowerPoint (.pptx)</DropdownMenuItem>
          <DropdownMenuItem onClick={onVideo}><HugeiconsIcon icon={Film01Icon} /> Video (MP4)…</DropdownMenuItem>
          <DropdownMenuItem onClick={exportHtml}><HugeiconsIcon icon={FileScriptIcon} /> Website (single HTML file)</DropdownMenuItem>
          <DropdownMenuItem onClick={exportFlipbook}><HugeiconsIcon icon={BookOpen01Icon} /> Flipbook (.zip)</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => run("file", () => flushEditorSave(doc.id).then(() => downloadProjectFile(doc.id, doc.metadata.title)))}><HugeiconsIcon icon={PackageIcon} /> Kavero project file</DropdownMenuItem>
      </DropdownMenuContent>
      </DropdownMenu>
      <TooltipContent>{busy ? `Exporting ${busy.toUpperCase()}…` : "Export"}</TooltipContent>
    </Tooltip>
  );
}
