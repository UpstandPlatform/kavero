import type { CatalogDocument } from "@Kavero/catalog-engine";

import { launchBrowser } from "./browser";
import { openRenderPage } from "./network";

/** PNG of one slide in its finished state, e.g. for social previews. */
export async function renderSlideImage(opts: { doc: CatalogDocument; assets: Record<string, string>; baseUrl: string; slideIndex?: number; width?: number }): Promise<Uint8Array> {
  const slide = opts.doc.slides[opts.slideIndex ?? 0];
  if (!slide) throw new Error("Slide not found");
  const doc: CatalogDocument = { ...opts.doc, slides: [{ ...slide, transition: undefined }] };
  const width = opts.width ?? 1200;
  const height = Math.round((width * doc.settings.height) / doc.settings.width);
  const browser = await launchBrowser();
  try {
    const page = await openRenderPage(browser, opts.baseUrl, { viewport: { width, height } });
    await page.waitForFunction(() => typeof (window as unknown as { __kaveroLoad?: unknown }).__kaveroLoad === "function", null, { timeout: 30_000 });
    await page.evaluate(async ({ doc, assets, scale }) => {
      const w = window as unknown as { __kaveroLoad: (d: unknown, a: unknown, s: number) => Promise<void>; __kaveroSeek: (t: number) => Promise<void> };
      await w.__kaveroLoad(doc, assets, scale);
      await w.__kaveroSeek(1e9);
    }, { doc, assets: opts.assets, scale: width / doc.settings.width });
    return await page.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}

/**
 * Every slide (or the chosen ones) as JPEG or PNG, in its finished state.
 * One browser and one page for the whole run.
 */
export async function renderSlideImages(opts: {
  doc: CatalogDocument;
  assets: Record<string, string>;
  baseUrl: string;
  width?: number;
  format?: "jpeg" | "png";
  /** JPEG quality, 1–100. */
  quality?: number;
  slideIndexes?: number[];
}): Promise<Uint8Array[]> {
  const width = opts.width ?? 1920;
  const height = Math.round((width * opts.doc.settings.height) / opts.doc.settings.width);
  const indexes = opts.slideIndexes ?? opts.doc.slides.map((_, i) => i);
  const format = opts.format ?? "jpeg";
  const browser = await launchBrowser();
  try {
    const page = await openRenderPage(browser, opts.baseUrl, { viewport: { width, height } });
    await page.waitForFunction(() => typeof (window as unknown as { __kaveroLoad?: unknown }).__kaveroLoad === "function", null, { timeout: 30_000 });
    const out: Uint8Array[] = [];
    for (const i of indexes) {
      const slide = opts.doc.slides[i];
      if (!slide) throw new Error(`Slide ${i + 1} not found`);
      const doc: CatalogDocument = { ...opts.doc, slides: [{ ...slide, transition: undefined }] };
      await page.evaluate(async ({ doc, assets, scale }) => {
        const w = window as unknown as { __kaveroLoad: (d: unknown, a: unknown, s: number) => Promise<void>; __kaveroSeek: (t: number) => Promise<void> };
        await w.__kaveroLoad(doc, assets, scale);
        await w.__kaveroSeek(1e9);
      }, { doc, assets: opts.assets, scale: width / doc.settings.width });
      out.push(await page.screenshot(format === "jpeg" ? { type: "jpeg", quality: Math.max(1, Math.min(100, opts.quality ?? 90)) } : { type: "png" }));
    }
    return out;
  } finally {
    await browser.close();
  }
}
