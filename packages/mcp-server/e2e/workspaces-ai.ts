/**
 * End-to-end: workspaces & roles, AI generation (offline planner when no model
 * is configured), MCP catalog_generate / exports, and view analytics.
 *
 * Needs the Kavero dev server (http://localhost:3001) with its database.
 * Creates throwaway test accounts in the local database.
 * Run: `bun e2e/workspaces-ai.ts`
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = process.env.KAVERO_URL ?? "http://localhost:3001";
const results: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, info?: string) => results.push([name, !!ok, info]);

async function signUp(tag: string) {
  const email = `${tag}-${crypto.randomUUID().slice(0, 8)}@example.test`;
  const r = await fetch(`${BASE}/api/auth/sign-up/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ email, password: crypto.randomUUID(), name: tag }) });
  if (!r.ok) throw new Error(`sign-up ${r.status}`);
  return { email, cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function trpc(cookie: string, path: string, input: unknown, mutation = false): Promise<{ data?: any; error?: any }> {
  const url = mutation ? `${BASE}/api/trpc/${path}` : `${BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`;
  const r = await fetch(url, { method: mutation ? "POST" : "GET", headers: { "Content-Type": "application/json", Cookie: cookie, Origin: BASE }, body: mutation ? JSON.stringify(input) : undefined });
  const body = (await r.json()) as { result?: { data?: unknown }; error?: unknown };
  return { data: body.result?.data, error: body.error };
}
const code = (r: { error?: { data?: { code?: string } } }) => r.error?.data?.code;

const owner = await signUp("owner");
const editor = await signUp("editor");
const viewer = await signUp("viewer");
const outsider = await signUp("outsider");

// ---------- Workspaces ----------
const ws = (await trpc(owner.cookie, "workspace.create", { name: "Marketing" }, true)).data;
check("workspace created", !!ws?.id);
const inviteEditor = (await trpc(owner.cookie, "workspace.invite", { workspaceId: ws.id, email: editor.email, role: "editor" }, true)).data;
const inviteViewer = (await trpc(owner.cookie, "workspace.invite", { workspaceId: ws.id, email: viewer.email, role: "viewer" }, true)).data;
check("invites created", !!inviteEditor?.token && !!inviteViewer?.token);
check("invite preview is public", (await trpc("", "workspace.previewInvite", { token: inviteEditor.token })).data?.workspaceName === "Marketing");
check("wrong account can't accept", code(await trpc(outsider.cookie, "workspace.acceptInvite", { token: inviteEditor.token }, true)) === "FORBIDDEN");
check("editor accepts", !!(await trpc(editor.cookie, "workspace.acceptInvite", { token: inviteEditor.token }, true)).data?.workspaceId);
check("viewer accepts", !!(await trpc(viewer.cookie, "workspace.acceptInvite", { token: inviteViewer.token }, true)).data?.workspaceId);
check("invite is single-use", code(await trpc(editor.cookie, "workspace.acceptInvite", { token: inviteEditor.token }, true)) === "NOT_FOUND");
check("editor can't invite", code(await trpc(editor.cookie, "workspace.invite", { workspaceId: ws.id, email: "x@example.test", role: "viewer" }, true)) === "FORBIDDEN");
check("last owner can't leave", code(await trpc(owner.cookie, "workspace.removeMember", { workspaceId: ws.id, userId: (await trpc(owner.cookie, "workspace.members", { workspaceId: ws.id })).data.members.find((m: { email: string }) => m.email === owner.email).userId }, true)) === "BAD_REQUEST");

// ---------- AI generation (into the workspace) ----------
const products = [
  { id: "p1", name: "Weekender Bag", price: 640, currency: "EUR", category: "Bags", imageAssetIds: [], attributes: {} },
  { id: "p2", name: "Tote", price: 320, category: "Bags", imageAssetIds: [], attributes: {} },
  { id: "p3", name: "Card Holder", price: 85, category: "Small leather goods", imageAssetIds: [], attributes: {} },
  { id: "p4", name: "Belt", price: 120, category: "Accessories", imageAssetIds: [], attributes: {} },
];
const status = (await trpc(owner.cookie, "ai.status", null)).data;
check("ai.status answers", typeof status?.configured === "boolean");
const gen = (await trpc(editor.cookie, "ai.generate", { brief: "Autumn leather goods lookbook for wholesale buyers", products, page: "16:9", currency: "EUR" }, true)).data;
check("ai.generate builds a catalog", gen?.document?.slides?.length >= 6, `source=${gen?.source}`);
check("generation uses a fitting template", ["dark-luxury", "atelier", "maison"].includes(gen?.plan?.templateId), gen?.plan?.templateId);
const saved = (await trpc(editor.cookie, "catalog.save", { document: gen.document, workspaceId: ws.id }, true)).data;
check("editor saves into workspace", !!saved?.id);
const catalogId = saved.id as string;
check("ai history recorded", (await trpc(editor.cookie, "ai.history", null)).data?.[0]?.kind === "generate");

// ---------- Role checks on the shared catalog ----------
const ownerList = (await trpc(owner.cookie, "catalog.list", null)).data as { id: string; workspaceName: string; role: string }[];
check("owner sees workspace catalog", ownerList.some((c) => c.id === catalogId && c.workspaceName === "Marketing" && c.role === "owner"));
const viewerGet = (await trpc(viewer.cookie, "catalog.get", { id: catalogId })).data;
check("viewer can read", viewerGet?.role === "viewer");
const doc = viewerGet.document;
doc.metadata.title = "Edited by viewer";
check("viewer can't save", code(await trpc(viewer.cookie, "catalog.save", { document: doc, baseRevision: viewerGet.revision }, true)) === "FORBIDDEN");
check("outsider can't see it", code(await trpc(outsider.cookie, "catalog.get", { id: catalogId })) === "NOT_FOUND");
doc.metadata.title = "Edited by editor";
check("editor can save", (await trpc(editor.cookie, "catalog.save", { document: doc, baseRevision: viewerGet.revision }, true)).data?.revision === 2);
check("editor can't publish", code(await trpc(editor.cookie, "publication.publish", { catalogId, slug: `ws-${crypto.randomUUID().slice(0, 6)}`, visibility: "private" }, true)) === "FORBIDDEN");
check("editor can't delete", code(await trpc(editor.cookie, "catalog.delete", { id: catalogId }, true)) === "FORBIDDEN");
const slug = `ws-${crypto.randomUUID().slice(0, 6)}`;
check("owner publishes (private)", (await trpc(owner.cookie, "publication.publish", { catalogId, slug, visibility: "private" }, true)).data?.version === 1);
check("private site visible to workspace viewer", (await fetch(`${BASE}/c/${slug}`, { headers: { Cookie: viewer.cookie } })).status === 200);
check("private site hidden from outsider", (await fetch(`${BASE}/c/${slug}`, { headers: { Cookie: outsider.cookie } })).status === 404);

// ---------- Analytics ----------
await trpc(owner.cookie, "publication.publish", { catalogId, slug, visibility: "unlisted" }, true);
for (let i = 0; i < 3; i++) await fetch(`${BASE}/c/${slug}`);
const pubStatus = (await trpc(owner.cookie, "publication.status", { catalogId })).data;
check("daily views counted", pubStatus?.daily?.at(-1)?.views === 3 && pubStatus.daily.length === 30, JSON.stringify(pubStatus?.daily?.at(-1)));

// ---------- MCP: generate + exports, with workspace ----------
const token = (await trpc(editor.cookie, "integrations.tokens.create", { name: "Agent", scopes: ["catalogs:read", "catalogs:write"], expiresInDays: 1 }, true)).data.token;
const mcp = new Client({ name: "e2e", version: "1" });
await mcp.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
const tools = (await mcp.listTools()).tools.map((t) => t.name);
check("MCP exposes 23 tools", tools.length === 23 && tools.includes("catalog_generate") && tools.includes("catalog_export_pptx"), String(tools.length));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const text = (r: any) => JSON.parse(r.content[0].text);
const g = text(await mcp.callTool({ name: "catalog_generate", arguments: { brief: "Industrial power tools catalog for distributors", workspaceId: ws.id, products: [
  { name: "Cordless Drill", price: 199, category: "Drills" }, { name: "Hammer Drill", price: 289, category: "Drills" }, { name: "Angle Grinder", price: 149, category: "Grinders" },
] } }));
check("catalog_generate in workspace", !!g.catalogId && g.slides.length >= 6 && g.template === "forge", `${g.template} ${g.source}`);
const wsList = text(await mcp.callTool({ name: "catalog_list", arguments: {} })).catalogs;
check("catalog_list shows workspace", wsList.some((c: { catalogId: string; workspace: string }) => c.catalogId === g.catalogId && c.workspace === "Marketing"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pptx: any = await mcp.callTool({ name: "catalog_export_pptx", arguments: { catalogId: g.catalogId } });
const blob = pptx.content?.find((c: { type: string }) => c.type === "resource")?.resource?.blob as string | undefined;
check("catalog_export_pptx returns a .pptx", !!blob && Buffer.from(blob, "base64").subarray(0, 2).toString() === "PK");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdf: any = await mcp.callTool({ name: "catalog_export_pdf", arguments: { catalogId: g.catalogId } });
const pdfBlob = pdf.content?.find((c: { type: string }) => c.type === "resource")?.resource?.blob as string | undefined;
check("catalog_export_pdf returns a PDF", !!pdfBlob && Buffer.from(pdfBlob, "base64").subarray(0, 4).toString() === "%PDF");
await mcp.close();

// ---------- Moving & deleting ----------
check("owner deletes workspace", (await trpc(owner.cookie, "workspace.remove", { workspaceId: ws.id }, true)).data?.ok === true);
check("catalogs return to their creators", (await trpc(editor.cookie, "catalog.get", { id: catalogId })).data?.role === "owner");
check("former viewer loses access", code(await trpc(viewer.cookie, "catalog.get", { id: catalogId })) === "NOT_FOUND");

for (const [name, ok, info] of results) console.log(ok ? "PASS" : "FAIL", name, ok ? "" : (info ?? ""));
console.log(`${results.filter((x) => x[1]).length}/${results.length} passed`);
process.exit(results.every((x) => x[1]) ? 0 : 1);
