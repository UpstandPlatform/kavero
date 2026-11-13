import { readLimited } from "@Kavero/api/services/safe-fetch";
import { audit } from "@Kavero/api/services/audit-service";
import { BrowserBusyError } from "@Kavero/export-chromium";
import { z } from "zod";

import { auth, db } from "@/services";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Video export launches Chrome on the server. Allow it for a local Kavero
 * (local-first, no account needed) or for signed-in users on a hosted server.
 */
export async function canExport(request: Request): Promise<boolean> {
  const host = new URL(request.url).hostname;
  if (LOCAL_HOSTS.has(host) && process.env.NODE_ENV !== "production") return true;
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    return !!session?.user;
  } catch {
    return false;
  }
}

/** Record authenticated export attempts without retaining the exported document or its assets. */
export async function auditExport(request: Request, kind: "pdf" | "images" | "video", target: string, outcome: "ok" | "error", details?: unknown) {
  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  if (!session) return;
  await audit(db, { userId: session.user.id, area: "exports", channel: "web", action: `export:${kind}`, target, outcome, details });
}

/**
 * Origin headless Chrome loads /render from. Never derived from the request:
 * the Host header is client-controlled and would let a caller aim Chrome at
 * another host. KAVERO_RENDER_URL overrides it, e.g. an internal address.
 */
export function renderOrigin(request: Request): string {
  const configured = process.env.KAVERO_RENDER_URL || process.env.BETTER_AUTH_URL;
  return new URL(configured || request.url).origin;
}

/** Export requests carry the document plus its media/fonts as data: URLs. */
export const MAX_EXPORT_BODY_BYTES = 60 * 1024 * 1024;

/** Only data: URLs for supported images, MP4/WebM video and fonts; nothing makes the server fetch. */
export const exportAssetsSchema = z
  .record(z.string(), z.string().regex(/^data:(image\/(png|jpe?g|gif|webp|avif|svg\+xml)|video\/(mp4|webm)|font\/(ttf|otf|woff2?));base64,/))
  .refine((a) => Object.values(a).reduce((n, v) => n + v.length, 0) <= MAX_EXPORT_BODY_BYTES, { message: "Files are too large to export" })
  .default({});

/** The JSON body, or an error Response when it is too large or not JSON. Never buffers past the limit. */
export async function readExportBody(request: Request): Promise<{ body: unknown } | { error: Response }> {
  const tooLarge = () => ({ error: Response.json({ error: "This catalog is too large to export here (60 MB limit including media)." }, { status: 413 }) });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_EXPORT_BODY_BYTES) return tooLarge();
  let bytes: Uint8Array;
  try {
    bytes = await readLimited(request.body, MAX_EXPORT_BODY_BYTES);
  } catch {
    return tooLarge();
  }
  try {
    return { body: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { body: null };
  }
}

/** 503 when every Chrome slot is busy, otherwise a 500 with the reason. */
export function exportFailed(e: unknown, what: string): Response {
  // By name too: route bundles may each load their own copy of the class.
  if (e instanceof BrowserBusyError || (e as Error)?.name === "BrowserBusyError") return Response.json({ error: (e as Error).message }, { status: 503, headers: { "Retry-After": "30" } });
  return Response.json({ error: `${what} failed: ${(e as Error).message}` }, { status: 500 });
}
