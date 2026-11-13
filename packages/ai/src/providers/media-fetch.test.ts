import { expect, test } from "bun:test";

import { createLimitedMediaFetch } from "./media-fetch";

test("limited media fetch rejects a response that exceeds its byte cap", async () => {
  const fetcher = createLimitedMediaFetch(async () => new Response(new Uint8Array(9)), 8);
  const response = await fetcher("https://provider.test/media");
  await expect(response.arrayBuffer()).rejects.toThrow("25 MB catalog asset limit");
});

test("limited media fetch rejects oversized declared content length before parsing", async () => {
  const fetcher = createLimitedMediaFetch(async () => new Response("payload", { headers: { "content-length": "9" } }), 8);
  await expect(fetcher("https://provider.test/media")).rejects.toThrow("25 MB catalog asset limit");
});
