import type { CatalogDocument } from "@Kavero/catalog-engine";
import { renderSlideImage } from "@Kavero/export-chromium";

import { renderOrigin } from "@/modules/export/access";
import { publications } from "@/modules/publishing/access";
import { objectStorage } from "@/modules/storage/object-storage";

export const runtime = "nodejs";

const inFlight = new Map<string, Promise<Uint8Array | null>>();
/** Versions whose render failed recently (no Chrome, busy, broken slide): retry after this. */
const FAILURE_TTL_MS = 10 * 60_000;
const g = globalThis as unknown as { __kaveroOgFailures?: Map<string, number> };
const failedUntil = (g.__kaveroOgFailures ??= new Map());

/**
 * Social preview image (first slide) for public and unlisted catalogs.
 * Rendered once per published version with headless Chrome, then served from storage.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const service = publications();
  const pub = await service.findBySlug(slug);
  if (!pub || (pub.visibility !== "public" && pub.visibility !== "unlisted")) return new Response("Not found", { status: 404 });

  const storage = objectStorage();
  const key = `publications/${pub.id}/og-v${pub.version}.png`;
  let png = pub.ogImageKey === key ? await storage.get(key) : null;

  if (!png && (failedUntil.get(key) ?? 0) > Date.now()) return new Response("Preview unavailable", { status: 404 });
  if (!png) {
    let job = inFlight.get(key);
    if (!job) {
      job = (async () => {
        try {
          const doc = pub.document as CatalogDocument;
          // Inline the files the first slide may need as data URLs for the headless page.
          const assets: Record<string, string> = {};
          for (const a of doc.assets) {
            if (a.kind === "video") continue;
            const file = await service.publicAsset(pub.id, a.id);
            const bytes = file && (await storage.get(file.storageKey));
            if (bytes) assets[a.id] = `data:${file.mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
          }
          const image = await renderSlideImage({ doc, assets, baseUrl: renderOrigin(request) });
          await storage.put(key, image);
          await service.setOgImage(pub.id, pub.version, key);
          return image;
        } catch {
          // No Chrome, all slots busy or a broken slide: no preview, and don't relaunch Chrome on every request.
          for (const [k, until] of failedUntil) if (until <= Date.now()) failedUntil.delete(k);
          failedUntil.set(key, Date.now() + FAILURE_TTL_MS);
          return null;
        } finally {
          inFlight.delete(key);
        }
      })();
      inFlight.set(key, job);
    }
    png = await job;
  }
  if (!png) return new Response("Preview unavailable", { status: 404 });
  return new Response(new Blob([png as BlobPart], { type: "image/png" }), {
    headers: { "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" },
  });
}
