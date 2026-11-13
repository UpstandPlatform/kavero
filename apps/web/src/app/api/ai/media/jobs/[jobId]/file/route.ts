import { z } from "zod";

import { auth } from "@/services";
import { getMediaJob, mediaJobFile, readMediaFile } from "@/modules/ai/media-jobs";

export const runtime = "nodejs";
export const maxDuration = 150;
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  if (!session) return Response.json({ error: "Sign in to retrieve this media file." }, { status: 401 });
  const { jobId } = await context.params;
  if (!z.string().uuid().safeParse(jobId).success) return Response.json({ error: "Media job not found." }, { status: 404 });
  const job = getMediaJob(jobId);
  if (!job || job.userId !== session.user.id) return Response.json({ error: "Media job not found." }, { status: 404 });
  const requestedFormat = new URL(request.url).searchParams.get("format");
  const format = requestedFormat === "gif" || requestedFormat === "poster" ? requestedFormat : "original";
  try {
    const file = await mediaJobFile(job, format);
    const data = await readMediaFile(file.file);
    if (data.byteLength > 25 * 1024 * 1024) return Response.json({ error: "This result exceeds the 25 MB asset limit." }, { status: 413 });
    const extension = format === "gif" ? "gif" : file.mimeType === "image/svg+xml" ? "svg" : file.mimeType.split("/")[1] ?? "bin";
    return new Response(data, { headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.bytes),
      "Content-Disposition": `inline; filename="generated-${format === "poster" ? "poster" : job.purpose}.${extension}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The media file could not be retrieved." }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
  }
}
