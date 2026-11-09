import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Guards server-side requests to user-supplied URLs (SSRF): only http(s), and
 * never to private, loopback, link-local or cloud-metadata addresses — unless
 * `allowLocal` (development, so local MCP servers can be tested).
 */
export async function assertPublicUrl(raw: string, opts: { allowLocal?: boolean } = {}): Promise<URL> {
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
  const loopback = addresses.every(isLoopback);
  const blocked = addresses.some((a) => isPrivateAddress(a) && !(opts.allowLocal && isLoopback(a)));
  // allowLocal (development) opens loopback only; LAN and cloud-metadata addresses stay blocked.
  if (blocked) throw new Error("That address points to a private network, which isn't allowed");
  if (url.protocol !== "https:" && !(opts.allowLocal && loopback)) throw new Error("Use https for remote servers");
  return url;
}

export function isLoopback(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^::ffff:/, "");
  return v === "::1" || v.startsWith("127.");
}

export function isPrivateAddress(ip: string): boolean {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb");
  }
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return (
    a === 10 || a === 127 || a === 0 ||
    (a === 169 && b === 254) || // link-local incl. cloud metadata 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    a >= 224
  );
}

/** Download an image from a public URL with size and type limits; returns a data: URL. */
export async function fetchImageAsDataUrl(raw: string, opts: { allowLocal?: boolean; maxBytes?: number } = {}): Promise<string> {
  const url = await assertPublicUrl(raw, opts);
  const max = opts.maxBytes ?? 8 * 1024 * 1024;
  const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { Accept: "image/*" } });
  if (res.status >= 300 && res.status < 400) {
    const next = res.headers.get("location");
    if (!next) throw new Error("Bad redirect");
    // Re-check the redirect target (one hop) instead of following blindly.
    return fetchImageAsDataUrl(new URL(next, url).toString(), { ...opts, maxBytes: max });
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
  if (!/^image\/(png|jpe?g|gif|webp|avif)$/.test(type)) throw new Error(`Not a supported image (${type || "unknown type"})`);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > max) throw new Error("Image too large");
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > max) throw new Error("Image too large");
  return `data:${type};base64,${Buffer.from(buf).toString("base64")}`;
}
