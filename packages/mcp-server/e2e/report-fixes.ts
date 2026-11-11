/**
 * Regression checks for the "Aban Gostar Alborz" catalog report: RTL layout,
 * Unicode export names, asset_import (URL + base64) with dimensions, editor links.
 * Needs the dev server (http://localhost:3001) and `bun e2e/fake-store.ts` (serves test images).
 * Run: `bun e2e/report-fixes.ts [preview.png]`
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = process.env.KAVERO_URL ?? "http://localhost:3001";
const results: [string, boolean, string?][] = [];
const check = (name: string, ok: unknown, info?: string) => results.push([name, !!ok, info]);

const r0 = await fetch(`${BASE}/api/auth/sign-up/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ email: `rtl-${crypto.randomUUID().slice(0, 8)}@example.test`, password: crypto.randomUUID(), name: "RTL" }) });
const cookie = r0.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const keyResponse = await (await fetch(`${BASE}/api/trpc/integrations.apiKeys.create`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie, Origin: BASE }, body: JSON.stringify({ name: "rtl", scopes: ["catalogs:read", "catalogs:write", "assets:write"], expiresInDays: 1 }) })).json() as { result: { data: { key: string } } };

const mcp = new Client({ name: "e2e", version: "1" });
await mcp.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), { requestInit: { headers: { Authorization: `Bearer ${keyResponse.result.data.key}` } } }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = async (name: string, args: Record<string, unknown>): Promise<any> => {
  const r = await mcp.callTool({ name, arguments: args });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content = r.content as any[];
  if (r.isError) throw new Error(`${name}: ${content[0]?.text}`);
  return content[0]?.type === "text" ? JSON.parse(content[0].text) : content;
};

const title = "کاتالوگ محصولات آبان گستر البرز";
const created = await call("catalog_create", { title, page: "a4-portrait", language: "fa", currency: "IRR" });
check("editorUrl in catalog_create", typeof created.editorUrl === "string" && created.editorUrl.includes("/editor/cat_"), created.editorUrl);
const id = created.catalogId as string;
await call("catalog_apply_theme", { catalogId: id, fonts: { heading: "Vazirmatn", body: "Vazirmatn" } });

// asset_import: URL and base64
const fromUrl = await call("asset_import", { catalogId: id, url: "http://127.0.0.1:4555/img/8B5A2B.png", name: "کاور" });
check("asset_import from URL with size", fromUrl.assetId && fromUrl.width === 64 && fromUrl.height === 64, JSON.stringify(fromUrl));
const png1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const fromData = await call("asset_import", { catalogId: id, data: png1x1, mimeType: "image/png", name: "logo" });
check("asset_import from base64 with size", fromData.assetId && fromData.width === 1, JSON.stringify(fromData));
const again = await call("asset_import", { catalogId: id, data: png1x1, mimeType: "image/png", name: "logo" });
check("same image isn't duplicated", again.alreadyPresent === true && again.assetId === fromData.assetId);
const bad = await mcp.callTool({ name: "asset_import", arguments: { catalogId: id, data: "aGVsbG8=", mimeType: "image/png", name: "x" } });
check("non-image data refused", bad.isError);

// RTL slide: cover background image + mixed Persian/Latin text + LTR phone
const outline = await call("catalog_get", { catalogId: id });
const slideId = outline.slides[0].id;
await call("slide_update", { catalogId: id, slideId, background: { kind: "image", assetId: fromUrl.assetId } });
const added = await call("slide_add_element", { catalogId: id, slideId, elements: [
  { type: "shape", position: { x: 0, y: 0, width: 794, height: 1123 }, content: { shape: "rect" }, style: { fill: "#ffffff" }, opacity: 0.85 },
  { type: "text", position: { x: 56, y: 200, width: 682, height: 80 }, content: { paragraphs: [[{ text: "شیر توپی پی‌وی‌سی (UPVC)" }]] }, style: { fontSize: 40, fontWeight: 800, fontFamily: "token:heading" } },
  { type: "text", position: { x: 56, y: 320, width: 682, height: 50 }, content: { paragraphs: [[{ text: "۰۹۱۲ ۰۵۶ ۱۸۱۰" }]] }, style: { fontSize: 28, direction: "ltr" } },
] });
check("elements added", added.createdIds.length === 3);
const full = (await call("catalog_get", { catalogId: id, full: true })).document;
const heading = full.slides[0].elements.find((e: { id: string }) => e.id === added.createdIds[1]);
check("default alignment is start", heading.style.align === "start" && heading.style.direction === "auto");
check("no bidi control characters stored", !/[‪-‮⁦-⁩]/.test(JSON.stringify(full)));

const preview = await mcp.callTool({ name: "catalog_preview", arguments: { catalogId: id, slideIndex: 0 } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const img = (preview.content as any[]).find((c) => c.type === "image");
check("RTL preview renders", img?.data, JSON.stringify(preview.content).slice(0, 400));
if (img?.data && process.argv[2]) await Bun.write(process.argv[2], Buffer.from(img.data, "base64"));

// Export names keep Persian
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pptx: any = await mcp.callTool({ name: "catalog_export_pptx", arguments: { catalogId: id } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const res = pptx.content.find((c: any) => c.type === "resource");
check("export file name keeps Persian", decodeURIComponent(res.resource.uri).endsWith("کاتالوگ-محصولات-آبان-گستر-البرز.pptx"), res.resource.uri);

// Editor link pulls cloud-only catalogs (served page loads; the client then fetches it)
check("editorUrl page loads", (await fetch(created.editorUrl, { headers: { Cookie: cookie } })).status === 200);
await mcp.close();

for (const [name, ok, info] of results) console.log(ok ? "PASS" : "FAIL", name, ok ? "" : (info ?? ""));
console.log(`${results.filter((x) => x[1]).length}/${results.length} passed`);
process.exit(results.every((x) => x[1]) ? 0 : 1);
