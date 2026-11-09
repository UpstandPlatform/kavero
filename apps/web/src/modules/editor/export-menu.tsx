"use client";

import { checkExportCompatibility, safeFileName, type CatalogDocument } from "@Kavero/catalog-engine";
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
import { ChevronDown, FileDown, FileText, Film, Loader2, Package, Presentation } from "lucide-react";
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
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => run("file", () => downloadProjectFile(doc.id, doc.metadata.title))}><Package /> Kavero project file</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
