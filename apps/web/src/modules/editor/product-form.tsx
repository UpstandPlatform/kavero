"use client";

import { AVAILABILITY_LABELS, PRODUCT_AVAILABILITY, productSchema, productUsage, type CatalogDocument, type Product } from "@Kavero/catalog-engine";
import type { Editor } from "@Kavero/editor-core";
import { Button } from "@Kavero/ui/components/button";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ImagePlus, Images, Loader2, Plus, Star, Trash2, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ProductThumb } from "./product-picker";
import { useRun } from "./use-catalog-editor";

const COMMON_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CNY", "CAD", "AUD", "CHF", "SEK", "NOK", "DKK", "PLN", "TRY", "AED", "SAR", "IRR", "INR", "BRL", "MXN", "ZAR", "KRW", "SGD", "HKD", "NZD"];
/** Every ISO currency the browser knows, falling back to a short list. */
function currencyCodes(): string[] {
  try {
    const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("currency");
    if (all?.length) return all;
  } catch {
    // Older engines.
  }
  return COMMON_CURRENCIES;
}

const BADGE_SUGGESTIONS = ["New", "Sale", "Bestseller", "Limited", "Eco", "Exclusive"];

const field = "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring aria-invalid:border-destructive";

type Spec = { key: string; value: string };

interface Draft {
  name: string; subtitle: string; brand: string; category: string; sku: string;
  price: string; compareAtPrice: string; currency: string; unit: string;
  badge: string; availability: string; rating: string; url: string; description: string; tags: string;
  images: string[]; specs: Spec[];
}

const str = (n: number | undefined) => (n === undefined ? "" : String(n));

function toDraft(p: Product | undefined): Draft {
  return {
    name: p?.name ?? "", subtitle: p?.subtitle ?? "", brand: p?.brand ?? "", category: p?.category ?? "", sku: p?.sku ?? "",
    price: str(p?.price), compareAtPrice: str(p?.compareAtPrice), currency: p?.currency ?? "", unit: p?.unit ?? "",
    badge: p?.badge ?? "", availability: p?.availability ?? "", rating: str(p?.rating), url: p?.url ?? "", description: p?.description ?? "",
    tags: (p?.tags ?? []).join(", "), images: [...(p?.imageAssetIds ?? [])],
    specs: Object.entries(p?.attributes ?? {}).map(([key, value]) => ({ key, value })),
  };
}

/** Empty text → undefined so clearing a field removes it. */
const opt = (v: string) => (v.trim() ? v.trim() : undefined);

function parseNumber(v: string, label: string, errors: Record<string, string>, key: string, check?: (n: number) => string | null) {
  if (!v.trim()) return undefined;
  const n = Number(v.replace(",", "."));
  if (!Number.isFinite(n)) {
    errors[key] = `${label} must be a number`;
    return undefined;
  }
  const problem = check?.(n);
  if (problem) errors[key] = problem;
  return n;
}

/**
 * Create or edit a product: everything a product card can show.
 * Saving is one undoable step; uploaded images are stored like other catalog images.
 */
export function ProductFormDialog({ editor, doc, productId, assetUrls, uploadImage, onClose, onSaved }: {
  editor: Editor;
  doc: CatalogDocument;
  /** Undefined creates a new product. */
  productId?: string;
  assetUrls: Record<string, string>;
  uploadImage: (f: File) => Promise<{ assetId: string }>;
  onClose: () => void;
  onSaved?: (productId: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const run = useRun(editor);
  const existing = productId ? doc.products.find((p) => p.id === productId) : undefined;
  const [d, setD] = useState<Draft>(() => toDraft(existing));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const uid = useId();
  const currencies = useMemo(currencyCodes, []);
  const usage = productId ? productUsage(doc, productId) : [];
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  useEffect(() => ref.current?.showModal(), []);

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        const { assetId } = await uploadImage(f);
        setD((x) => (x.images.includes(assetId) ? x : { ...x, images: [...x.images, assetId] }));
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const moveImage = (i: number, by: number) => setD((x) => {
    const images = [...x.images];
    const j = i + by;
    if (j < 0 || j >= images.length) return x;
    [images[i], images[j]] = [images[j]!, images[i]!];
    return { ...x, images };
  });
  const moveSpec = (i: number, by: number) => setD((x) => {
    const specs = [...x.specs];
    const j = i + by;
    if (j < 0 || j >= specs.length) return x;
    [specs[i], specs[j]] = [specs[j]!, specs[i]!];
    return { ...x, specs };
  });

  function save() {
    const e: Record<string, string> = {};
    if (!d.name.trim()) e.name = "Name is required";
    const price = parseNumber(d.price, "Price", e, "price", (n) => (n < 0 ? "Price can't be negative" : null));
    const compareAtPrice = parseNumber(d.compareAtPrice, "Compare-at price", e, "compareAtPrice", (n) => (n < 0 ? "Can't be negative" : null));
    const rating = parseNumber(d.rating, "Rating", e, "rating", (n) => (n < 0 || n > 5 ? "Rating must be between 0 and 5" : null));
    const url = opt(d.url);
    if (url && !/^https?:\/\//i.test(url)) e.url = "Use a full link starting with https://";
    const attributes: Record<string, string> = {};
    for (const s of d.specs) {
      const k = s.key.trim();
      if (!k && !s.value.trim()) continue;
      if (!k) { e.specs = "Every spec needs a name"; break; }
      if (k in attributes) { e.specs = `"${k}" is listed twice`; break; }
      attributes[k] = s.value.trim();
    }
    const tags = [...new Set(d.tags.split(",").map((t) => t.trim()).filter(Boolean))];
    const product = {
      id: productId, name: d.name.trim(), subtitle: opt(d.subtitle), brand: opt(d.brand), category: opt(d.category), sku: opt(d.sku),
      price, compareAtPrice, currency: opt(d.currency), unit: opt(d.unit), badge: opt(d.badge),
      availability: opt(d.availability) as Product["availability"], rating, url, description: opt(d.description),
      tags: tags.length ? tags : undefined, imageAssetIds: d.images, attributes,
    };
    if (!Object.keys(e).length) {
      // Same rules the document enforces (lengths, link schemes…).
      const check = productSchema.safeParse({ ...product, id: productId ?? "new" });
      if (!check.success) for (const i of check.error.issues) e[String(i.path[0] ?? "name")] ??= i.message;
    }
    setErrors(e);
    if (Object.keys(e).length) {
      // Focus the first invalid field.
      requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus());
      return;
    }
    const r = run({ type: "product.upsert", product });
    if (!r) return;
    const id = productId ?? r.createdIds[0];
    toast.success(productId ? "Product saved" : "Product added");
    onClose();
    if (id) onSaved?.(id);
  }

  const err = (k: string) => (errors[k] ? <span id={`${uid}-${k}-err`} className="text-[11px] text-destructive">{errors[k]}</span> : null);
  const a11y = (k: string) => ({ "aria-invalid": !!errors[k] || undefined, "aria-describedby": errors[k] ? `${uid}-${k}-err` : undefined });
  const libraryImages = doc.assets.filter((a) => a.kind === "image" && !d.images.includes(a.id) && assetUrls[a.id]);

  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby={`${uid}-title`} className="m-auto w-[min(820px,calc(100vw-32px))] overflow-hidden rounded-xl border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50">
      <form
        noValidate
        onSubmit={(e) => { e.preventDefault(); save(); }}
        className="flex max-h-[min(88vh,900px)] flex-col"
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 id={`${uid}-title`} className="text-sm font-semibold">{existing ? `Edit product` : "New product"}</h2>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close"><X /></Button>
        </div>

        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 text-xs md:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
          {/* Images */}
          <section aria-labelledby={`${uid}-img`} className="grid content-start gap-2">
            <h3 id={`${uid}-img`} className="font-semibold">Images</h3>
            {d.images.length === 0 ? (
              <div className="grid aspect-square place-items-center rounded-lg border border-dashed text-center text-muted-foreground">
                <p className="px-4">No images yet. The first image is the one cards show.</p>
              </div>
            ) : (
              <ol className="grid grid-cols-2 gap-2">
                {d.images.map((id, i) => (
                  <li key={id} className="group relative overflow-hidden rounded-lg border bg-muted/40">
                    {assetUrls[id]
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={assetUrls[id]} alt={`Image ${i + 1}`} className="aspect-square w-full object-contain" />
                      : <div className="grid aspect-square place-items-center text-muted-foreground">Missing</div>}
                    {i === 0 && <span className="absolute start-1 top-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">Primary</span>}
                    <div className="absolute inset-x-0 bottom-0 flex justify-center gap-0.5 bg-background/85 p-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      {i > 0 && <Button type="button" variant="ghost" size="icon-xs" title="Make primary" aria-label={`Make image ${i + 1} primary`} onClick={() => setD((x) => ({ ...x, images: [id, ...x.images.filter((v) => v !== id)] }))}><Star /></Button>}
                      <Button type="button" variant="ghost" size="icon-xs" title="Move earlier" aria-label={`Move image ${i + 1} earlier`} disabled={i === 0} onClick={() => moveImage(i, -1)}><ArrowLeft className="rtl:rotate-180" /></Button>
                      <Button type="button" variant="ghost" size="icon-xs" title="Move later" aria-label={`Move image ${i + 1} later`} disabled={i === d.images.length - 1} onClick={() => moveImage(i, 1)}><ArrowRight className="rtl:rotate-180" /></Button>
                      <Button type="button" variant="ghost" size="icon-xs" title="Remove image" aria-label={`Remove image ${i + 1}`} onClick={() => setD((x) => ({ ...x, images: x.images.filter((v) => v !== id) }))}><Trash2 /></Button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <input ref={fileInput} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
            <div className="flex flex-wrap gap-1">
              <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileInput.current?.click()}>
                {uploading ? <Loader2 className="animate-spin" /> : <ImagePlus />} Upload
              </Button>
              {libraryImages.length > 0 && (
                <Button type="button" variant="outline" size="sm" aria-expanded={libraryOpen} onClick={() => setLibraryOpen((o) => !o)}><Images /> From catalog</Button>
              )}
            </div>
            {libraryOpen && (
              <div className="grid max-h-48 grid-cols-4 gap-1 overflow-y-auto rounded-lg border p-1" role="group" aria-label="Images already in this catalog">
                {libraryImages.map((a) => (
                  <button key={a.id} type="button" title={`Add ${a.name}`} aria-label={`Add ${a.name}`} className="overflow-hidden rounded border hover:ring-2 hover:ring-ring focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setD((x) => ({ ...x, images: [...x.images, a.id] }))}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={assetUrls[a.id]} alt="" className="aspect-square w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
            {usage.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                Shown on {usage.length === 1 ? "1 card" : `${usage.length} cards`}: {[...new Set(usage.map((u) => `slide ${u.slideIndex + 1}`))].join(", ")}. Changes update them all.
              </p>
            )}
          </section>

          <div className="grid content-start gap-4">
            <Group title="Basics">
              <Labeled label="Name" required error={err("name")}>
                <input className={field} value={d.name} autoFocus aria-required="true" onChange={(e) => set("name", e.target.value)} maxLength={200} {...a11y("name")} />
              </Labeled>
              <Labeled label="Subtitle" hint="Short tagline under the name" error={err("subtitle")}>
                <input className={field} value={d.subtitle} onChange={(e) => set("subtitle", e.target.value)} maxLength={200} {...a11y("subtitle")} />
              </Labeled>
              <div className="grid gap-3 sm:grid-cols-3">
                <Labeled label="Brand" error={err("brand")}><input className={field} value={d.brand} onChange={(e) => set("brand", e.target.value)} maxLength={100} {...a11y("brand")} /></Labeled>
                <Labeled label="Category">
                  <input className={field} value={d.category} list={`${uid}-cats`} onChange={(e) => set("category", e.target.value)} />
                  <datalist id={`${uid}-cats`}>{[...new Set(doc.products.map((p) => p.category).filter(Boolean))].map((c) => <option key={c} value={c} />)}</datalist>
                </Labeled>
                <Labeled label="SKU"><input className={field} value={d.sku} onChange={(e) => set("sku", e.target.value)} /></Labeled>
              </div>
            </Group>

            <Group title="Price">
              <div className="grid gap-3 sm:grid-cols-2">
                <Labeled label="Price" error={err("price")}>
                  <input className={field} inputMode="decimal" value={d.price} onChange={(e) => set("price", e.target.value)} placeholder="0.00" {...a11y("price")} />
                </Labeled>
                <Labeled label="Compare-at price" hint="Original price, shown struck through" error={err("compareAtPrice")}>
                  <input className={field} inputMode="decimal" value={d.compareAtPrice} onChange={(e) => set("compareAtPrice", e.target.value)} placeholder="Optional" {...a11y("compareAtPrice")} />
                </Labeled>
                <Labeled label="Currency">
                  <select className={field} value={d.currency} onChange={(e) => set("currency", e.target.value)}>
                    <option value="">Catalog currency ({doc.metadata.currency})</option>
                    {[...new Set([...(d.currency ? [d.currency] : []), ...currencies])].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Labeled>
                <Labeled label="Unit" hint='e.g. "per m²" or "/ kg"' error={err("unit")}>
                  <input className={field} value={d.unit} onChange={(e) => set("unit", e.target.value)} maxLength={30} {...a11y("unit")} />
                </Labeled>
              </div>
            </Group>

            <Group title="Highlights">
              <div className="grid gap-3 sm:grid-cols-3">
                <Labeled label="Badge" hint="New, Sale…" error={err("badge")}>
                  <input className={field} value={d.badge} list={`${uid}-badges`} onChange={(e) => set("badge", e.target.value)} maxLength={30} {...a11y("badge")} />
                  <datalist id={`${uid}-badges`}>{BADGE_SUGGESTIONS.map((b) => <option key={b} value={b} />)}</datalist>
                </Labeled>
                <Labeled label="Availability">
                  <select className={field} value={d.availability} onChange={(e) => set("availability", e.target.value)}>
                    <option value="">Not shown</option>
                    {PRODUCT_AVAILABILITY.map((a) => <option key={a} value={a}>{AVAILABILITY_LABELS[a]}</option>)}
                  </select>
                </Labeled>
                <Labeled label="Rating (0–5)" error={err("rating")}>
                  <input className={field} type="number" min={0} max={5} step={0.1} value={d.rating} onChange={(e) => set("rating", e.target.value)} {...a11y("rating")} />
                </Labeled>
              </div>
              <Labeled label="Product link" error={err("url")}>
                <input className={field} type="url" value={d.url} onChange={(e) => set("url", e.target.value)} placeholder="https://" {...a11y("url")} />
              </Labeled>
            </Group>

            <Group title="Details">
              <Labeled label="Description">
                <textarea className={`${field} h-20 resize-y py-1.5`} value={d.description} onChange={(e) => set("description", e.target.value)} />
              </Labeled>
              <fieldset className="grid gap-1.5">
                <legend className="mb-1 text-muted-foreground">Specs <span className="text-[11px]">(shown on cards with “Specs” turned on)</span></legend>
                {d.specs.map((s, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <input className={`${field} w-2/5`} placeholder="Name, e.g. Size" aria-label={`Spec ${i + 1} name`} value={s.key}
                      onChange={(e) => setD((x) => ({ ...x, specs: x.specs.map((v, j) => (j === i ? { ...v, key: e.target.value } : v)) }))} />
                    <input className={field} placeholder="Value, e.g. 120 × 60 cm" aria-label={`Spec ${i + 1} value`} value={s.value}
                      onChange={(e) => setD((x) => ({ ...x, specs: x.specs.map((v, j) => (j === i ? { ...v, value: e.target.value } : v)) }))} />
                    <Button type="button" variant="ghost" size="icon-xs" title="Move up" aria-label={`Move spec ${i + 1} up`} disabled={i === 0} onClick={() => moveSpec(i, -1)}><ArrowUp /></Button>
                    <Button type="button" variant="ghost" size="icon-xs" title="Move down" aria-label={`Move spec ${i + 1} down`} disabled={i === d.specs.length - 1} onClick={() => moveSpec(i, 1)}><ArrowDown /></Button>
                    <Button type="button" variant="ghost" size="icon-xs" title="Remove spec" aria-label={`Remove spec ${i + 1}`} onClick={() => setD((x) => ({ ...x, specs: x.specs.filter((_, j) => j !== i) }))}><Trash2 /></Button>
                  </div>
                ))}
                {errors.specs && <span className="text-[11px] text-destructive" role="alert">{errors.specs}</span>}
                <div><Button type="button" variant="outline" size="xs" onClick={() => setD((x) => ({ ...x, specs: [...x.specs, { key: "", value: "" }] }))}><Plus /> Add spec</Button></div>
              </fieldset>
              <Labeled label="Tags" hint="Comma-separated, for search only">
                <input className={field} value={d.tags} onChange={(e) => set("tags", e.target.value)} placeholder="outdoor, oak" />
              </Labeled>
            </Group>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t px-5 py-3">
          {existing && <ProductThumb product={existing} assetUrls={assetUrls} className="size-6" />}
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{existing ? "Saving updates every card that shows this product." : "Only the name is required."}</span>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" disabled={uploading}>{existing ? "Save product" : "Add product"}</Button>
        </div>
      </form>
    </dialog>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <h3 className="font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function Labeled({ label, hint, required, error, children }: { label: string; hint?: string; required?: boolean; error?: ReactNode; children: ReactNode }) {
  return (
    <label className="grid min-w-0 content-start gap-1">
      <span className="text-muted-foreground">
        {label}{required && <span aria-hidden className="text-destructive"> *</span>}
        {hint && <span className="ms-1 text-[11px] opacity-80">· {hint}</span>}
      </span>
      {children}
      {error}
    </label>
  );
}
