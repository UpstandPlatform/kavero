import { expect, test } from "bun:test";

import { MCP_TOOL_LIMITS, sanitizeResourceList, sanitizeToolList } from "./mcp-connection-service";
import { fetchImagesWithBudget, limitResponseBody, mapWithConcurrency } from "./safe-fetch";

test("tool lists from remote servers are capped in count, text and schema size", () => {
  const huge = Array.from({ length: 1_000 }, (_, i) => ({ name: `tool_${i}`, description: "d".repeat(10_000), inputSchema: { type: "object" } }));
  const tools = sanitizeToolList(huge);
  expect(tools.length).toBeLessThanOrEqual(MCP_TOOL_LIMITS.maxTools);
  expect(tools[0]!.description!.length).toBe(MCP_TOOL_LIMITS.maxDescriptionChars);
  expect(JSON.stringify(tools).length).toBeLessThanOrEqual(MCP_TOOL_LIMITS.maxTotalChars + 2);

  const [withBigSchema] = sanitizeToolList([{ name: "big", inputSchema: { blob: "x".repeat(MCP_TOOL_LIMITS.maxSchemaChars) } }]);
  expect(withBigSchema).toEqual({ name: "big", title: undefined, description: undefined, inputSchema: undefined });
  expect(sanitizeToolList([null, { name: "" }, { name: 3 }, { name: "a" }, { name: "a" }, { name: "n".repeat(500) }]).map((tool) => tool.name)).toEqual(["a"]);
  expect(sanitizeResourceList(Array.from({ length: 500 }, (_, i) => ({ uri: `res://${i}` }))).length).toBe(MCP_TOOL_LIMITS.maxResources);
});

test("response bodies are cut off at the byte limit while streaming", async () => {
  const chunk = new Uint8Array(1024);
  const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(chunk); } }); // endless
  const limited = limitResponseBody(new Response(body), 10 * 1024, "too much");
  await expect(limited.arrayBuffer()).rejects.toThrow("too much");
  expect(() => limitResponseBody(new Response("x", { headers: { "content-length": "999999" } }), 10)).toThrow();
  expect(await limitResponseBody(new Response("small"), 10).text()).toBe("small");
});

test("image batches run with bounded concurrency and a total byte budget", async () => {
  let active = 0;
  let peak = 0;
  const caps: number[] = [];
  const fetchImage = async (_url: string, opts: { maxBytes: number }) => {
    caps.push(opts.maxBytes);
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return `data:image/png;base64,${Buffer.alloc(opts.maxBytes).toString("base64")}`;
  };
  const urls = Array.from({ length: 10 }, (_, i) => `https://img.test/${i}.png`);
  const results = await fetchImagesWithBudget(urls, { concurrency: 3, maxImageBytes: 100, maxTotalBytes: 450, fetchImage });
  expect(peak).toBeLessThanOrEqual(3);
  expect(results.map((result) => result.url)).toEqual(urls);
  const returned = results.reduce((sum, result) => sum + ("dataUrl" in result ? Buffer.from(result.dataUrl.split(",")[1]!, "base64").byteLength : 0), 0);
  expect(returned).toBeLessThanOrEqual(450);
  expect(results.filter((result) => "error" in result).length).toBeGreaterThan(0);
  expect(caps.every((cap) => cap <= 100)).toBe(true);
  expect(await mapWithConcurrency([1, 2, 3], 2, async (n) => n * 2)).toEqual([2, 4, 6]);
});
