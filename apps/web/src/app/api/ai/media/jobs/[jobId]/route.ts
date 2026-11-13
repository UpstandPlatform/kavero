import { z } from "zod";

import { auth } from "@/services";
import { getMediaJob, publicMediaJob } from "@/modules/ai/media-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  if (!session) return Response.json({ error: "Sign in to retrieve this media job." }, { status: 401 });
  const { jobId } = await context.params;
  if (!z.string().uuid().safeParse(jobId).success) return Response.json({ error: "Media job not found." }, { status: 404 });
  const job = getMediaJob(jobId);
  if (!job || job.userId !== session.user.id) return Response.json({ error: "Media job not found." }, { status: 404 });
  return Response.json(publicMediaJob(job), { headers: { "Cache-Control": "private, no-store" } });
}
