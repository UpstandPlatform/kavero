"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { FileAttachmentIcon, FileDownloadIcon, FileScriptIcon, Film01Icon, Image01Icon, Loading02Icon, PackageIcon, Presentation01Icon } from "@hugeicons/core-free-icons";
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
import { useState } from "react";
import { toast } from "sonner";

import { downloadProjectFile, localCatalogs } from "@/modules/catalog/local-catalogs";

import { flushEditorSave } from "./use-catalog-editor";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Every stored image and font of the catalog as data: URLs, for exporters. */
export async function collectAssets(doc: CatalogDocument, kinds: ("image" | "font" | "video")[] = ["image", "font"]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const a of doc.assets) {
    if (!kinds.includes(a.kind)) continue;
    const stored = await localCatalogs().getAsset(a.id);
    if (stored) out[a.id] = await blobToDataUrl(new Blob([stored.blob], { type: a.mimeType }));
    else if (a.attribution?.provider !== "GIPHY" && /^https:\/\//i.test(a.uri)) out[a.id] = a.uri;
  }
  return out;
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
      const res = await fetch("/api/export/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document, assets: await collectAssets(document), pageNumbers }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "PDF export failed");
      download(await res.blob(), fileName(document, "pdf"));
      showWarnings("PDF exported", checkExportCompatibility(document, "pdf").map((w) => w.message));
    });

  const exportImages = (width: 1920 | 3840) =>
    run("jpg", async () => {
      const document = prepareDocument ? await prepareDocument("images", doc) : doc;
      const res = await fetch("/api/export/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document, assets: await collectAssets(document), width, quality: 90 }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Image export failed");
      download(await res.blob(), fileName(document, "zip"));
      showWarnings(`${document.slides.length} slide image${document.slides.length === 1 ? "" : "s"} exported`, checkExportCompatibility(document, "pdf").map((w) => w.message.replace("PDF is static", "Images are static")));
    });

  const exportPowerPoint = () =>
    run("pptx", async () => {
      const document = prepareDocument ? await prepareDocument("pptx", doc) : doc;
      // Built in the browser, so it also works offline.
      const { exportPptx } = await import("@Kavero/export-pptx");
      const { data, warnings } = await exportPptx<Blob>(document, { assets: await collectAssets(document, ["image"]), extensionRenderers });
      download(data, fileName(document, "pptx"));
      showWarnings("PowerPoint exported — text, shapes and images stay editable", warnings);
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
        ...(doc.assets.some((a) => a.kind === "video" && !assets[a.id]) ? ["Some videos aren't stored in this catalog and stay linked."] : []),
      ];
      showWarnings("Website exported — one HTML file you can upload anywhere", warnings);
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
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => run("file", () => flushEditorSave(doc.id).then(() => downloadProjectFile(doc.id, doc.metadata.title)))}><HugeiconsIcon icon={PackageIcon} /> Kavero project file</DropdownMenuItem>
      </DropdownMenuContent>
      </DropdownMenu>
      <TooltipContent>{busy ? `Exporting ${busy.toUpperCase()}…` : "Export"}</TooltipContent>
    </Tooltip>
  );
}
