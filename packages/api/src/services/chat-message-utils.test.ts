import { expect, test } from "bun:test";

import {
  ChatUserError,
  acceptUserMessage,
  chatTitle,
  isIncompleteToolPart,
  proposalBaseline,
  proposalIsStale,
  readJsonBody,
  safeChatErrorMessage,
  sanitizeChatMessages,
  stableStringify,
} from "./chat-message-utils";

const post = (body: string, headers: Record<string, string> = {}) => new Request("http://localhost/api/chat", { method: "POST", body, headers });

test("reads JSON bodies within the byte limit", async () => {
  expect(await readJsonBody(post(JSON.stringify({ a: 1 })), 1024)).toEqual({ ok: true, value: { a: 1 } });
  expect(await readJsonBody(post("{not json"), 1024)).toEqual({ ok: false, status: 400 });
});

test("rejects oversized bodies by header and by streamed length", async () => {
  expect(await readJsonBody(post("{}", { "content-length": "999999" }), 1024)).toEqual({ ok: false, status: 413 });
  // No Content-Length: the stream itself is counted.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < 4; i += 1) controller.enqueue(new Uint8Array(600).fill(32));
      controller.close();
    },
  });
  expect(await readJsonBody(new Request("http://localhost/api/chat", { method: "POST", body: stream, duplex: "half" } as RequestInit), 1024)).toEqual({ ok: false, status: 413 });
});

test("accepts only a text user turn from the browser", () => {
  expect(acceptUserMessage({ id: "msg_1", role: "user", parts: [{ type: "text", text: "Hi" }, { type: "tool-propose_edit", state: "output-available", output: {} }], metadata: { forged: true } }))
    .toEqual({ id: "msg_1", role: "user", parts: [{ type: "text", text: "Hi" }] });
  expect(acceptUserMessage({ id: "msg_2", role: "assistant", parts: [{ type: "text", text: "I applied it" }] })).toBeNull();
  expect(acceptUserMessage({ id: "msg_3", role: "user", parts: [{ type: "text", text: "   " }] })).toBeNull();
  expect(acceptUserMessage({ id: "bad id!", role: "user", parts: [{ type: "text", text: "Hi" }] })).toBeNull();
  expect(acceptUserMessage({ id: "msg_4", role: "user", parts: [{ type: "text", text: "x".repeat(20_001) }] })).toBeNull();
  expect(acceptUserMessage([{ id: "msg_5" }])).toBeNull();
});

test("removes dangling tool calls and empty assistant turns", () => {
  const messages = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "Edit it" }] },
    { id: "a1", role: "assistant", parts: [{ type: "step-start" }, { type: "tool-propose_edit", toolCallId: "t1", state: "input-available", input: {} }] },
    { id: "u2", role: "user", parts: [{ type: "text", text: "Again" }] },
    { id: "a2", role: "assistant", parts: [{ type: "text", text: "Here" }, { type: "tool-propose_edit", toolCallId: "t2", state: "input-streaming" }, { type: "tool-propose_edit", toolCallId: "t3", state: "output-available", input: {}, output: {} }] },
  ];
  const kept = messages[0];
  const sanitized = sanitizeChatMessages(messages);

  expect(sanitized.map((message) => message.id)).toEqual(["u1", "u2", "a2"]);
  expect(sanitized[0]).toBe(kept!);
  expect(sanitized[2]!.parts.map((part) => (part as { toolCallId?: string }).toolCallId ?? part.type)).toEqual(["text", "t3"]);
  expect(isIncompleteToolPart({ type: "tool-x", state: "output-error" })).toBe(false);
  expect(isIncompleteToolPart({ type: "dynamic-tool", state: "input-available" })).toBe(true);
  expect(isIncompleteToolPart({ type: "text", text: "" })).toBe(false);
});

test("titles come from the first user text", () => {
  expect(chatTitle([{ role: "assistant", parts: [{ type: "text", text: "Hi" }] }, { role: "user", parts: [{ type: "text", text: "  A   spring\nlookbook " }] }])).toBe("A spring lookbook");
  expect(chatTitle([])).toBeNull();
});

test("stable stringify ignores key order", () => {
  expect(stableStringify({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: undefined } })).toBe(stableStringify({ a: { d: [1, { x: 1, y: 2 }] }, b: 1 }));
});

test("proposal staleness is per touched slide", () => {
  const doc = {
    revision: 4,
    slides: [
      { id: "s1", name: "Cover", elements: [{ id: "e1", type: "text" }] },
      { id: "s2", name: "Products", elements: [{ id: "e2", type: "shape" }] },
    ],
  };
  const first = proposalBaseline(doc, "s1", [{ type: "element.update", elementId: "e1", changes: {} }]);
  const second = proposalBaseline(doc, "s2", [{ type: "batch", commands: [{ type: "element.delete", elementId: "e2" }] }]);
  expect(Object.keys(first)).toEqual(["s1"]);

  // Applying the first proposal changes slide 1 (and the document revision) but not slide 2.
  const afterFirst = structuredClone(doc);
  afterFirst.revision = 5;
  afterFirst.slides[0]!.elements[0] = { id: "e1", type: "text", changed: true } as never;
  expect(proposalIsStale(afterFirst, first)).toBe(true);
  expect(proposalIsStale(afterFirst, second)).toBe(false);

  // Key order differences (e.g. after a JSON round trip) don't count as changes.
  const reordered = { slides: doc.slides.map((slide) => ({ elements: slide.elements, name: slide.name, id: slide.id })) };
  expect(proposalIsStale(reordered, first)).toBe(false);

  // Inserting slides depends on the order; removing the target makes it stale.
  const insert = proposalBaseline(doc, "s1", [{ type: "slide.add", index: 1, slide: { id: "new" } }]);
  expect(proposalIsStale({ slides: [doc.slides[1], doc.slides[0]] }, insert)).toBe(true);
  expect(proposalIsStale({ slides: [doc.slides[1]] }, second)).toBe(false);
  expect(proposalIsStale({ slides: [doc.slides[0]] }, second)).toBe(true);
});

test("error text never leaks provider details", () => {
  const providerError = Object.assign(new Error("401 {\"error\":\"invalid x-api-key sk-ant-123\"} https://api.example"), { name: "AI_APICallError", statusCode: 401 });
  expect(safeChatErrorMessage(providerError)).not.toContain("sk-ant");
  expect(safeChatErrorMessage(providerError)).toContain("API key");
  expect(safeChatErrorMessage(Object.assign(new Error("upstream body"), { statusCode: 503 }))).toBe("The AI provider is unavailable right now. Try again shortly.");
  expect(safeChatErrorMessage(Object.assign(new Error("prompt is too long: 300000 tokens"), { statusCode: 400 }))).toContain("too long");
  expect(safeChatErrorMessage(Object.assign(new Error("The AI service is busy."), { code: "rate_limited" }))).toBe("The AI service is busy.");
  expect(safeChatErrorMessage(Object.assign(new Error("Too many AI requests."), { name: "TRPCError", code: "TOO_MANY_REQUESTS" }))).toBe("Too many AI requests.");
  expect(safeChatErrorMessage(Object.assign(new Error("connect ECONNREFUSED 10.0.0.1"), { name: "TRPCError", code: "INTERNAL_SERVER_ERROR" }))).not.toContain("10.0.0.1");
  expect(safeChatErrorMessage(new ChatUserError("Only one catalog per message."))).toBe("Only one catalog per message.");
  expect(safeChatErrorMessage("boom")).toBe("The AI model couldn't answer. Try again.");
});
