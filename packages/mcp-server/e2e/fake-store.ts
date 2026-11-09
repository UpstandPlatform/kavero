// A stand-in for an external store's MCP server (Streamable HTTP), with product images.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

const PORT = 4555;
const products = [
  ["Weekender Bag", "640.00", "Bags", "8B5A2B"], ["Tote", "320.00", "Bags", "A0522D"], ["Card Holder", "85.00", "Small leather goods", "C9A24B"],
  ["Wallet", "140.00", "Small leather goods", "6B4423"], ["Belt", "120.00", "Accessories", "3E2723"], ["Watch Strap", "95.00", "Accessories", "D2B48C"],
].map(([title, amount, type, color], i) => ({
  node: { id: `gid://shopify/Product/${100 + i}`, title, description: `<p>Handmade ${String(title).toLowerCase()}.</p>`, productType: type, handle: String(title).toLowerCase().replace(/ /g, "-"),
    priceRange: { minVariantPrice: { amount, currencyCode: "EUR" } }, featuredImage: { url: `http://127.0.0.1:${PORT}/img/${color}.png` } },
}));

// Tiny solid-colour PNG generator (uncompressed, valid zlib stored blocks).
function png(hex: string, size = 64) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const row = new Uint8Array(1 + size * 3); for (let x = 0; x < size; x++) row.set([r!, g!, b!], 1 + x * 3);
  const raw = new Uint8Array(row.length * size); for (let y = 0; y < size; y++) raw.set(row, y * row.length);
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (d: Uint8Array) => { let c = 0xffffffff; for (const v of d) c = crcTable[(c ^ v) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const u32 = (v: number) => [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const chunk = (type: string, data: Uint8Array) => { const t = new TextEncoder().encode(type); const td = new Uint8Array([...t, ...data]); return new Uint8Array([...u32(data.length), ...td, ...u32(crc(td))]); };
  let a = 1, b2 = 0; for (const v of raw) { a = (a + v) % 65521; b2 = (b2 + a) % 65521; }
  const blocks: number[] = [0x78, 0x01];
  for (let i = 0; i < raw.length; i += 65535) { const part = raw.subarray(i, i + 65535); const last = i + 65535 >= raw.length ? 1 : 0; blocks.push(last, part.length & 255, part.length >> 8, ~part.length & 255, (~part.length >> 8) & 255, ...part); }
  blocks.push(...u32(((b2 << 16) | a) >>> 0));
  const ihdr = new Uint8Array([...u32(size), ...u32(size), 8, 2, 0, 0, 0]);
  return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...chunk("IHDR", ihdr), ...chunk("IDAT", new Uint8Array(blocks)), ...chunk("IEND", new Uint8Array())]);
}

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/img/")) return new Response(png(url.pathname.slice(5, 11)), { headers: { "Content-Type": "image/png" } });
    if (url.pathname !== "/mcp") return new Response("not found", { status: 404 });
    if (req.headers.get("x-api-key") !== "store-key-123") return new Response("unauthorized", { status: 401 });
    const server = new McpServer({ name: "fake-store", version: "1.0.0" });
    server.registerTool("list_products", { description: "List products in the store", inputSchema: { first: z.number().int().default(24), productType: z.string().optional() } },
      async ({ first, productType }) => ({ content: [{ type: "text", text: JSON.stringify({ data: { products: { edges: products.filter((p) => !productType || p.node.productType === productType).slice(0, first) } } }) }] }));
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(req);
  },
});
console.log(`fake store MCP on http://127.0.0.1:${PORT}/mcp`);
