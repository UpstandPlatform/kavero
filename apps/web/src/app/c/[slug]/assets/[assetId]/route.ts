import { cookies } from "next/headers";

import { publications, resolveAccess } from "@/modules/publishing/access";
import { objectStorage } from "@/modules/storage/object-storage";

export const runtime = "nodejs";

/** Files of a published catalog, with the same access rules as the page. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string; assetId: string }> }) {
  const { slug, assetId } = await params;
  const jar = await cookies();
  const access = await resolveAccess(slug, request.headers, (n) => jar.get(n)?.value);
  if (access.kind !== "ok") return new Response("Not found", { status: 404 });
  const asset = await publications().publicAsset(access.pub.id, assetId);
  if (!asset) return new Response("Not found", { status: 404 });
  const bytes = await (await objectStorage()).get(asset.storageKey);
  if (!bytes) return new Response("Not found", { status: 404 });
  const open = access.pub.visibility === "public" || access.pub.visibility === "unlisted";
  return new Response(new Blob([bytes as BlobPart], { type: asset.mimeType }), {
    headers: {
      "Cache-Control": open ? "public, max-age=3600, stale-while-revalidate=86400" : "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      // Fonts are fetched with CORS.
      ...(open ? { "Access-Control-Allow-Origin": "*" } : {}),
    },
  });
}
