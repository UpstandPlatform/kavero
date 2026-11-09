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
