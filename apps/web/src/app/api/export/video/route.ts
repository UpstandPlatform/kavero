import { parseCatalogDocument } from "@Kavero/catalog-engine";
import { z } from "zod";

import { MAX_ACTIVE_JOBS, activeJobs, publicJob, startVideoJob } from "@/modules/export/video-jobs";
import { canExport } from "@/modules/export/access";

export const runtime = "nodejs";

const bodySchema = z.object({
  document: z.unknown(),
  // Only data: URLs for images and fonts; nothing that makes the server fetch.
  assets: z.record(z.string(), z.string().regex(/^data:(image\/(png|jpe?g|gif|webp|avif|svg\+xml)|font\/(ttf|otf|woff2?));base64,/)).default({}),
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
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid export request." }, { status: 400 });

  // Same validation (and HTML sanitizing) as every other entry point.
  const doc = parseCatalogDocument(parsed.data.document);
  if (!doc.ok) return Response.json({ error: "Invalid catalog.", issues: doc.issues.slice(0, 5) }, { status: 400 });

  const { buildTimeline } = await import("@Kavero/animation-engine");
  if (buildTimeline(doc.document).totalMs > MAX_DURATION_MS) {
    return Response.json({ error: "Videos are limited to 10 minutes." }, { status: 400 });
  }

  const baseUrl = new URL(request.url).origin;
  const job = await startVideoJob({ doc: doc.document, assets: parsed.data.assets, baseUrl, fps: parsed.data.fps, height: parsed.data.height });
  return Response.json(publicJob(job), { status: 202 });
}
