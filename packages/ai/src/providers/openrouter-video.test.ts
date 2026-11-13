import { expect, test } from "bun:test";

import { openRouterVideoModel } from "./openrouter-video";

test("OpenRouter video adapter submits, polls and downloads the authenticated MP4", async () => {
  const requests: Array<{ url: string; method: string; authorization: string | null; body?: Record<string, unknown> }> = [];
  const mp4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    requests.push({ url, method, authorization: headers.get("authorization"), body });
    if (method === "POST") return Response.json({ id: "job-123", status: "pending" }, { status: 202 });
    if (url.endsWith("/videos/job-123")) return Response.json({ id: "job-123", status: "completed" });
    if (url.endsWith("/videos/job-123/content?index=0")) return new Response(mp4, { headers: { "Content-Type": "video/mp4" } });
    return Response.json({ error: "unexpected request" }, { status: 404 });
  };

  const model = openRouterVideoModel({ apiKey: "or-test-key", model: "google/veo-3.1", appUrl: "https://kavero.example", fetch });
  const start = await model.doStart!({
    prompt: "A paper boat drifting under city lights",
    n: 1,
    aspectRatio: "16:9",
    resolution: undefined,
    duration: undefined,
    fps: undefined,
    seed: undefined,
    image: undefined,
    frameImages: undefined,
    inputReferences: undefined,
    generateAudio: undefined,
    providerOptions: {},
    abortSignal: undefined,
    headers: { "idempotency-key": "request-1" },
  });
  const result = await model.doStatus!({ operation: start.operation, abortSignal: undefined, headers: {} });

  expect(requests.map((request) => request.method)).toEqual(["POST", "GET", "GET"]);
  expect(requests[0]?.url).toBe("https://openrouter.ai/api/v1/videos");
  expect(requests[0]?.body).toEqual({ model: "google/veo-3.1", prompt: "A paper boat drifting under city lights", aspect_ratio: "16:9" });
  expect(requests.every((request) => request.authorization === "Bearer or-test-key")).toBe(true);
  expect(result.status).toBe("completed");
  if (result.status === "completed") {
    expect(result.videos[0]?.type).toBe("binary");
    if (result.videos[0]?.type === "binary") expect(result.videos[0].data).toEqual(mp4);
  }
});
