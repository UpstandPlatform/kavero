/**
 * Scenario C end-to-end: an AI agent reads products from an external MCP
 * server and builds, previews and publishes a catalog through Kavero's MCP
 * server. Also checks permissions, auditing, the in-app connection flow and
 * SSRF protection.
 *
 * Needs: Kavero dev server (http://localhost:3001) with its database, and
 * `bun e2e/fake-store.ts` running. Run: `bun e2e/scenario-c.ts [preview.png]`.
 * Creates throwaway test accounts in the local database.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = process.env.KAVERO_URL ?? "http://localhost:3001";
const STORE = "http://127.0.0.1:4555/mcp";
const results: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, info?: string) => results.push([name, ok, info]);

async function signUp() {
  const r = await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email: `agent-${crypto.randomUUID().slice(0, 8)}@example.test`, password: crypto.randomUUID(), name: "Agent Owner" }),
  });
  if (!r.ok) throw new Error(`sign-up ${r.status}`);
  return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
async function trpc(cookie: string, path: string, input: unknown, mutation = false) {
  const url = mutation ? `${BASE}/api/trpc/${path}` : `${BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`;
  const r = await fetch(url, { method: mutation ? "POST" : "GET", headers: { "Content-Type": "application/json", Cookie: cookie, Origin: BASE }, body: mutation ? JSON.stringify(input) : undefined });
  const body = (await r.json()) as { result?: { data?: any }; error?: any };
  return { data: body.result?.data, error: body.error };
}
async function mcp(url: string, headers: Record<string, string>) {
  const client = new Client({ name: "e2e-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
  return client;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (r: unknown): any => JSON.parse(((r as { content: { text: string }[] }).content)[0]!.text);

const cookie = await signUp();
const full = (await trpc(cookie, "integrations.tokens.create", { name: "Agent", scopes: ["catalogs:read", "catalogs:write", "catalogs:delete", "publish"], expiresInDays: 1 }, true)).data;
const readOnly = (await trpc(cookie, "integrations.tokens.create", { name: "Reader", scopes: ["catalogs:read"], expiresInDays: 1 }, true)).data;
check("tokens created (shown once)", full?.token?.startsWith("kv_") && readOnly?.token?.startsWith("kv_"));

// --- Auth failures ---
let r401 = await fetch(`${BASE}/api/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
check("no token → 401", r401.status === 401);
r401 = await fetch(`${BASE}/api/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: "Bearer kv_nope" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
check("bad token → 401", r401.status === 401);

// --- The agent reads products from the store's MCP server ---
const store = await mcp(STORE, { "X-API-Key": "store-key-123" });
const storeData = json(await store.callTool({ name: "list_products", arguments: { first: 24 } }));
const storeProducts = storeData.data.products.edges.map((e: { node: Record<string, any> }) => ({
  id: e.node.id.split("/").pop(), name: e.node.title, description: e.node.description.replace(/<[^>]+>/g, ""),
  price: Number(e.node.priceRange.minVariantPrice.amount), currency: e.node.priceRange.minVariantPrice.currencyCode, category: e.node.productType,
  imageUrl: e.node.featuredImage.url,
}));
await store.close();
check("agent fetched store products", storeProducts.length === 6);

// --- …and builds a catalog in Kavero over MCP ---
const kavero = await mcp(`${BASE}/api/mcp`, { Authorization: `Bearer ${full.token}` });
const tools = (await kavero.listTools()).tools.map((t) => t.name);
check("Kavero exposes 20 tools", tools.length === 20, tools.join(","));

const created = json(await kavero.callTool({ name: "catalog_create", arguments: { title: "Leather Goods 2027", template: "dark-luxury", page: "16:9", currency: "EUR" } }));
check("catalog_create", !!created.catalogId && created.slideIds.length === 4);
const catalogId = created.catalogId as string;

const imported = json(await kavero.callTool({ name: "catalog_import_products", arguments: { catalogId, products: storeProducts, addSlides: "per-category", source: "fake-store" } }));
check("catalog_import_products (per-category slides)", imported.productIds.length === 6);
check("product images downloaded and stored", imported.imagesImported === 6, JSON.stringify(imported.warnings));

let outline = json(await kavero.callTool({ name: "catalog_get", arguments: { catalogId } }));
check("outline shows 3 category slides added", outline.slides.length === 7 && outline.products.length === 6, `${outline.slides.length} slides`);

const cover = outline.slides[0];
const added = json(await kavero.callTool({ name: "slide_add_element", arguments: { catalogId, slideId: cover.id, elements: [{ type: "text", position: { x: 80, y: 860, width: 900, height: 80 }, content: { paragraphs: [[{ text: "Made by hand in Florence" }]] }, style: { fontSize: 36, color: "token:primary" } }] } }));
check("slide_add_element", added.createdIds.length === 1);
const anim = await kavero.callTool({ name: "catalog_animate_element", arguments: { catalogId, elementId: added.createdIds[0], category: "entrance", preset: "slide", direction: "up", durationMs: 800 } });
check("catalog_animate_element", !anim.isError);
const tr = await kavero.callTool({ name: "catalog_set_transition", arguments: { catalogId, slideId: outline.slides[4].id, type: "push", direction: "left" } });
check("catalog_set_transition", !tr.isError);
const upd = await kavero.callTool({ name: "slide_update_element", arguments: { catalogId, elementId: added.createdIds[0], changes: { style: { fontSize: 40 }, position: { x: 96 } } } });
check("slide_update_element", !upd.isError);
const bad = await kavero.callTool({ name: "slide_update_element", arguments: { catalogId, elementId: added.createdIds[0], changes: { opacity: 7 } } });
check("invalid edit rejected by schema", !!bad.isError);

const preview = await kavero.callTool({ name: "catalog_preview", arguments: { catalogId, slideIndex: 4 } });
const img = (preview.content as { type: string; data?: string }[]).find((c) => c.type === "image");
check("catalog_preview returns PNG", !!img?.data && Buffer.from(img.data, "base64").subarray(1, 4).toString() === "PNG");
if (img?.data && process.argv[2]) await Bun.write(process.argv[2], Buffer.from(img.data, "base64"));

const published = json(await kavero.callTool({ name: "catalog_publish", arguments: { catalogId, visibility: "unlisted" } }));
const site = await fetch(published.url);
check("catalog_publish → live URL", site.status === 200 && (await site.text()).includes("Leather Goods 2027"), published.url);

const noConfirm = await kavero.callTool({ name: "catalog_delete", arguments: { catalogId } });
check("delete without confirm refused", !!noConfirm.isError);
await kavero.close();

// --- Least privilege ---
const reader = await mcp(`${BASE}/api/mcp`, { Authorization: `Bearer ${readOnly.token}` });
check("read-only token can read", !(await reader.callTool({ name: "catalog_list", arguments: {} })).isError);
const denied = await reader.callTool({ name: "catalog_create", arguments: { title: "Nope" } });
check("read-only token can't write", !!denied.isError && JSON.stringify(denied.content).includes("catalogs:write"));
await reader.close();

// --- Audit log ---
const auditRows = (await trpc(cookie, "integrations.audit", null)).data as { action: string; outcome: string }[];
check("audit log records calls and denials", auditRows.some((a) => a.action === "mcp:catalog_publish" && a.outcome === "ok") && auditRows.some((a) => a.action === "mcp:catalog_create" && a.outcome === "denied"));

// --- In-app connection flow (what the editor's Import products dialog uses) ---
const conn = (await trpc(cookie, "integrations.connections.create", { name: "Fake store", url: STORE, transport: "streamable-http", authType: "header", authHeader: "X-API-Key", secret: "store-key-123" }, true)).data;
check("connection created and tools discovered", conn?.status === "ok" && conn.tools.some((t: { name: string }) => t.name === "list_products"), JSON.stringify(conn).slice(0, 200));
const list = (await trpc(cookie, "integrations.connections.list", null)).data;
check("stored secret never returned", list?.[0]?.hasSecret === true && !JSON.stringify(list).includes("store-key-123"));
const extracted = (await trpc(cookie, "integrations.connections.importProducts", { id: conn.id, tool: "list_products", args: { productType: "Bags" } }, true)).data;
check("import extracts products (filtered)", extracted?.products.length === 2 && extracted.products[0].price === 640 && extracted.products[0].imageUrl?.includes("/img/"));
const images = (await trpc(cookie, "integrations.fetchImages", { urls: [extracted.products[0].imageUrl] }, true)).data;
check("product image downloaded", images?.[0]?.dataUrl?.startsWith("data:image/png;base64,"));
const ssrf = (await trpc(cookie, "integrations.fetchImages", { urls: ["http://169.254.169.254/latest/meta-data/", "http://10.0.0.1/x.png"] }, true)).data;
check("SSRF: metadata + LAN blocked", ssrf?.every((x: { error?: string }) => x.error?.includes("private")));
const evil = await trpc(cookie, "integrations.connections.create", { name: "x", url: "http://169.254.169.254/mcp" }, true);
check("SSRF: connection to metadata refused", !!evil.error);
const wrongKey = (await trpc(cookie, "integrations.connections.create", { name: "Wrong key", url: STORE, authType: "header", authHeader: "X-API-Key", secret: "nope" }, true)).data;
check("bad credentials reported, not thrown", wrongKey?.status === "error");

for (const [name, ok, info] of results) console.log(ok ? "PASS" : "FAIL", name, ok ? "" : (info ?? ""));
console.log(`${results.filter((x) => x[1]).length}/${results.length} passed`);
process.exit(results.every((x) => x[1]) ? 0 : 1);
