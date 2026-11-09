import { attachmentHeader, parseCatalogDocument, safeFileName } from "@Kavero/catalog-engine";
import { renderPdf } from "@Kavero/export-chromium";
import { z } from "zod";

import { canExport, exportAssetsSchema, exportFailed, readExportBody, renderOrigin } from "@/modules/export/access";

export const runtime = "nodejs";

const bodySchema = z.object({
  document: z.unknown(),
  assets: exportAssetsSchema,
  pageNumbers: z.boolean().default(false),
});

/** Renders a print-ready PDF (one page per slide) with headless Chrome. */
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
  if (!doc.document.slides.length) return Response.json({ error: "This catalog has no slides." }, { status: 400 });
  if (doc.document.slides.length > 500) return Response.json({ error: "PDFs are limited to 500 pages." }, { status: 400 });

  try {
    const pdf = await renderPdf({ doc: doc.document, assets: parsed.data.assets, baseUrl: renderOrigin(request), pageNumbers: parsed.data.pageNumbers });
    return new Response(new Blob([pdf as BlobPart], { type: "application/pdf" }), {
      headers: { "Content-Disposition": attachmentHeader(safeFileName(doc.document.metadata.title, "pdf")), "Cache-Control": "no-store" },
    });
  } catch (e) {
    return exportFailed(e, "PDF export");
  }
}
