import type { CatalogDocument, Product } from "./schema";

export interface ProductUsage {
  slideId: string;
  slideIndex: number;
  slideName: string;
  elementId: string;
  elementType: "product" | "product-grid";
}

/** Every product card and grid that shows a product, in slide order. */
export function productUsage(doc: CatalogDocument, productId: string): ProductUsage[] {
  const out: ProductUsage[] = [];
  doc.slides.forEach((slide, slideIndex) => {
    for (const el of slide.elements) {
      const uses = el.type === "product" ? el.content.productId === productId
        : el.type === "product-grid" ? el.content.products.some((p) => p.productId === productId)
        : false;
      if (uses) out.push({ slideId: slide.id, slideIndex, slideName: slide.name, elementId: el.id, elementType: el.type as ProductUsage["elementType"] });
    }
  });
  return out;
}

/** Localized money string, or null when there is no amount. Falls back to a plain number for unknown currencies. */
export function formatMoney(amount: number | undefined, currency: string, language: string): string | null {
  if (amount === undefined || !Number.isFinite(amount)) return null;
  try {
    return new Intl.NumberFormat(language, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** Whole-percent discount when the compare-at price is higher than the price. */
export function discountPercent(p: Pick<Product, "price" | "compareAtPrice">): number | null {
  if (p.price === undefined || p.compareAtPrice === undefined || p.compareAtPrice <= p.price || p.compareAtPrice <= 0) return null;
  return Math.round((1 - p.price / p.compareAtPrice) * 100);
}

/** Text search over the fields people look products up by. */
export function matchesProduct(p: Product, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [p.name, p.sku, p.category, p.brand, p.subtitle, ...(p.tags ?? [])].some((v) => v?.toLowerCase().includes(q));
}
