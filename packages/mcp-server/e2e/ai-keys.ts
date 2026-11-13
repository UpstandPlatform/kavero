/**
 * End-to-end: multiple personal AI providers (Settings → AI).
 * A fake OpenAI-compatible server covers model discovery, purpose filtering,
 * connection saving, assignment validation, failed-update rollback, and key secrecy.
 * Needs the Kavero dev server (http://localhost:3001) with its database.
 * Run: `bun e2e/ai-keys.ts`
 */
export {};

const BASE = process.env.KAVERO_URL ?? "http://localhost:3001";
const results: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, info?: string) => results.push([name, !!ok, info]);

let failModelList = false;
const fake = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/v1/models" && req.method === "GET") {
      if (failModelList) return Response.json({ error: { message: "intentional test failure" } }, { status: 500 });
      return Response.json({ data: [
        { id: "fake-model-1", name: "Fake Vision Model", architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] }, supported_parameters: ["tools", "response_format"], context_length: 32_768 },
        { id: "fake-model-2", name: "Fake Text Model", architecture: { input_modalities: ["text"], output_modalities: ["text"] }, supported_parameters: ["tools"], context_length: 16_384 },
      ] });
    }
    return new Response("not found", { status: 404 });
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
const SECRET = `local-secret-${crypto.randomUUID()}`;

check("signed-out cannot list providers", code(await trpc("", "ai.credential.list", null)) === "UNAUTHORIZED");
check("no providers yet", (await trpc(user.cookie, "ai.credential.list", null)).data?.length === 0);
check("models are searchable through provider metadata", (await trpc(user.cookie, "ai.credential.models", { provider: "openai-compatible", baseUrl: fakeUrl, purpose: "text" })).data?.length === 2);
const models = (await trpc(user.cookie, "ai.credential.models", { provider: "openai-compatible", baseUrl: fakeUrl, purpose: "text" })).data;
const visionModel = models?.find((entry: { id: string }) => entry.id === "fake-model-1");
check("vision and context capabilities are precise", visionModel?.capabilities.inputModalities.includes("image") && visionModel.capabilities.maxInputTokens === 32_768 && visionModel.capabilities.source === "provider");
check("unknown image models are hidden", (await trpc(user.cookie, "ai.credential.models", { provider: "openai-compatible", baseUrl: fakeUrl, purpose: "image" })).data?.length === 0);
check("assignment fails before provider is connected", code(await trpc(user.cookie, "ai.credential.setAssignment", { purpose: "text", provider: "openai", model: "gpt-4o" }, true)) === "NOT_FOUND");
check("bad server URL is rejected", code(await trpc(user.cookie, "ai.credential.set", { provider: "openai-compatible", baseUrl: "file:///etc/passwd" }, true)) === "BAD_REQUEST");
check("validation failures do not create providers", (await trpc(user.cookie, "ai.credential.list", null)).data?.length === 0);

const saved = await trpc(user.cookie, "ai.credential.set", { provider: "openai-compatible", apiKey: SECRET, baseUrl: fakeUrl }, true);
check("provider is tested and saved", saved.data?.provider === "openai-compatible" && saved.data?.hasKey === true && saved.data?.connection?.ok === true);
check("only the last four key characters come back", saved.data?.keyHint === SECRET.slice(-4) && !saved.raw.includes(SECRET.slice(0, 16)));
check("saved compatible server URL is reused for model discovery", (await trpc(user.cookie, "ai.credential.models", { provider: "openai-compatible", purpose: "text" })).data?.length === 2);
check("unsupported image assignment is rejected", code(await trpc(user.cookie, "ai.credential.setAssignment", { purpose: "image", provider: "openai-compatible", model: "fake-model-1" }, true)) === "BAD_REQUEST");
const assigned = await trpc(user.cookie, "ai.credential.setAssignment", { purpose: "text", provider: "openai-compatible", model: "fake-model-1" }, true);
check("text model assignment is saved independently", assigned.data?.some((entry: { purpose: string; model: string }) => entry.purpose === "text" && entry.model === "fake-model-1"));
const status = (await trpc(user.cookie, "ai.status", null)).data;
check("personal text assignment is used", status?.source === "personal" && status?.model === "fake-model-1" && status.capabilities?.inputModalities.includes("image"));
check("other users stay isolated", (await trpc(other.cookie, "ai.credential.list", null)).data?.length === 0 && (await trpc(other.cookie, "ai.status", null)).data?.source !== "personal");

failModelList = true;
const failedUpdate = await trpc(user.cookie, "ai.credential.set", { provider: "openai-compatible", apiKey: "replacement-secret-123", baseUrl: fakeUrl }, true);
failModelList = false;
check("failed connection check is rejected", code(failedUpdate) === "BAD_REQUEST");
const unchanged = (await trpc(user.cookie, "ai.credential.list", null)).data?.[0];
check("failed connection check leaves stored provider unchanged", unchanged?.baseUrl === fakeUrl && unchanged.keyHint === SECRET.slice(-4));

const removed = await trpc(user.cookie, "ai.credential.remove", { provider: "openai-compatible" }, true);
check("remove provider clears its assignment", removed.data?.providers?.length === 0 && removed.data?.assignments?.length === 0);
check("removed personal assignment no longer overrides server AI", (await trpc(user.cookie, "ai.status", null)).data?.source !== "personal");

fake.stop(true);
for (const [name, ok, info] of results) console.log(ok ? "PASS" : "FAIL", name, ok ? "" : (info ?? ""));
console.log(`${results.filter((x) => x[1]).length}/${results.length} passed`);
process.exit(results.every((x) => x[1]) ? 0 : 1);
