import type { CatalogDocument } from "@Kavero/catalog-engine";
import { PDFDocument } from "pdf-lib";

import { createAssetStore, type ExportAsset } from "./assets";
import { launchBrowser } from "./browser";
import { openRenderPage } from "./network";

export interface PdfOptions {
  doc: CatalogDocument;
  /** assetId → data: URL. */
  assets: Record<string, ExportAsset>;
  /** Origin of the Kavero app serving /render. */
  baseUrl: string;
  pageNumbers?: boolean;
  /** Slides rendered per Chrome page (default 8). Smaller batches use less memory. */
  batchSize?: number;
}

const DEFAULT_BATCH = 8;

/**
 * One PDF page per slide at the slide's exact size. Text stays vector and
 * selectable; animations are shown in their finished state (PDF is static).
 *
 * Large catalogs are printed in batches, each in a fresh page, and merged, so
 * Chrome never has every high-resolution image of the catalog decoded at once.
 */
export async function renderPdf(opts: PdfOptions): Promise<Uint8Array> {
  const { width, height } = opts.doc.settings;
  const total = opts.doc.slides.length;
  const batch = Math.max(1, Math.floor(opts.batchSize ?? DEFAULT_BATCH));
  const store = createAssetStore(opts.assets, opts.baseUrl);
  const browser = await launchBrowser();
  try {
    const parts: Uint8Array[] = [];
    for (let start = 0; start < total; start += batch) {
      const slides = opts.doc.slides.slice(start, start + batch);
      const page = await openRenderPage(browser, opts.baseUrl, { viewport: { width: Math.round(width), height: Math.round(height) } }, store);
      try {
        await page.emulateMedia({ media: "screen" });
        await page.waitForFunction(() => typeof (window as unknown as { __kaveroPrint?: unknown }).__kaveroPrint === "function", null, { timeout: 30_000 });
        await page.evaluate(
          async ({ doc, assets, pageNumbers, offset, pageTotal }) => {
            const w = window as unknown as { __kaveroPrint: (d: unknown, a: unknown, n: boolean, o: { offset: number; total: number }) => Promise<void> };
            await w.__kaveroPrint(doc, assets, pageNumbers, { offset, total: pageTotal });
          },
          { doc: { ...opts.doc, slides }, assets: store.urls, pageNumbers: !!opts.pageNumbers, offset: start, pageTotal: total },
        );
        parts.push(await page.pdf({
          width: `${width}px`,
          height: `${height}px`,
          printBackground: true,
          margin: { top: "0", right: "0", bottom: "0", left: "0" },
          pageRanges: `1-${slides.length}`,
        }));
      } finally {
        // Free this batch's decoded images before the next one.
        await page.close().catch(() => undefined);
      }
    }
    return parts.length === 1 ? parts[0]! : await mergePdfs(parts);
  } finally {
    await browser.close();
  }
}

/** Concatenates PDFs in order. */
export async function mergePdfs(parts: Uint8Array[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const part of parts) {
    const src = await PDFDocument.load(part);
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) out.addPage(p);
  }
  return out.save();
}
