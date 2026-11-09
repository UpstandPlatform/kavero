import { createHash } from "node:crypto";

import { CatalogService } from "@Kavero/api/services/catalog-service";
import { readLimited } from "@Kavero/api/services/safe-fetch";

import { db, auth } from "@/services";
import { objectStorage } from "@/modules/storage/object-storage";

export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED = /^(image\/(png|jpe?g|gif|webp|avif|svg\+xml)|font\/(ttf|otf|woff2?)|video\/(mp4|webm))$/;

type Ctx = { params: Promise<{ id: string; assetId: string }> };

async function userId(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user.id ?? null;
}

/** Upload the bytes for an asset the cloud document already references. */
export async function PUT(request: Request, { params }: Ctx) {
  const uid = await userId(request);
  if (!uid) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id, assetId } = await params;
  const service = new CatalogService(db);
  const target = await service.assetTarget(uid, id, assetId);
  if (!target) return Response.json({ error: "Catalog not found" }, { status: 404 });
  if (!target.asset) return Response.json({ error: "Save the catalog before uploading its files" }, { status: 409 });

  const type = (request.headers.get("content-type") ?? "").split(";")[0]!.trim();
  if (!ALLOWED.test(type) || type !== target.asset.mimeType) return Response.json({ error: "Unsupported file type" }, { status: 415 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) return Response.json({ error: "File too large" }, { status: 413 });

  // Streamed with a running total, so a body without Content-Length can't make us buffer more than the limit.
  let bytes: Uint8Array;
  try {
    bytes = await readLimited(request.body, MAX_BYTES);
  } catch {
    return Response.json({ error: "File too large" }, { status: 413 });
  }
  const hash = createHash("sha256").update(bytes).digest("hex");
  const storageKey = `catalogs/${target.catalogId}/${hash}`;
  await objectStorage().put(storageKey, bytes);
  await service.recordAsset({ catalogId: target.catalogId, assetId, mimeType: type, bytes: bytes.byteLength, hash, storageKey });
  return Response.json({ assetId, hash, bytes: bytes.byteLength });
}

/** Download an asset of one of the user's cloud catalogs. */
export async function GET(request: Request, { params }: Ctx) {
  const uid = await userId(request);
  if (!uid) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id, assetId } = await params;
  const asset = await new CatalogService(db).findAsset(uid, id, assetId);
  if (!asset) return Response.json({ error: "Not found" }, { status: 404 });
  const bytes = await objectStorage().get(asset.storageKey);
  if (!bytes) return Response.json({ error: "File missing from storage" }, { status: 404 });
  return new Response(new Blob([bytes as BlobPart], { type: asset.mimeType }), {
    headers: {
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      // SVGs could carry scripts; never render them as a document from this origin.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
