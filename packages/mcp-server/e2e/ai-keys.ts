/**
 * End-to-end: personal AI keys (Settings → AI).
 * Saves keys for a throwaway account, checks they are never returned, and runs
 * "Test connection" against a fake OpenAI-compatible server on 127.0.0.1.
 *
 * Needs the Kavero dev server (http://localhost:3001) with its database.
 * Run: `bun e2e/ai-keys.ts`
 */
const BASE = process.env.KAVERO_URL ?? "http://localhost:3001";
const results: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, info?: string) => results.push([name, !!ok, info]);

// Fake OpenAI-compatible model server: records requests, answers with the requested JSON.
const seen: { auth: string | null; body: { model?: string; response_format?: { type?: string } } }[] = [];
const fake = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    if (new URL(req.url).pathname !== "/v1/chat/completions") return new Response("not found", { status: 404 });
    seen.push({ auth: req.headers.get("authorization"), body: (await req.json()) as never });
    return Response.json({ model: "fake-model-1", choices: [{ message: { content: '{"ok":true,"word":"kavero"}' }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 5 } });
  },
});
const fakeUrl = `http://127.0.0.1:${fake.port}/v1`;

async function signUp(tag: string) {
  const email = `${tag}-${crypto.randomUUID().slice(0, 8)}@example.test`;
  const r = await fetch(`${BASE}/api/auth/sign-up/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ email, password: crypto.randomUUID(), name: tag }) });
  if (!r.ok) throw new Error(`sign-up ${r.status}`);
  return { email, cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function trpc(cookie: string, path: string, input: unknown, mutation = false): Promise<{ data?: any; error?: any; raw: string }> {
  const url = mutation ? `${BASE}/api/trpc/${path}` : `${BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`;
  const r = await fetch(url, { method: mutation ? "POST" : "GET", headers: { "Content-Type": "application/json", Cookie: cookie, Origin: BASE }, body: mutation ? JSON.stringify(input) : undefined });
  const raw = await r.text();
  const body = JSON.parse(raw) as { result?: { data?: unknown }; error?: unknown };
  return { data: body.result?.data, error: body.error, raw };
}
const code = (r: { error?: { data?: { code?: string } } }) => r.error?.data?.code;

const user = await signUp("aikey");
const other = await signUp("aikey-other");
const SECRET = `sk-ant-test-${crypto.randomUUID()}`;

check("signed-out can't read keys", code(await trpc("", "ai.credential.get", null)) === "UNAUTHORIZED");
check("no key yet", (await trpc(user.cookie, "ai.credential.get", null)).data === null);
check("key required for Claude", code(await trpc(user.cookie, "ai.credential.set", { provider: "anthropic" }, true)) === "BAD_REQUEST");
check("model required for OpenRouter", code(await trpc(user.cookie, "ai.credential.set", { provider: "openrouter", apiKey: "sk-or-test-123456" }, true)) === "BAD_REQUEST");
check("odd model ids rejected", code(await trpc(user.cookie, "ai.credential.set", { provider: "openrouter", apiKey: "sk-or-test-123456", model: "a b<script>" }, true)) === "BAD_REQUEST");

const saved = await trpc(user.cookie, "ai.credential.set", { provider: "anthropic", apiKey: SECRET }, true);
check("Claude key saved", saved.data?.provider === "anthropic" && saved.data?.hasKey === true);
check("only the last 4 characters come back", saved.data?.keyHint === SECRET.slice(-4) && !saved.raw.includes(SECRET.slice(0, 20)));
const got = await trpc(user.cookie, "ai.credential.get", null);
check("get never returns the key", !got.raw.includes(SECRET.slice(0, 20)) && !("apiKey" in (got.data ?? {})) && !("encryptedKey" in (got.data ?? {})));
const status = (await trpc(user.cookie, "ai.status", null)).data;
check("status uses the personal key", status?.source === "personal" && status?.model === "claude-opus-5-5", JSON.stringify(status));
check("other users are unaffected", (await trpc(other.cookie, "ai.credential.get", null)).data === null && (await trpc(other.cookie, "ai.status", null)).data?.source !== "personal");

const modelOnly = await trpc(user.cookie, "ai.credential.set", { provider: "anthropic", model: "claude-sonnet-5-5" }, true);
check("model change keeps the stored key", modelOnly.data?.hasKey === true && modelOnly.data?.model === "claude-sonnet-5-5");
check("switching provider needs a new key", code(await trpc(user.cookie, "ai.credential.set", { provider: "openrouter", model: "anthropic/claude-sonnet" }, true)) === "BAD_REQUEST");

const or = await trpc(user.cookie, "ai.credential.set", { provider: "openrouter", apiKey: "sk-or-test-abcdef123456", model: "anthropic/claude-sonnet" }, true);
check("OpenRouter key saved", or.data?.provider === "openrouter" && or.data?.label === "OpenRouter" && or.data?.keyHint === "3456");

const local = await trpc(user.cookie, "ai.credential.set", { provider: "openai-compatible", model: "llama-test", baseUrl: fakeUrl }, true);
check("OpenAI-compatible server saved (no key)", local.data?.provider === "openai-compatible" && local.data?.baseUrl === fakeUrl, JSON.stringify(local.error ?? ""));
const t = await trpc(user.cookie, "ai.credential.test", null, true);
check("test connection succeeds", t.data?.ok === true && t.data?.model === "fake-model-1", JSON.stringify(t.error ?? t.data));
check("request reached the server with the chosen model", seen.at(-1)?.body.model === "llama-test");

const keyed = await trpc(user.cookie, "ai.credential.set", { provider: "openai-compatible", apiKey: "local-secret-key-99", model: "llama-test", baseUrl: fakeUrl }, true);
await trpc(user.cookie, "ai.credential.test", null, true);
check("key sent as a bearer token", keyed.data?.hasKey === true && seen.at(-1)?.auth === "Bearer local-secret-key-99");

check("bad server URL rejected", code(await trpc(user.cookie, "ai.credential.set", { provider: "openai-compatible", model: "x", baseUrl: "file:///etc/passwd" }, true)) === "BAD_REQUEST");
check("remove", (await trpc(user.cookie, "ai.credential.remove", null, true)).data?.ok === true);
check("removed key is gone", (await trpc(user.cookie, "ai.credential.get", null)).data === null && (await trpc(user.cookie, "ai.status", null)).data?.source !== "personal");
check("test without a key → NOT_FOUND", code(await trpc(user.cookie, "ai.credential.test", null, true)) === "NOT_FOUND");

fake.stop(true);
for (const [name, ok, info] of results) console.log(ok ? "PASS" : "FAIL", name, ok ? "" : (info ?? ""));
console.log(`${results.filter((x) => x[1]).length}/${results.length} passed`);
process.exit(results.every((x) => x[1]) ? 0 : 1);
