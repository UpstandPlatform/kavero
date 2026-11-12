import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";

import { isLoopbackAddress, isPrivateAddress } from "@Kavero/catalog-engine";

export { isPrivateAddress };
export const isLoopback = isLoopbackAddress;

export interface UrlGuardOptions {
  /** Development: allow loopback (local MCP / model servers). LAN and metadata addresses stay blocked. */
  allowLocal?: boolean;
}

const blockedAddress = (ip: string, opts: UrlGuardOptions) => isPrivateAddress(ip) && !(opts.allowLocal && isLoopbackAddress(ip));
const PRIVATE_MESSAGE = "That address points to a private network, which isn't allowed";

/**
 * Guards server-side requests to user-supplied URLs (SSRF): only http(s), and
 * never to private, loopback, link-local or cloud-metadata addresses — unless
 * `allowLocal` (development, so local MCP servers can be tested).
 * A pre-flight check only: use `safeFetch` to also pin the check to the connection.
 */
export async function assertPublicUrl(raw: string, opts: UrlGuardOptions = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Enter a full URL, e.g. https://example.com/mcp");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http and https URLs are supported");
  if (url.username || url.password) throw new Error("Put credentials in the authentication fields, not the URL");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => { throw new Error(`Can't resolve ${host}`); })).map((a) => a.address);
  if (!addresses.length || addresses.some((a) => blockedAddress(a, opts))) throw new Error(PRIVATE_MESSAGE);
  if (url.protocol !== "https:" && !(opts.allowLocal && addresses.every(isLoopbackAddress))) throw new Error("Use https for remote servers");
  return url;
}

/**
 * DNS lookup for outgoing sockets that refuses private results. Because it runs
 * at connect time it covers every connection (DNS rebinding between the
 * pre-flight check and the request, redirects, keep-alive reconnects).
 */
export function guardedLookup(opts: UrlGuardOptions = {}): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
      if (err) return callback(err, "", 0);
      const bad = addresses.find((a) => blockedAddress(a.address, opts));
      if (bad || !addresses.length) return callback(Object.assign(new Error(PRIVATE_MESSAGE), { code: "EPRIVATE" }), "", 0);
      if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
      callback(null, addresses[0]!.address, addresses[0]!.family);
    });
  };
}

const NULL_BODY = new Set([101, 204, 205, 304]);

/**
 * fetch() for user-supplied URLs: pre-flight check plus a guarded DNS lookup on
 * the actual socket. Never follows redirects (3xx is returned as is, like
 * `redirect: "manual"`); callers that follow one must call safeFetch again.
 * Request bodies: string, bytes or URLSearchParams.
 */
export async function safeFetch(input: string | URL, init: RequestInit = {}, opts: UrlGuardOptions = {}): Promise<Response> {
  const url = await assertPublicUrl(input.toString(), opts);
  const signal = init.signal ?? undefined;
  signal?.throwIfAborted();
  const headers = new Headers(init.headers);
  let body: Buffer | undefined;
  if (init.body != null) {
    if (typeof init.body === "string" || init.body instanceof URLSearchParams) body = Buffer.from(init.body.toString());
    else if (init.body instanceof ArrayBuffer) body = Buffer.from(init.body);
    else if (ArrayBuffer.isView(init.body)) body = Buffer.from(init.body.buffer, init.body.byteOffset, init.body.byteLength);
    else throw new Error("Unsupported request body");
    if (init.body instanceof URLSearchParams && !headers.has("content-type")) headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
    headers.set("content-length", String(body.byteLength));
  }
  const method = (init.method ?? "GET").toUpperCase();
  const client = url.protocol === "https:" ? https : http;

  return new Promise<Response>((resolve, reject) => {
    // agent: false → a fresh socket per request, so a pooled keep-alive socket can never skip the lookup check.
    const req = client.request(url, { method, headers: Object.fromEntries(headers), lookup: guardedLookup(opts), agent: false }, (res) => {
      const status = res.statusCode ?? 502;
      const out = new Headers();
      for (const [k, v] of Object.entries(res.headers)) for (const item of Array.isArray(v) ? v : v === undefined ? [] : [v]) out.append(k, item);
      const hasBody = !NULL_BODY.has(status) && method !== "HEAD";
      if (!hasBody) res.resume();
      resolve(new Response(hasBody ? (Readable.toWeb(res) as ReadableStream<Uint8Array>) : null, { status, statusText: res.statusMessage, headers: out }));
    });
    const abort = () => req.destroy(signal?.reason instanceof Error ? signal.reason : new Error("The operation was aborted"));
    signal?.addEventListener("abort", abort, { once: true });
    req.on("close", () => signal?.removeEventListener("abort", abort));
    req.on("error", reject);
    req.end(body);
  });
}

const MAX_REDIRECTS = 5;

/** Download an image from a public URL with size and type limits; returns a data: URL. */
export async function fetchImageAsDataUrl(raw: string, opts: UrlGuardOptions & { maxBytes?: number } = {}): Promise<string> {
  const max = opts.maxBytes ?? 8 * 1024 * 1024;
  const signal = AbortSignal.timeout(15_000);
  let url = raw;
  let res: Response;
  // Follow redirects by hand so every hop goes through the guard again.
  for (let hop = 0; ; hop++) {
    res = await safeFetch(url, { signal, headers: { Accept: "image/*" } }, opts);
    if (res.status < 300 || res.status >= 400) break;
    await res.body?.cancel().catch(() => undefined);
    const next = res.headers.get("location");
    if (!next) throw new Error("Bad redirect");
    if (hop >= MAX_REDIRECTS) throw new Error("Too many redirects");
    url = new URL(next, url).toString();
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
  if (!/^image\/(png|jpe?g|gif|webp|avif)$/.test(type)) throw new Error(`Not a supported image (${type || "unknown type"})`);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > max) throw new Error("Image too large");
  return `data:${type};base64,${Buffer.from(await readLimited(res.body, max, "Image too large")).toString("base64")}`;
}

/** Read a body stream, aborting as soon as it passes `max` bytes (never buffers more). */
export async function readLimited(body: ReadableStream<Uint8Array> | null, max: number, message = "Too large"): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = body?.getReader();
  if (!reader) return new Uint8Array();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new Error(message);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Wrap a response so its body errors as soon as it passes `max` bytes. Unlike readLimited this
 * keeps the body streaming, so it also bounds long-lived streams (SSE) consumed by other code.
 */
export function limitResponseBody(res: Response, max: number, message = "The response is too large"): Response {
  if (!res.body) return res;
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > max) {
    void res.body.cancel().catch(() => undefined);
    throw new Error(message);
  }
  let total = 0;
  const limited = res.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > max) controller.error(new Error(message));
      else controller.enqueue(chunk);
    },
  }));
  return new Response(limited, { status: res.status, statusText: res.statusText, headers: res.headers });
}

/** Run `work` over `items` with at most `concurrency` in flight, keeping result order. */
export async function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface ImageBatchOptions extends UrlGuardOptions {
  /** Parallel downloads. Default 4. */
  concurrency?: number;
  /** Largest single image in bytes. Default 8 MB. */
  maxImageBytes?: number;
  /** Total decoded bytes across the batch. Default 32 MB. */
  maxTotalBytes?: number;
  /** Injected for tests. */
  fetchImage?: (url: string, opts: UrlGuardOptions & { maxBytes: number }) => Promise<string>;
}

/** Decoded byte size of a base64 data: URL. */
function dataUrlBytes(dataUrl: string) {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
}

/**
 * Download a batch of images with bounded concurrency and a total byte budget. Each download
 * reserves its maximum size from the budget before it starts, so memory use stays bounded even
 * while several downloads run at once.
 */
export async function fetchImagesWithBudget(urls: readonly string[], opts: ImageBatchOptions = {}) {
  const perImage = opts.maxImageBytes ?? 8 * 1024 * 1024;
  let remaining = opts.maxTotalBytes ?? 32 * 1024 * 1024;
  const fetchImage = opts.fetchImage ?? fetchImageAsDataUrl;
  return mapWithConcurrency(urls, opts.concurrency ?? 4, async (url): Promise<{ url: string; dataUrl: string } | { url: string; error: string }> => {
    const reserved = Math.min(perImage, remaining);
    if (reserved <= 0) return { url, error: "The images in this request are too large in total; import fewer at a time" };
    remaining -= reserved;
    try {
      const dataUrl = await fetchImage(url, { allowLocal: opts.allowLocal, maxBytes: reserved });
      remaining += reserved - Math.min(reserved, dataUrlBytes(dataUrl));
      return { url, dataUrl };
    } catch (e) {
      remaining += reserved;
      return { url, error: (e as Error).message };
    }
  });
}
