import type { CatalogDocument } from "@Kavero/catalog-engine";

import { launchBrowser } from "./browser";
import { openRenderPage } from "./network";

export interface PdfOptions {
  doc: CatalogDocument;
  /** assetId → data: URL. */
  assets: Record<string, string>;
  /** Origin of the Kavero app serving /render. */
  baseUrl: string;
  pageNumbers?: boolean;
}

/**
 * One PDF page per slide at the slide's exact size. Text stays vector and
 * selectable; animations are shown in their finished state (PDF is static).
 */
export async function renderPdf(opts: PdfOptions): Promise<Uint8Array> {
  const { width, height } = opts.doc.settings;
  const browser = await launchBrowser();
  try {
    const page = await openRenderPage(browser, opts.baseUrl, { viewport: { width: Math.round(width), height: Math.round(height) } });
    await page.emulateMedia({ media: "screen" });
    await page.waitForFunction(() => typeof (window as unknown as { __kaveroPrint?: unknown }).__kaveroPrint === "function", null, { timeout: 30_000 });
    await page.evaluate(
      async ({ doc, assets, pageNumbers }) => {
        const w = window as unknown as { __kaveroPrint: (d: unknown, a: unknown, n: boolean) => Promise<void> };
        await w.__kaveroPrint(doc, assets, pageNumbers);
      },
      { doc: opts.doc, assets: opts.assets, pageNumbers: !!opts.pageNumbers },
    );
    return await page.pdf({
      width: `${width}px`,
      height: `${height}px`,
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
      pageRanges: `1-${opts.doc.slides.length}`,
    });
  } finally {
    await browser.close();
  }
}
