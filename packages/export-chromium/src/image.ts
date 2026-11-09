import type { CatalogDocument } from "@Kavero/catalog-engine";

import { launchBrowser } from "./browser";

/** PNG of one slide in its finished state, e.g. for social previews. */
export async function renderSlideImage(opts: { doc: CatalogDocument; assets: Record<string, string>; baseUrl: string; slideIndex?: number; width?: number }): Promise<Uint8Array> {
  const slide = opts.doc.slides[opts.slideIndex ?? 0];
  if (!slide) throw new Error("Slide not found");
  const doc: CatalogDocument = { ...opts.doc, slides: [{ ...slide, transition: undefined }] };
  const width = opts.width ?? 1200;
  const height = Math.round((width * doc.settings.height) / doc.settings.width);
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`${opts.baseUrl}/render`, { waitUntil: "networkidle" });
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
