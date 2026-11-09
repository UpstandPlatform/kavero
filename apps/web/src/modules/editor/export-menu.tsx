"use client";

import { checkExportCompatibility, documentDirection, safeFileName, type CatalogDocument } from "@Kavero/catalog-engine";
import { Button } from "@Kavero/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@Kavero/ui/components/dropdown-menu";
import { ChevronDown, FileCode, FileDown, FileText, Film, Loader2, Package, Presentation } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { downloadProjectFile, localCatalogs } from "@/modules/catalog/local-catalogs";

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

export function ExportMenu({ doc, onVideo }: { doc: CatalogDocument; onVideo: () => void }) {
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
      const res = await fetch("/api/export/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document: doc, assets: await collectAssets(doc), pageNumbers }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "PDF export failed");
      download(await res.blob(), fileName(doc, "pdf"));
      showWarnings("PDF exported", checkExportCompatibility(doc, "pdf").map((w) => w.message));
    });

  const exportPowerPoint = () =>
    run("pptx", async () => {
      // Built in the browser, so it also works offline.
      const { exportPptx } = await import("@Kavero/export-pptx");
      const { data, warnings } = await exportPptx<Blob>(doc, { assets: await collectAssets(doc, ["image"]) });
      download(data, fileName(doc, "pptx"));
      showWarnings("PowerPoint exported — text, shapes and images stay editable", warnings);
    });

  const exportHtml = () =>
    run("html", async () => {
      const res = await fetch("/kavero-player.js");
      if (!res.ok) throw new Error("The website player is missing. Run `bun run build:player` in apps/web.");
      const assets = await collectAssets(doc, ["image", "font", "video"]);
      const html = await buildSingleHtml(doc, assets, await res.text());
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
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" disabled={!!busy} />}>
        {busy ? <Loader2 className="animate-spin" /> : <FileDown />} {busy ? `Exporting ${busy.toUpperCase()}…` : "Export"} <ChevronDown className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 bg-card">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Export as</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => exportPdf(false)}><FileText /> PDF</DropdownMenuItem>
          <DropdownMenuItem onClick={() => exportPdf(true)}><FileText /> PDF with page numbers</DropdownMenuItem>
          <DropdownMenuItem onClick={exportPowerPoint}><Presentation /> PowerPoint (.pptx)</DropdownMenuItem>
          <DropdownMenuItem onClick={onVideo}><Film /> Video (MP4)…</DropdownMenuItem>
          <DropdownMenuItem onClick={exportHtml}><FileCode /> Website (single HTML file)</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => run("file", () => downloadProjectFile(doc.id, doc.metadata.title))}><Package /> Kavero project file</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
