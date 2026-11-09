import { parseCatalogDocument } from "@Kavero/catalog-engine";
import { renderPdf } from "@Kavero/export-chromium";
import { z } from "zod";

import { canExport } from "@/modules/export/access";

export const runtime = "nodejs";

const bodySchema = z.object({
  document: z.unknown(),
  assets: z.record(z.string(), z.string().regex(/^data:(image\/(png|jpe?g|gif|webp|avif|svg\+xml)|font\/(ttf|otf|woff2?));base64,/)).default({}),
  pageNumbers: z.boolean().default(false),
});

/** Renders a print-ready PDF (one page per slide) with headless Chrome. */
export async function POST(request: Request) {
  if (!(await canExport(request))) {
    return Response.json({ error: "Sign in to export from a hosted server." }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid export request." }, { status: 400 });
  const doc = parseCatalogDocument(parsed.data.document);
  if (!doc.ok) return Response.json({ error: "Invalid catalog.", issues: doc.issues.slice(0, 5) }, { status: 400 });
  if (doc.document.slides.length > 500) return Response.json({ error: "PDFs are limited to 500 pages." }, { status: 400 });

  try {
    const pdf = await renderPdf({ doc: doc.document, assets: parsed.data.assets, baseUrl: new URL(request.url).origin, pageNumbers: parsed.data.pageNumbers });
    const name = doc.document.metadata.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "catalog";
    return new Response(new Blob([pdf as BlobPart], { type: "application/pdf" }), {
      headers: { "Content-Disposition": `attachment; filename="${name}.pdf"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    return Response.json({ error: `PDF export failed: ${(e as Error).message}` }, { status: 500 });
  }
}
