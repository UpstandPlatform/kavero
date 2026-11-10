import * as engine from "@Kavero/catalog-engine";
import { TEMPLATES, type Product } from "@Kavero/catalog-engine";
import { z } from "zod";

export const SECTION_KINDS = ["cover", "intro", "category", "products", "product-detail", "comparison", "closing"] as const;

/** What the AI (or the offline planner) decides; turned into slides by buildCatalog. */
export const catalogPlanSchema = z.object({
  title: z.string().min(1).max(120),
  subtitle: z.string().max(200).optional(),
  templateId: z.string().max(60),
  sections: z
    .array(
      z.object({
        kind: z.enum(SECTION_KINDS),
        heading: z.string().max(140),
        body: z.string().max(600).optional(),
        /** Product ids shown in this section (products / product-detail / comparison). */
        productIds: z.array(z.string()).max(60).optional(),
      }),
    )
    .min(2)
    .max(40),
});
export type CatalogPlan = z.infer<typeof catalogPlanSchema>;
export type PlanSection = CatalogPlan["sections"][number];

export interface PlanInput {
  brief: string;
  products: Product[];
  /** Template id to use; otherwise inferred from the brief. */
  templateId?: string;
  language?: string;
}

const KEYWORDS: [RegExp, string][] = [
  [/luxur|jewel|watch|gold|diamond|fashion|apparel|leather|couture/i, "dark-luxury"],
  [/tech|electronic|gadget|phone|laptop|computer|device|audio/i, "tech"],
  [/furniture|sofa|chair|table|home|interior|wood|natural|organic|garden/i, "natural"],
];

/** Best template for a brief. Uses the catalog's template picker when available. */
export function chooseTemplate(brief: string, requested?: string): string {
  if (requested && TEMPLATES.some((t) => t.id === requested)) return requested;
  // The template library's own picker covers every category; keywords are a fallback.
  const picker = (engine as { pickTemplate?: (hint: string) => string }).pickTemplate;
  if (picker && brief.trim()) return picker(brief);
  for (const [re, id] of KEYWORDS) if (re.test(brief) && TEMPLATES.some((t) => t.id === id)) return id;
  return TEMPLATES[0]?.id ?? "minimal";
}

const chunk = <T,>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

function titleFromBrief(brief: string) {
  const first = brief.split(/[\n.!?]/)[0]?.trim() ?? "";
  const quoted = /["“](.+?)["”]/.exec(brief)?.[1];
  const t = quoted ?? (first.length > 3 && first.length <= 60 ? first : "");
  return t ? t.replace(/^(create|make|build|generate)( me)?( an?| the)?( catalog| catalogue| presentation)?( for| of| about)?\s*/i, "").replace(/^\w/, (c) => c.toUpperCase()) || "Product catalog" : "Product catalog";
}

/**
 * Offline planner: no model needed (local-first). Groups products by category
 * into sections, adds a featured product and a comparison where it helps.
 */
export function heuristicPlan(input: PlanInput): CatalogPlan {
  const { products } = input;
  const title = titleFromBrief(input.brief);
  const sections: PlanSection[] = [{ kind: "cover", heading: title, body: input.brief.length > 60 ? undefined : "Collection" }];
  if (input.brief.trim().length > 60) sections.push({ kind: "intro", heading: "About this collection", body: input.brief.trim().slice(0, 600) });

  const groups = new Map<string, Product[]>();
  for (const p of products) groups.set(p.category || "Products", [...(groups.get(p.category || "Products") ?? []), p]);

  const featured = [...products].filter((p) => p.price !== undefined).sort((a, b) => (b.price ?? 0) - (a.price ?? 0))[0] ?? products[0];
  if (featured) sections.push({ kind: "product-detail", heading: featured.name, body: featured.description, productIds: [featured.id] });

  for (const [name, items] of groups) {
    if (groups.size > 1) sections.push({ kind: "category", heading: name, body: `${items.length} product${items.length === 1 ? "" : "s"}` });
    for (const part of chunk(items, 6)) sections.push({ kind: "products", heading: name, productIds: part.map((p) => p.id) });
  }

  const priced = products.filter((p) => p.price !== undefined);
  if (priced.length >= 3) {
    const picks = [...priced].sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
    const trio = [picks[0]!, picks[Math.floor(picks.length / 2)]!, picks[picks.length - 1]!];
    sections.push({ kind: "comparison", heading: "Compare", productIds: [...new Set(trio.map((p) => p.id))] });
  }
  if (!products.length) sections.push({ kind: "products", heading: "Featured products", productIds: [] });
  sections.push({ kind: "closing", heading: "Thank you", body: "Get in touch to order." });
  return { title, templateId: chooseTemplate(input.brief, input.templateId), sections };
}

/** Make an AI plan safe to build: known template, existing products, cover first, closing last. */
export function normalizePlan(plan: CatalogPlan, products: Product[], fallbackTemplate: string): CatalogPlan {
  const ids = new Set(products.map((p) => p.id));
  const sections = plan.sections
    .map((s) => ({ ...s, productIds: s.productIds?.filter((id) => ids.has(id)) }))
    .flatMap((s) => (s.kind === "products" && (s.productIds?.length ?? 0) > 6 ? chunk(s.productIds!, 6).map((part) => ({ ...s, productIds: part })) : [s]))
    .filter((s) => !(["product-detail", "comparison"].includes(s.kind) && !s.productIds?.length));
  if (sections[0]?.kind !== "cover") sections.unshift({ kind: "cover", heading: plan.title, productIds: undefined });
  if (sections.at(-1)?.kind !== "closing") sections.push({ kind: "closing", heading: "Thank you", productIds: undefined });
  return { ...plan, templateId: TEMPLATES.some((t) => t.id === plan.templateId) ? plan.templateId : fallbackTemplate, sections };
}

export const PLANNER_SYSTEM = `You plan product catalogs for Kavero, a visual catalog builder. You output a JSON plan; Kavero turns it into designed, editable slides.

Section kinds:
- cover: catalog title and a short subtitle (first section).
- intro: a short paragraph about the brand or collection.
- category: a divider slide naming a product category.
- products: a grid of up to 6 products (list productIds).
- product-detail: one hero product (exactly one productId) with a persuasive description in body.
- comparison: 2–3 products side by side (productIds) to compare.
- closing: thank-you / call to action (last section).

Guidelines:
- Group products logically (by category, use, price tier). Every product should appear at least once unless the brief says otherwise.
- Use only productIds from the provided list. Never invent products or prices.
- Write headings and body copy in the requested language; keep copy concise and specific to the products; no placeholder text.
- Pick templateId from the provided list to match the brand mood.
- 6–20 sections is typical; more only for large product lists.`;

export function plannerPrompt(input: PlanInput, maxProducts = 300) {
  const shown = input.products.slice(0, maxProducts);
  const lines = shown.map((p) => [
    p.id,
    p.brand ? `${p.brand} ${p.name}` : p.name,
    p.category ?? "",
    p.price !== undefined ? `${p.price}${p.currency ? ` ${p.currency}` : ""}${p.unit ? ` ${p.unit}` : ""}${p.compareAtPrice !== undefined && p.compareAtPrice > p.price ? ` (was ${p.compareAtPrice})` : ""}` : "",
    [p.badge && `[${p.badge}]`, p.subtitle, p.description].filter(Boolean).join(" — ").slice(0, 160),
  ].join(" | "));
  return [
    `Brief:\n${input.brief.trim() || "(none)"}`,
    `Language: ${input.language ?? "en"}`,
    `Templates: ${TEMPLATES.map((t) => `${t.id} (${t.category}: ${t.description})`).join("; ")}${input.templateId ? `\nThe user chose template: ${input.templateId}` : ""}`,
    `Products (${input.products.length}${input.products.length > shown.length ? `, first ${shown.length} shown` : ""}) as id | name | category | price | description:\n${lines.join("\n") || "(no products: plan a catalog with sections the user can fill in)"}`,
  ].join("\n\n");
}
