import { cancelJob, getJob, publicJob } from "@/modules/export/video-jobs";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const job = getJob((await params).jobId);
  if (!job) return Response.json({ error: "Export not found." }, { status: 404 });
  return Response.json(publicJob(job));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  return cancelJob((await params).jobId) ? new Response(null, { status: 204 }) : Response.json({ error: "Export not found." }, { status: 404 });
}
