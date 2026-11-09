/**
 * Turns whatever an external MCP tool returned into Kavero products.
 * Tools differ wildly (Shopify, WooCommerce, custom), so this looks for the
 * first array of objects and maps common field names.
 */

export interface ExtractedProduct {
  id?: string;
  name: string;
  description?: string;
  sku?: string;
  price?: number;
  currency?: string;
  url?: string;
  category?: string;
  imageUrl?: string;
  attributes: Record<string, string>;
}

const pick = (o: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) {
    const v = k.split(".").reduce<unknown>((acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined), o);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : undefined);
const stripHtml = (v: string | undefined) => v?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function toPrice(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.,-]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : undefined;
  }
  if (v && typeof v === "object") return toPrice(pick(v as Record<string, unknown>, ["amount", "value", "price"]));
  return undefined;
}

function imageOf(o: Record<string, unknown>): string | undefined {
  const v = pick(o, ["image", "imageUrl", "image_url", "thumbnail", "featuredImage.url", "featured_image", "images", "media"]);
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length) {
    const first = v[0];
    return typeof first === "string" ? first : str(pick(first as Record<string, unknown>, ["src", "url", "originalSrc"]));
  }
  if (v && typeof v === "object") return str(pick(v as Record<string, unknown>, ["src", "url", "originalSrc"]));
  return undefined;
}

export function mapProduct(o: Record<string, unknown>): ExtractedProduct | null {
  const name = str(pick(o, ["name", "title", "productName", "product_name", "label"]));
  if (!name) return null;
  const priceRaw = pick(o, ["price", "price.amount", "priceRange.minVariantPrice.amount", "variants.0.price", "regular_price", "unit_price", "cost"]);
  const currency = str(pick(o, ["currency", "currencyCode", "price.currency", "price.currencyCode", "priceRange.minVariantPrice.currencyCode"]));
  const attributes: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    if (["string", "number", "boolean"].includes(typeof v) && !/^(id|name|title|description|body_html|price|currency|sku|url|link|handle|image|category|type)$/i.test(k) && String(v).length < 200) {
      attributes[k] = String(v);
    }
    if (Object.keys(attributes).length >= 12) break;
  }
  return {
    id: str(pick(o, ["id", "productId", "product_id", "gid"])),
    name: name.slice(0, 200),
    description: stripHtml(str(pick(o, ["description", "body_html", "bodyHtml", "short_description", "summary"])))?.slice(0, 2000),
    sku: str(pick(o, ["sku", "variants.0.sku", "code"])),
    price: toPrice(priceRaw),
    currency: currency && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : undefined,
    url: str(pick(o, ["url", "link", "permalink", "onlineStoreUrl", "product_url"])),
    category: str(pick(o, ["category", "product_type", "productType", "type", "categories.0.name", "collection"])),
    imageUrl: imageOf(o),
    attributes,
  };
}

/** Find the most product-like array of objects anywhere in a value. */
function findArray(v: unknown, depth = 0): Record<string, unknown>[] | null {
  if (depth > 5 || v === null || typeof v !== "object") return null;
  if (Array.isArray(v)) {
    const objs = v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x));
    if (objs.length && objs.some((o) => mapProduct(o))) return objs;
    // GraphQL style: [{ node: {...} }]
    const nodes = objs.map((o) => o.node).filter((n): n is Record<string, unknown> => !!n && typeof n === "object");
    if (nodes.length) return nodes;
    return null;
  }
  const entries = Object.values(v as Record<string, unknown>);
  for (const e of entries) {
    const found = findArray(e, depth + 1);
    if (found) return found;
  }
  // A single product object
  return depth === 0 && mapProduct(v as Record<string, unknown>) ? [v as Record<string, unknown>] : null;
}

export function extractProducts(result: { content?: { type: string; text?: string }[]; structuredContent?: unknown }): ExtractedProduct[] {
  const candidates: unknown[] = [];
  if (result.structuredContent) candidates.push(result.structuredContent);
  for (const c of result.content ?? []) {
    if (c.type !== "text" || !c.text) continue;
    try {
      candidates.push(JSON.parse(c.text));
    } catch {
      // Not JSON; skip.
    }
  }
  for (const c of candidates) {
    const arr = findArray(c);
    if (arr) return arr.map(mapProduct).filter((p): p is ExtractedProduct => !!p).slice(0, 500);
  }
  return [];
}
