import { AiCredentialService } from "@Kavero/api/services/ai-credential-service";
import { readLimited } from "@Kavero/api/services/safe-fetch";
import { SecretBox } from "@Kavero/api/services/secret-box";
import { z } from "zod";

import { ENV } from "@/env.server";
import { auth, db } from "@/services";
import { startMediaJob, publicMediaJob } from "@/modules/ai/media-jobs";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const schema = z.object({
  purpose: z.enum(["image", "video"]),
  prompt: z.string().trim().min(3).max(2000),
  aspectRatio: z.string().regex(/^[1-9]\d{0,4}:[1-9]\d{0,4}$/).refine((value) => value.split(":").every((part) => Number(part) <= 10_000)).default("16:9"),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  if (!session) return Response.json({ error: "Sign in to generate media." }, { status: 401 });
  let raw: unknown = null;
  if (Number(request.headers.get("content-length") ?? 0) > 8192) return Response.json({ error: "This generation request is too large." }, { status: 413 });
  try {
    raw = JSON.parse(new TextDecoder().decode(await readLimited(request.body, 8192, "This generation request is too large.")));
  } catch (error) {
    if (error instanceof Error && error.message === "This generation request is too large.") return Response.json({ error: error.message }, { status: 413 });
    // Validation below returns one consistent error for malformed JSON and empty bodies.
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "Enter a prompt and a supported aspect ratio." }, { status: 400 });
  try {
    const service = new AiCredentialService(db, new SecretBox(ENV.BETTER_AUTH_SECRET), { allowLocal: process.env.NODE_ENV !== "production", appUrl: ENV.BETTER_AUTH_URL });
    const connection = await service.mediaCredential(session.user.id, parsed.data.purpose);
    const job = await startMediaJob({ userId: session.user.id, ...parsed.data, ...connection });
    return Response.json(publicMediaJob(job), { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start media generation.";
    if (error instanceof Error && error.name === "MediaJobCapacityError") {
      return Response.json({ error: message }, { status: 429, headers: { "Retry-After": "30", "Cache-Control": "private, no-store" } });
    }
    if (error instanceof Error && error.name === "MediaJobRateLimitError") {
      return Response.json({ error: message }, { status: 429, headers: { "Retry-After": "60", "Cache-Control": "private, no-store" } });
    }
    const status = error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "PRECONDITION_FAILED" ? 412 : 400;
    return Response.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
}
