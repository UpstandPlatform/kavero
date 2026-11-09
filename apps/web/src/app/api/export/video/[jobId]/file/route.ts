import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import { getJob } from "@/modules/export/video-jobs";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const job = getJob((await params).jobId);
  if (!job || job.status !== "done") return Response.json({ error: "Video not ready." }, { status: 404 });
  const name = job.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "catalog";
  return new Response(Readable.toWeb(createReadStream(job.file)) as ReadableStream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(job.bytes ?? ""),
      "Content-Disposition": `attachment; filename="${name}.mp4"`,
      "Cache-Control": "no-store",
    },
  });
}
