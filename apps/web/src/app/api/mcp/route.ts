import { createHash } from "node:crypto";

import { AiCredentialService } from "@Kavero/api/services/ai-credential-service";
import { CatalogService } from "@Kavero/api/services/catalog-service";
import { SecretBox } from "@Kavero/api/services/secret-box";
import { imageSize } from "@Kavero/api/services/image-size";
import { fetchImageAsDataUrl } from "@Kavero/api/services/safe-fetch";
import { TokenService, audit } from "@Kavero/api/services/token-service";
import { providerFromEnv, type AiEnv } from "@Kavero/ai";
import type { CatalogDocument } from "@Kavero/catalog-engine";
import { renderPdf, renderSlideImage } from "@Kavero/export-chromium";
import { createKaveroMcpServer } from "@Kavero/mcp-server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { renderOrigin } from "@/modules/export/access";
import { objectStorage } from "@/modules/storage/object-storage";
import { ENV } from "@/env.server";
import { db } from "@/services";

export const runtime = "nodejs";

const LIMIT_PER_MINUTE = 120;
const aiProvider = providerFromEnv(process.env as AiEnv);
const secretBox = new SecretBox(ENV.BETTER_AUTH_SECRET);
const hits = new Map<string, { n: number; resetAt: number }>();
function rateLimited(tokenId: string) {
  const now = Date.now();
  const h = hits.get(tokenId);
  if (!h || h.resetAt < now) {
    hits.set(tokenId, { n: 1, resetAt: now + 60_000 });
    return false;
  }
  h.n += 1;
  return h.n > LIMIT_PER_MINUTE;
}

const unauthorized = (message: string) =>
  Response.json({ jsonrpc: "2.0", error: { code: -32001, message }, id: null }, { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="kavero"' } });

/**
 * Kavero MCP server (Streamable HTTP, stateless JSON mode).
 * Authenticate with a personal access token: `Authorization: Bearer kv_...`.
 */
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return unauthorized("Missing bearer token. Create one in Kavero → Settings → API tokens.");
  const principal = await new TokenService(db).authenticate(token);
  if (!principal) return unauthorized("Invalid, expired or revoked token.");
  if (rateLimited(principal.tokenId)) {
    await audit(db, { userId: principal.userId, tokenId: principal.tokenId, action: "mcp:request", outcome: "denied", details: { reason: "rate-limit" } });
    return Response.json({ jsonrpc: "2.0", error: { code: -32002, message: "Rate limit exceeded; slow down." }, id: null }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const origin = new URL(request.url).origin;
  const catalogs = new CatalogService(db);
  /** Store image bytes for a cloud catalog; same bytes → same asset id (no duplicates). */
  const storeImage = async (catalogRowId: string, bytes: Uint8Array, mimeType: string) => {
    const hash = createHash("sha256").update(bytes).digest("hex");
    const assetId = `ast_${hash.slice(0, 16)}`;
    const storageKey = `catalogs/${catalogRowId}/${hash}`;
    await objectStorage().put(storageKey, bytes);
    await catalogs.recordAsset({ catalogId: catalogRowId, assetId, mimeType, bytes: bytes.byteLength, hash, storageKey });
    return { id: assetId, mimeType, bytes: bytes.byteLength, hash, ...(imageSize(bytes) ?? {}) };
  };
  /** The catalog's stored images and fonts as data: URLs (access-checked per file). */
  const loadAssets = async (doc: CatalogDocument) => {
    const assets: Record<string, string> = {};
    for (const a of doc.assets) {
      if (a.kind === "video") continue;
      const file = await catalogs.findAsset(principal.userId, doc.id, a.id);
      const bytes = file && (await objectStorage().get(file.storageKey));
      if (bytes) assets[a.id] = `data:${file.mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
    }
    return assets;
  };
  const server = createKaveroMcpServer({
    db,
    principal,
    host: {
      publicUrl: (slug) => `${origin}/c/${slug}`,
      editorUrl: (documentId) => `${origin}/editor/${encodeURIComponent(documentId)}`,
      importImage: async (catalogRowId, url) => {
        const dataUrl = await fetchImageAsDataUrl(url, { allowLocal: process.env.NODE_ENV !== "production" });
        const [, mimeType = "", b64 = ""] = /^data:([^;]+);base64,([A-Za-z0-9+/=]*)$/.exec(dataUrl) ?? [];
        return storeImage(catalogRowId, Uint8Array.from(Buffer.from(b64, "base64")), mimeType);
      },
      importImageData: async (catalogRowId, bytes, mimeType) => {
        if (bytes.byteLength > 15 * 1024 * 1024) throw new Error("Images must be under 15 MB");
        if (!imageSize(bytes)) throw new Error("That data isn't a PNG, JPEG, GIF or WebP image");
        return storeImage(catalogRowId, bytes, mimeType);
      },
      loadAssets,
      renderPreview: async (doc, slideIndex) => renderSlideImage({ doc, assets: await loadAssets(doc), baseUrl: renderOrigin(request), slideIndex, width: 1280 }),
      renderPdf: async (doc) => renderPdf({ doc, assets: await loadAssets(doc), baseUrl: renderOrigin(request) }),
      deleteObjects: async (keys) => {
        // Files are content-addressed per catalog, so these keys belong to the deleted catalog only.
        await Promise.all(keys.map((k) => objectStorage().delete(k)));
      },
      ai: (await new AiCredentialService(db, secretBox, { allowLocal: process.env.NODE_ENV !== "production", appUrl: ENV.BETTER_AUTH_URL }).provider(principal.userId).catch(() => null)) ?? aiProvider,
    },
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request, { authInfo: { token, clientId: principal.tokenId, scopes: principal.scopes } });
  } finally {
    void server.close();
  }
}

// Stateless server: no standalone SSE stream or sessions to delete.
const notAllowed = () => Response.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }, { status: 405, headers: { Allow: "POST" } });
export const GET = notAllowed;
export const DELETE = notAllowed;
