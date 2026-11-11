/**
 * End-to-end: MCP font tools (font_list, font_add_google, font_upload,
 * font_apply, font_remove) against a real cloud catalog, including a published
 * site that serves the embedded fonts.
 *
 * Needs the Kavero dev server (http://localhost:3001), its database, and internet
 * access to fonts.googleapis.com / fonts.gstatic.com. Cleans up its account.
 * Run: `bun e2e/fonts.ts`
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = process.env.KAVERO_URL ?? "http://localhost:3001";
const results: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, info?: string) => results.push([name, !!ok, info]);

const email = `fonts-${crypto.randomUUID().slice(0, 8)}@example.test`;
const signUp = await fetch(`${BASE}/api/auth/sign-up/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ email, password: crypto.randomUUID(), name: "Fonts" }) });
const cookie = signUp.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function trpc(path: string, input: unknown, mutation = false): Promise<any> {
  const url = mutation ? `${BASE}/api/trpc/${path}` : `${BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`;
  const r = await fetch(url, { method: mutation ? "POST" : "GET", headers: { "Content-Type": "application/json", Cookie: cookie, Origin: BASE }, body: mutation ? JSON.stringify(input) : undefined });
  return ((await r.json()) as { result?: { data?: unknown } }).result?.data;
}
async function sql(query: string) {
  const p = Bun.spawn(["docker", "exec", "Kavero-postgres", "psql", "-U", "postgres", "-d", "Kavero", "-t", "-A", "-c", query], { stdout: "pipe", stderr: "pipe" });
  await p.exited;
  return (await new Response(p.stdout).text()).trim();
}

const mcp = new Client({ name: "kavero-fonts-e2e", version: "1.0.0" });
try {
  const apiKey = (await trpc("integrations.apiKeys.create", { name: "Fonts", scopes: ["catalogs:read", "catalogs:write", "assets:write", "publish"], expiresInDays: 1 }, true)).key as string;
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), { requestInit: { headers: { Authorization: `Bearer ${apiKey}` } } }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (name: string, args: Record<string, unknown>): Promise<{ error: boolean; data: any; text: string }> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await mcp.callTool({ name, arguments: args });
    const text = r.content?.[0]?.text ?? "";
    let data: unknown = null;
    try { data = JSON.parse(text); } catch { /* error text */ }
    return { error: !!r.isError, data, text };
  };

  const tools = (await mcp.listTools()).tools.map((t) => t.name);
  check("font tools are listed", ["font_list", "font_add_google", "font_upload", "font_apply", "font_remove"].every((t) => tools.includes(t)), tools.join(","));

  const created = await call("catalog_create", { title: "Font test", template: "maison" });
  const catalogId = created.data?.catalogId as string;
  check("catalog created", !!catalogId, created.text);

  const before = (await call("font_list", { catalogId })).data;
  check("font_list shows theme fonts", !!before?.theme?.heading && before.families.every((f: { files: unknown[] }) => !f.files.length), JSON.stringify(before?.theme));

  // Google font, embedded, as the heading font
  const g = await call("font_add_google", { catalogId, family: "Vazirmatn", weights: [400, 700, 950].filter((w) => w <= 900), applyTo: "heading" });
  check("font_add_google embeds faces", !g.error && g.data.added.length === 2 && g.data.theme.heading === "Vazirmatn", g.text);
  const again = await call("font_add_google", { catalogId, family: "Vazirmatn", weights: [400, 700] });
  check("adding the same faces again adds nothing", !again.error && again.data.added.length === 0, again.text);
  const missing = await call("font_add_google", { catalogId, family: "Playfair Display", weights: [400, 900], italic: true });
  check("missing weights reported, italics added", !missing.error && missing.data.added.length >= 2 && missing.data.faces.some((f: { style: string }) => f.style === "italic"), missing.text);
  const unknown = await call("font_add_google", { catalogId, family: "Not A Real Font Xyz" });
  check("unknown Google family is refused", unknown.error && /no family called/i.test(unknown.text), unknown.text);
  const byName = await call("font_add_google", { catalogId, family: "Lobster", embed: false, applyTo: "body" });
  check("embed=false only sets the font", !byName.error && byName.data.added.length === 0 && byName.data.theme.body === "Lobster", byName.text);

  // Uploads
  const ttfUrl = "https://fonts.gstatic.com/s/vazirmatn/v16/Dxx78j6PP2D_kU2muijPEe1n2vVbfJRklWgzORc.ttf";
  const ttf = new Uint8Array(await (await fetch(ttfUrl)).arrayBuffer());
  const brand = new Uint8Array(ttf); // a different hash, so it's a new file
  brand[brand.length - 1] = brand[brand.length - 1]! ^ 0xff;
  const up = await call("font_upload", { catalogId, family: "Brand Sans", data: Buffer.from(brand).toString("base64"), weight: 700, applyTo: "body" });
  check("font_upload stores a file", !up.error && up.data.mimeType === "font/ttf" && up.data.family === "Brand Sans" && up.data.weight === 700, up.text);
  const upUrl = await call("font_upload", { catalogId, family: "Same File", url: ttfUrl });
  check("uploading a file already stored reuses it", !upUrl.error && upUrl.data.alreadyPresent === true && upUrl.data.family === "Vazirmatn", upUrl.text);
  const notFont = await call("font_upload", { catalogId, family: "Nope", data: Buffer.from("hello, this is not a font file").toString("base64") });
  check("non-font data is refused", notFont.error && /isn't a TTF/i.test(notFont.text), notFont.text);
  const httpUrl = await call("font_upload", { catalogId, family: "Nope", url: "http://example.com/font.ttf" });
  check("plain http URLs are refused", httpUrl.error && /https/i.test(httpUrl.text), httpUrl.text);
  const privateUrl = await call("font_upload", { catalogId, family: "Nope", url: "https://[::ffff:10.0.0.1]/font.ttf" }); // loopback is allowed in development, private ranges never
  check("private addresses are refused", privateUrl.error && /private/i.test(privateUrl.text), privateUrl.text);
  const badName = await call("font_upload", { catalogId, family: 'Evil"}body{', url: ttfUrl });
  check("unsafe family names are refused", badName.error, badName.text);

  // Apply to elements
  const doc = (await call("catalog_get", { catalogId, full: true })).data.document;
  const text = doc.slides[0].elements.find((e: { type: string }) => e.type === "text");
  const shape = doc.slides[0].elements.find((e: { type: string }) => e.type !== "text");
  const applied = await call("font_apply", { catalogId, family: "Playfair Display", elementIds: [text.id], weight: 900 });
  check("font_apply sets elements", !applied.error && applied.data.elements === 1 && !applied.data.note, applied.text);
  const after = (await call("catalog_get", { catalogId, full: true })).data.document;
  const t2 = after.slides[0].elements.find((e: { id: string }) => e.id === text.id);
  check("…with family and weight", t2.style.fontFamily === "Playfair Display" && t2.style.fontWeight === 900, JSON.stringify(t2.style));
  const notText = await call("font_apply", { catalogId, family: "Inter", elementIds: [shape.id] });
  check("font_apply refuses non-text elements", notText.error, notText.text);
  const viaName = await call("font_apply", { catalogId, family: "Roboto", theme: "heading" });
  check("font_apply notes fonts that aren't stored", !viaName.error && /Google Fonts by name/.test(viaName.data.note ?? ""), viaName.text);

  const list = (await call("font_list", { catalogId })).data;
  const fam = (name: string) => list.families.find((f: { family: string }) => f.family === name);
  check("font_list: stored files", fam("Vazirmatn")?.files.length === 2 && fam("Brand Sans")?.loadedFrom === "catalog files", JSON.stringify(list.families.map((f: { family: string; files: unknown[] }) => [f.family, f.files.length])));
  check("font_list: usage", fam("Playfair Display")?.textElements === 1 && fam("Brand Sans")?.themeRoles.includes("body") && fam("Roboto")?.loadedFrom === "Google Fonts (by name)");

  // Published site serves the embedded faces
  const slug = `fonts-${crypto.randomUUID().slice(0, 6)}`;
  const pub = await call("catalog_publish", { catalogId, slug, visibility: "unlisted" });
  check("published", !pub.error, pub.text);
  const html = await (await fetch(`${BASE}/c/${slug}`)).text();
  check("site page loads", html.includes("Font test"));
  const assetUrl = /\/c\/[^"'\s]+\/assets\/[^"'\s)]+/.exec(html)?.[0];
  const brandId = up.data.assetId as string;
  const fontRes = await fetch(`${BASE}/c/${slug}/assets/${brandId}`);
  check("site serves an embedded font file", fontRes.ok && (fontRes.headers.get("content-type") ?? "").startsWith("font/"), `${fontRes.status} ${fontRes.headers.get("content-type")} ${assetUrl ?? ""}`);

  // Remove
  const rm = await call("font_remove", { catalogId, family: "Vazirmatn" });
  check("font_remove removes every face", !rm.error && rm.data.removed.length === 2 && rm.data.remainingFiles === 0, rm.text);
  const rmOne = await call("font_remove", { catalogId, assetId: brandId });
  check("font_remove by assetId reports remaining use", !rmOne.error && rmOne.data.stillUsedBy?.themeRoles?.includes("body"), rmOne.text);
  const rmNone = await call("font_remove", { catalogId, family: "Vazirmatn" });
  check("removing again explains nothing is stored", rmNone.error && /No font files/.test(rmNone.text), rmNone.text);
  const final = (await call("font_list", { catalogId })).data;
  check("font_list after removal", !final.families.some((f: { family: string; files: unknown[] }) => f.family === "Vazirmatn" && f.files.length));

  // Read-only tokens can list but not add
  const ro = (await trpc("integrations.apiKeys.create", { name: "RO", scopes: ["catalogs:read"], expiresInDays: 1 }, true)).key as string;
  const roClient = new Client({ name: "ro", version: "1.0.0" });
  await roClient.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), { requestInit: { headers: { Authorization: `Bearer ${ro}` } } }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const roList: any = await roClient.callTool({ name: "font_list", arguments: { catalogId } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const roAdd: any = await roClient.callTool({ name: "font_add_google", arguments: { catalogId, family: "Inter" } });
  check("read-only token: list yes, add no", !roList.isError && roAdd.isError && /catalogs:write/.test(roAdd.content?.[0]?.text ?? ""));
  await roClient.close();
} catch (e) {
  check("ran without errors", false, (e as Error).stack);
} finally {
  await mcp.close().catch(() => undefined);
  await sql(`delete from "user" where email = '${email}'`);
}

for (const [name, ok, info] of results) console.log(ok ? "PASS" : "FAIL", name, ok ? "" : (info ?? "").slice(0, 400));
console.log(`${results.filter((x) => x[1]).length}/${results.length} passed`);
process.exit(results.every((x) => x[1]) ? 0 : 1);
