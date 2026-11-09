/**
 * End-to-end: admin role and Admin page API.
 * Signs up throwaway accounts, promotes one to admin directly in the local
 * database (the first-account rule is covered by e2e/first-admin.ts), then
 * checks roles, suspensions, sign-up policy and site moderation.
 *
 * Needs the Kavero dev server (http://localhost:3001) and the Kavero-postgres container.
 * Run: `bun e2e/admin.ts`
 */
export {};

const BASE = process.env.KAVERO_URL ?? "http://localhost:3001";
const results: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, info?: string) => results.push([name, !!ok, info]);

const created: string[] = [];
async function signUp(tag: string) {
  const email = `${tag}-${crypto.randomUUID().slice(0, 8)}@example.test`;
  created.push(email);
  const password = crypto.randomUUID();
  const r = await fetch(`${BASE}/api/auth/sign-up/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ email, password, name: tag }) });
  const body = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, body, email, password, cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
}
async function signIn(email: string, password: string) {
  const r = await fetch(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ email, password }) });
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => null), cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function trpc(cookie: string, path: string, input: unknown, mutation = false): Promise<{ data?: any; error?: any }> {
  const url = mutation ? `${BASE}/api/trpc/${path}` : `${BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`;
  const r = await fetch(url, { method: mutation ? "POST" : "GET", headers: { "Content-Type": "application/json", Cookie: cookie, Origin: BASE }, body: mutation ? JSON.stringify(input) : undefined });
  const body = (await r.json()) as { result?: { data?: unknown }; error?: unknown };
  return { data: body.result?.data, error: body.error };
}
const code = (r: { error?: { data?: { code?: string } } }) => r.error?.data?.code;
async function sql(query: string) {
  const p = Bun.spawn(["docker", "exec", "Kavero-postgres", "psql", "-U", "postgres", "-d", "Kavero", "-t", "-A", "-c", query], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout).text();
  if ((await p.exited) !== 0) throw new Error(await new Response(p.stderr).text());
  return out.trim();
}
const userId = async (email: string) => sql(`select id from "user" where email = '${email}'`);

const before = await sql(`select coalesce((select value #>> '{}' from app_setting where key = 'signup_policy'), 'open')`);
try {
  const boss = await signUp("admin");
  const member = await signUp("member");
  const other = await signUp("other");
  check("new accounts are plain users", (await sql(`select role from "user" where email = '${member.email}'`)) === "user");
  check("users can't open admin", code(await trpc(member.cookie, "admin.overview", null)) === "FORBIDDEN");
  check("signed-out can't open admin", code(await trpc("", "admin.overview", null)) === "UNAUTHORIZED");
  check("admin.me is false for users", (await trpc(member.cookie, "admin.me", null)).data?.isAdmin === false);

  await sql(`update "user" set role = 'admin' where email = '${boss.email}'`);
  const bossIn = await signIn(boss.email, boss.password);
  const admin = bossIn.cookie;
  check("admin.me is true for admins", (await trpc(admin, "admin.me", null)).data?.isAdmin === true);
  const o = (await trpc(admin, "admin.overview", null)).data;
  check("overview has counts", o?.users?.total >= 3 && o.users.admins >= 1 && typeof o.storage.bytes === "number", JSON.stringify(o));

  const list = (await trpc(admin, "admin.users.list", { query: member.email, limit: 10 })).data;
  check("search finds the account", list?.users?.length === 1 && list.users[0].email === member.email && list.users[0].isYou === false);
  const memberId = list.users[0].id as string;
  const bossId = await userId(boss.email);

  // Roles
  check("make admin", (await trpc(admin, "admin.users.setRole", { userId: memberId, role: "admin" }, true)).data?.ok === true);
  check("promoted user can open admin", (await trpc(member.cookie, "admin.overview", null)).data?.users !== undefined);
  check("remove admin", (await trpc(admin, "admin.users.setRole", { userId: memberId, role: "user" }, true)).data?.ok === true);
  check("demoted user loses admin at once", code(await trpc(member.cookie, "admin.overview", null)) === "FORBIDDEN");
  check("can't demote yourself", code(await trpc(admin, "admin.users.setRole", { userId: bossId, role: "user" }, true)) === "BAD_REQUEST");
  check("can't delete yourself", code(await trpc(admin, "admin.users.remove", { userId: bossId }, true)) === "BAD_REQUEST");

  // Suspension: sessions, sign-in, API tokens, published sites
  const token = (await trpc(member.cookie, "integrations.tokens.create", { name: "t", scopes: ["catalogs:read"] }, true)).data?.token as string | undefined;
  const mcpOk = async () => token && (await fetch(`${BASE}/api/mcp`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) })).status === 200;
  check("token works before suspension", !!(await mcpOk()), token ? "" : "token not created");
  check("suspend", (await trpc(admin, "admin.users.ban", { userId: memberId, reason: "spam", days: 7 }, true)).data?.ok === true);
  check("suspended session is gone", (await trpc(member.cookie, "workspace.list", null)).error !== undefined);
  const blocked = await signIn(member.email, member.password);
  check("suspended account can't sign in", !blocked.ok && /suspended/i.test(JSON.stringify(blocked.body)), JSON.stringify(blocked.body));
  check("suspended account's API token is rejected", !(await mcpOk()));
  const row = (await trpc(admin, "admin.users.list", { query: member.email, limit: 5 })).data?.users?.[0];
  check("list shows suspension", row?.banned === true && row.banReason === "spam" && !!row.banExpires);
  check("can't make a suspended account admin", code(await trpc(admin, "admin.users.setRole", { userId: memberId, role: "admin" }, true)) === "BAD_REQUEST");
  check("lift suspension", (await trpc(admin, "admin.users.unban", { userId: memberId }, true)).data?.ok === true);
  const back = await signIn(member.email, member.password);
  check("can sign in again", back.ok);
  check("token works again", !!(await mcpOk()));

  // Sign out everywhere also revokes API tokens
  const revoked = (await trpc(admin, "admin.users.revokeSessions", { userId: memberId }, true)).data;
  check("sign out everywhere", revoked?.sessions >= 1 && revoked.tokens >= 1, JSON.stringify(revoked));
  check("…and tokens stop working", !(await mcpOk()));

  // Sign-up policy
  check("close sign-ups", (await trpc(admin, "admin.settings.setSignupPolicy", { policy: "closed" }, true)).data?.signupPolicy === "closed");
  const closed = await signUp("closed");
  check("closed: sign-up refused", !closed.ok && /closed/i.test(JSON.stringify(closed.body)), JSON.stringify(closed.body));
  const fresh = await signIn(member.email, member.password); // "sign out everywhere" ended the earlier session
  check("users can't change the policy", code(await trpc(fresh.cookie, "admin.settings.setSignupPolicy", { policy: "open" }, true)) === "FORBIDDEN");
  await trpc(admin, "admin.settings.setSignupPolicy", { policy: "invite-only" }, true);
  check("invite-only: uninvited refused", !(await signUp("uninvited")).ok);
  const ws = (await trpc(admin, "workspace.create", { name: "Invites" }, true)).data;
  const invitedEmail = `invited-${crypto.randomUUID().slice(0, 8)}@example.test`;
  created.push(invitedEmail);
  await trpc(admin, "workspace.invite", { workspaceId: ws.id, email: invitedEmail, role: "editor" }, true);
  const invited = await fetch(`${BASE}/api/auth/sign-up/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ email: invitedEmail, password: crypto.randomUUID(), name: "Invited" }) });
  check("invite-only: invited email can sign up", invited.ok);
  check("invited account is a user", (await sql(`select role from "user" where email = '${invitedEmail}'`)) === "user");
  await trpc(admin, "workspace.remove", { workspaceId: ws.id }, true);
  await trpc(admin, "admin.settings.setSignupPolicy", { policy: "open" }, true);
  check("open again", (await signUp("open-again")).ok);

  // Site moderation
  const doc = { schemaVersion: 1, id: `cat_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`, metadata: { title: "Admin moderation test", language: "en", currency: "USD", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, settings: { width: 1920, height: 1080, page: "16:9" }, theme: { colors: { background: "#ffffff", text: "#111111", muted: "#666666", primary: "#111111", "on-primary": "#ffffff", accent: "#ff5500" }, fonts: { heading: "Inter", body: "Inter" } }, slides: [{ id: "sld_1", name: "One", background: { kind: "color", color: "#ffffff" }, elements: [] }], products: [], assets: [] };
  const saved = (await trpc(other.cookie, "catalog.save", { document: doc }, true)).data;
  const slug = `mod-${crypto.randomUUID().slice(0, 6)}`;
  const pub = (await trpc(other.cookie, "publication.publish", { catalogId: saved?.id, slug, visibility: "unlisted" }, true));
  check("site published", pub.data?.version === 1, JSON.stringify(pub.error ?? ""));
  check("site is live", (await fetch(`${BASE}/c/${slug}`)).status === 200);
  const sites = (await trpc(admin, "admin.sites.list", { query: slug, limit: 5 })).data?.sites ?? [];
  check("admin sees the site", sites.length === 1 && sites[0].ownerEmail === other.email && sites[0].title === "Admin moderation test");
  const otherId = await userId(other.email);
  await trpc(admin, "admin.users.ban", { userId: otherId }, true);
  check("suspended owner's site is offline", (await fetch(`${BASE}/c/${slug}`)).status === 404);
  await trpc(admin, "admin.users.unban", { userId: otherId }, true);
  check("…and back after lifting", (await fetch(`${BASE}/c/${slug}`)).status === 200);
  check("unpublish", (await trpc(admin, "admin.sites.unpublish", { publicationId: sites[0]?.id }, true)).data?.ok === true);
  check("unpublished site is gone", (await fetch(`${BASE}/c/${slug}`)).status === 404);

  // Activity and delete
  const acts = (await trpc(admin, "admin.activity", { limit: 50, action: "admin:" })).data ?? [];
  check("admin actions are logged", ["admin:ban", "admin:unban", "admin:set-role", "admin:signup-policy", "admin:unpublish"].every((a) => acts.some((x: { action: string }) => x.action === a)));
  check("delete account", (await trpc(admin, "admin.users.remove", { userId: otherId }, true)).data?.ok === true);
  check("deleted account is gone", (await sql(`select count(*) from "user" where id = '${otherId}'`)) === "0");
  check("its catalogs are gone", (await sql(`select count(*) from catalog where owner_id = '${otherId}'`)) === "0");

} finally {
  // Remove this run's accounts (and with them their catalogs, sites and tokens).
  await sql(`delete from "user" where email in (${created.map((e) => `'${e}'`).join(",")})`).catch(() => undefined);
  await sql(`insert into app_setting (key, value) values ('signup_policy', '"${before}"') on conflict (key) do update set value = excluded.value`).catch(() => undefined);
}

for (const [name, ok, info] of results) console.log(ok ? "PASS" : "FAIL", name, ok ? "" : (info ?? ""));
console.log(`${results.filter((x) => x[1]).length}/${results.length} passed`);
process.exit(results.every((x) => x[1]) ? 0 : 1);
