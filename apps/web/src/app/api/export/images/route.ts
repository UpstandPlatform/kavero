import { attachmentHeader, parseCatalogDocument, safeFileName } from "@Kavero/catalog-engine";
import { renderSlideImages } from "@Kavero/export-chromium";
import { zipSync } from "fflate";
import { z } from "zod";

import { auditExport, canExport, exportAssetsSchema, exportFailed, readExportBody, renderOrigin } from "@/modules/export/access";

export const runtime = "nodejs";

const MAX_SLIDES = 200;

const bodySchema = z.object({
  document: z.unknown(),
  assets: exportAssetsSchema,
  /** Image width in pixels; height follows the page size. */
  width: z.union([z.literal(1280), z.literal(1920), z.literal(2560), z.literal(3840)]).default(1920),
  quality: z.number().int().min(40).max(100).default(90),
});

/** Every slide as a JPEG, in one .zip (01-cover.jpg, 02-…). */
export async function POST(request: Request) {
  if (!(await canExport(request))) {
    return Response.json({ error: "Sign in to export from a hosted server." }, { status: 401 });
  }
  const read = await readExportBody(request);
  if ("error" in read) return read.error;
  const parsed = bodySchema.safeParse(read.body);
  if (!parsed.success) return Response.json({ error: "Invalid export request." }, { status: 400 });
  const doc = parseCatalogDocument(parsed.data.document);
  if (!doc.ok) return Response.json({ error: "Invalid catalog.", issues: doc.issues.slice(0, 5) }, { status: 400 });
  const { slides } = doc.document;
  if (!slides.length) return Response.json({ error: "This catalog has no slides." }, { status: 400 });
  if (slides.length > MAX_SLIDES) return Response.json({ error: `Image exports are limited to ${MAX_SLIDES} slides.` }, { status: 400 });

  try {
    const images = await renderSlideImages({
      doc: doc.document,
      assets: parsed.data.assets,
      baseUrl: renderOrigin(request),
      width: parsed.data.width,
      quality: parsed.data.quality,
    });
    const pad = String(slides.length).length;
    const used = new Set<string>();
    const files: Record<string, [Uint8Array, { level: 0 }]> = {};
    images.forEach((bytes, i) => {
      // "03-summer-shoes.jpg"; JPEGs are already compressed, so store without deflate.
      let name = `${String(i + 1).padStart(Math.max(2, pad), "0")}-${safeFileName(slides[i]!.name || `slide-${i + 1}`, "jpg")}`;
      while (used.has(name)) name = name.replace(/\.jpg$/, "-1.jpg");
      used.add(name);
      files[name] = [bytes, { level: 0 }];
    });
    const zip = zipSync(files);
    await auditExport(request, "images", doc.document.metadata.title, "ok", { slides: slides.length, width: parsed.data.width });
    return new Response(new Blob([zip as BlobPart], { type: "application/zip" }), {
      headers: { "Content-Disposition": attachmentHeader(safeFileName(doc.document.metadata.title, "zip")), "Cache-Control": "no-store" },
    });
  } catch (e) {
    await auditExport(request, "images", doc.document.metadata.title, "error", { slides: slides.length });
    return exportFailed(e, "Image export");
  }
}
