/**
 * Pure helpers for the chat route (request bounds, message acceptance, transcript repair,
 * proposal staleness and safe error text). No framework or database imports, so they can be
 * unit-tested here and shared with the browser (proposal fingerprints).
 */

/** Largest accepted chat request body. The editor sends the open catalog with each turn. */
export const CHAT_REQUEST_MAX_BYTES = 8 * 1024 * 1024;
/** Longest text a user can send in one chat turn. */
export const CHAT_USER_TEXT_LIMIT = 20_000;

export type JsonBodyResult = { ok: true; value: unknown } | { ok: false; status: 400 | 413 };

/**
 * Read a JSON body without buffering more than `maxBytes`: the declared Content-Length is
 * checked first, then the stream is counted while it is read (the header can be missing or wrong).
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<JsonBodyResult> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length < 0) return { ok: false, status: 400 };
    if (length > maxBytes) return { ok: false, status: 413 };
  }
  if (!request.body) return { ok: false, status: 400 };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400 };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
  } catch {
    return { ok: false, status: 400 };
  }
}

export type AcceptedUserMessage = { id: string; role: "user"; parts: { type: "text"; text: string }[] };

/**
 * The browser may only contribute the new user turn. Everything else in the thread comes from
 * the account copy, so forged assistant or tool messages (and non-text parts) are never accepted.
 */
export function acceptUserMessage(raw: unknown): AcceptedUserMessage | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(raw.id)) return null;
  if (raw.role !== "user" || !Array.isArray(raw.parts) || raw.parts.length === 0 || raw.parts.length > 20) return null;
  const parts: AcceptedUserMessage["parts"] = [];
  let length = 0;
  for (const part of raw.parts) {
    if (!isRecord(part)) return null;
    if (part.type !== "text") continue;
    if (typeof part.text !== "string") return null;
    length += part.text.length;
    if (length > CHAT_USER_TEXT_LIMIT) return null;
    parts.push({ type: "text", text: part.text });
  }
  if (!parts.some((part) => part.text.trim())) return null;
  return { id: raw.id, role: "user", parts };
}

const SETTLED_TOOL_STATES = new Set(["output-available", "output-error", "output-denied"]);

/** A tool call that never produced a result (stream stopped, function killed, client aborted). */
export function isIncompleteToolPart(part: unknown) {
  if (!isRecord(part) || typeof part.type !== "string") return false;
  if (!part.type.startsWith("tool-") && part.type !== "dynamic-tool") return false;
  return !SETTLED_TOOL_STATES.has(String(part.state));
}

/**
 * Remove dangling tool calls and empty assistant turns. A tool call without a result makes the
 * next model request invalid, so an interrupted turn must never poison the rest of the thread.
 */
export function sanitizeChatMessages<T>(messages: T[]): T[] {
  const result: T[] = [];
  for (const message of messages) {
    if (!isRecord(message) || typeof message.id !== "string" || !Array.isArray(message.parts)) continue;
    const parts = message.parts.filter((part) => !isIncompleteToolPart(part));
    if (message.role === "assistant" && !parts.some(isMeaningfulPart)) continue;
    result.push(parts.length === message.parts.length ? message : ({ ...message, parts } as T));
  }
  return result;
}

function isMeaningfulPart(part: unknown) {
  if (!isRecord(part)) return false;
  if (part.type === "step-start") return false;
  if (part.type === "text" || part.type === "reasoning") return typeof part.text === "string" && part.text.trim().length > 0;
  return true;
}

/** Plain text of a message's text parts. */
export function messageText(message: unknown) {
  if (!isRecord(message) || !Array.isArray(message.parts)) return "";
  return message.parts
    .flatMap((part) => (isRecord(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : []))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** History title: the first thing the user asked. */
export function chatTitle(messages: unknown[]) {
  for (const message of messages) {
    if (!isRecord(message) || message.role !== "user") continue;
    const text = messageText(message);
    if (text) return text.slice(0, 96);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Proposal staleness: per slide, so independent proposals stay applicable
// ---------------------------------------------------------------------------

const ORDER_KEY = "#order";
const ABSENT = "-";

/** JSON with sorted keys, so the same value hashes the same in the browser and on the server. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const json = JSON.stringify(value);
    return json === undefined ? "null" : json;
  }
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined || typeof item === "function" ? "null" : stableStringify(item))).join(",")}]`;
  const entries = Object.keys(value)
    .sort()
    .flatMap((key) => {
      const item = (value as Record<string, unknown>)[key];
      return item === undefined || typeof item === "function" ? [] : [`${JSON.stringify(key)}:${stableStringify(item)}`];
    });
  return `{${entries.join(",")}}`;
}

/** Two independent 32-bit hashes (FNV-1a and djb2) plus the length. Not cryptographic. */
export function contentHash(text: string) {
  let fnv = 0x811c9dc5;
  let djb = 5381;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    fnv = Math.imul(fnv ^ code, 0x01000193);
    djb = (Math.imul(djb, 33) + code) | 0;
  }
  return `${(fnv >>> 0).toString(16)}${(djb >>> 0).toString(16)}:${text.length}`;
}

function slidesOf(doc: unknown): Record<string, unknown>[] {
  return isRecord(doc) && Array.isArray(doc.slides) ? doc.slides.filter(isRecord) : [];
}

function slideFingerprint(slides: Record<string, unknown>[], slideId: string) {
  const slide = slides.find((item) => item.id === slideId);
  return slide ? contentHash(stableStringify(slide)) : ABSENT;
}

function orderFingerprint(slides: Record<string, unknown>[]) {
  return contentHash(slides.map((slide) => String(slide.id)).join("\n"));
}

/**
 * Fingerprints of every slide a proposal touches (its target, slides named by commands and
 * slides that own the elements it changes), plus the slide order when it inserts slides.
 */
export function proposalBaseline(doc: unknown, targetSlideId: string, commands: unknown[]): Record<string, string> {
  const slides = slidesOf(doc);
  const slideIds = new Set<string>([targetSlideId]);
  let dependsOnOrder = false;
  const visit = (command: unknown, depth: number) => {
    if (!isRecord(command) || depth > 8) return;
    if (typeof command.slideId === "string") slideIds.add(command.slideId);
    if (typeof command.elementId === "string") {
      const owner = slides.find((slide) => Array.isArray(slide.elements) && slide.elements.some((element) => isRecord(element) && element.id === command.elementId));
      if (typeof owner?.id === "string") slideIds.add(owner.id);
    }
    if (command.type === "slide.add") dependsOnOrder = true;
    if (Array.isArray(command.commands)) for (const nested of command.commands) visit(nested, depth + 1);
  };
  for (const command of commands) visit(command, 0);
  const baseline: Record<string, string> = {};
  for (const id of slideIds) baseline[id] = slideFingerprint(slides, id);
  if (dependsOnOrder) baseline[ORDER_KEY] = orderFingerprint(slides);
  return baseline;
}

/** True when any slide the proposal was prepared against has changed since. */
export function proposalIsStale(doc: unknown, baseline: Record<string, string>) {
  const slides = slidesOf(doc);
  return Object.entries(baseline).some(([id, fingerprint]) => (id === ORDER_KEY ? orderFingerprint(slides) : slideFingerprint(slides, id)) !== fingerprint);
}

// ---------------------------------------------------------------------------
// Safe error text
// ---------------------------------------------------------------------------

/** An error whose message was written for the user (tool limits, budgets). */
export class ChatUserError extends Error {
  override readonly name = "ChatUserError";
}

const AI_ERROR_CODES = new Set(["not_configured", "refused", "invalid_output", "rate_limited", "auth", "unavailable", "bad_request"]);
const SAFE_TRPC_CODES =new Set(["BAD_REQUEST", "TOO_MANY_REQUESTS", "PRECONDITION_FAILED", "NOT_FOUND"]);

/**
 * Map model, provider and tool failures to short messages that never include provider response
 * bodies, URLs or stack traces. Log the original error on the server.
 */
export function safeChatErrorMessage(error: unknown): string {
  if (error instanceof ChatUserError) return error.message.slice(0, 300);
  if (!error || typeof error !== "object") return "The AI model couldn't answer. Try again.";
  const record = error as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : "";
  const message = typeof record.message === "string" ? record.message : "";
  // AiError (from @Kavero/ai) and the TRPCError the AI service wraps it in carry user-facing text.
  // (Duck-typed so this module stays free of provider SDK imports for the browser.)
  if (typeof record.code === "string" && AI_ERROR_CODES.has(record.code)) return message.slice(0, 300);
  if (name === "TRPCError" && typeof record.code === "string" && SAFE_TRPC_CODES.has(record.code)) return message.slice(0, 300);
  if (name === "AbortError" || name === "TimeoutError" || /aborted|timed? ?out/i.test(name)) return "The reply took too long and was stopped. Try a smaller request.";
  const status = typeof record.statusCode === "number" ? record.statusCode : typeof record.status === "number" ? record.status : undefined;
  if (status === 401 || status === 403) return "Your AI provider rejected the API key. Check it in Settings → AI.";
  if (status === 402) return "Your AI provider account has no credits left.";
  if (status === 404) return "The AI model wasn't found. Check the model in Settings → AI.";
  if (status === 408 || status === 504) return "The AI provider took too long to answer. Try again.";
  if (status === 413 || (status === 400 && /context|too long|too many tokens|maximum.*tokens|prompt is too long/i.test(message))) {
    return "This conversation is too long for the model. Start a new chat.";
  }
  if (status === 429) return "The AI provider is busy (rate limited). Try again in a minute.";
  if (status !== undefined && status >= 500) return "The AI provider is unavailable right now. Try again shortly.";
  if (status === 400) return "The AI provider rejected the request. Try rephrasing it or start a new chat.";
  return "The AI model couldn't answer. Try again.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
