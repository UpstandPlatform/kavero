import { parseCatalogDocument } from "@Kavero/catalog-engine";
import { z } from "zod";

import { MAX_ACTIVE_JOBS, activeJobs, publicJob, startVideoJob } from "@/modules/export/video-jobs";
import { auditExport, canExport, exportAssetsSchema, readExportBody, renderOrigin } from "@/modules/export/access";

export const runtime = "nodejs";

const bodySchema = z.object({
  document: z.unknown(),
  // Only data: URLs for media and fonts; nothing that makes the server fetch.
  assets: exportAssetsSchema,
  fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]).default(30),
  height: z.union([z.literal(480), z.literal(720), z.literal(1080), z.literal(1440), z.literal(2160)]).default(1080),
});

const MAX_DURATION_MS = 10 * 60 * 1000;

export async function POST(request: Request) {
  if (!(await canExport(request))) {
    return Response.json({ error: "Sign in to export video from a hosted server." }, { status: 401 });
  }
  if (activeJobs() >= MAX_ACTIVE_JOBS) {
    return Response.json({ error: "Too many exports are running. Try again shortly." }, { status: 429 });
  }
  const read = await readExportBody(request);
  if ("error" in read) return read.error;
  const parsed = bodySchema.safeParse(read.body);
  if (!parsed.success) return Response.json({ error: "Invalid export request." }, { status: 400 });

  // Same validation (and HTML sanitizing) as every other entry point.
  const doc = parseCatalogDocument(parsed.data.document);
  if (!doc.ok) return Response.json({ error: "Invalid catalog.", issues: doc.issues.slice(0, 5) }, { status: 400 });

  if (!doc.document.slides.length) return Response.json({ error: "This catalog has no slides." }, { status: 400 });
  if (doc.document.slides.some((slide) => slide.elements.some((element) => element.type === "video" && !element.content.assetId && !!element.content.url))) {
    return Response.json({ error: "MP4 export needs videos stored in this catalog. Upload linked videos before exporting." }, { status: 400 });
  }

  const { buildTimeline } = await import("@Kavero/animation-engine");
  if (buildTimeline(doc.document).totalMs > MAX_DURATION_MS) {
    return Response.json({ error: "Videos are limited to 10 minutes." }, { status: 400 });
  }

  const baseUrl = renderOrigin(request);
  let job;
  try {
    job = await startVideoJob({ doc: doc.document, assets: parsed.data.assets, baseUrl, fps: parsed.data.fps, height: parsed.data.height });
    await auditExport(request, "video", doc.document.metadata.title, "ok", { jobId: job.id, fps: parsed.data.fps, height: parsed.data.height });
  } catch (error) {
    await auditExport(request, "video", doc.document.metadata.title, "error", { fps: parsed.data.fps, height: parsed.data.height });
    return Response.json({ error: `Video export failed: ${(error as Error).message}` }, { status: 500 });
  }
  return Response.json(publicJob(job), { status: 202 });
}
