"use client";

import { formatMoney, matchesProduct, type CatalogDocument, type Product } from "@Kavero/catalog-engine";
import { Button } from "@Kavero/ui/components/button";
import { ArrowDown, ArrowUp, PackagePlus, Package, Plus, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

/** Opens the shared product picker and product form; implemented by the editor shell. */
export interface ProductUi {
  pick(options: PickOptions): void;
  /** Edit a product, or create one when `productId` is undefined. */
  edit(productId?: string, onSaved?: (productId: string) => void): void;
  import(): void;
}

export interface PickOptions {
  multiple: boolean;
  /** Already chosen product ids, in order. */
  initial?: string[];
  title: string;
  confirmLabel: string;
  onConfirm: (productIds: string[]) => void;
}

export function ProductThumb({ product, assetUrls, className = "size-10" }: { product: Product; assetUrls: Record<string, string>; className?: string }) {
  const src = product.imageAssetIds[0] ? assetUrls[product.imageAssetIds[0]] : undefined;
  return (
    <span className={`grid shrink-0 place-items-center overflow-hidden rounded-md border bg-muted/50 text-muted-foreground ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt="" className="size-full object-contain" /> : <Package className="size-1/2" aria-hidden />}
    </span>
  );
}

export function productPrice(doc: CatalogDocument, p: Product): string | null {
  return formatMoney(p.price, p.currency ?? doc.metadata.currency, doc.metadata.language);
}

export function NoProducts({ onNew, onImport, compact }: { onNew: () => void; onImport: () => void; compact?: boolean }) {
  return (
    <div className={`grid justify-items-center gap-2 text-center text-xs text-muted-foreground ${compact ? "px-2 py-6" : "px-6 py-10"}`}>
      <Package className="size-6" aria-hidden />
      <p className="font-medium text-foreground">No products yet</p>
      <p className="max-w-72">Add one with its name, price, photos and specs, or import many at once from a connected store (MCP).</p>
      <div className="flex flex-wrap justify-center gap-1">
        <Button type="button" size="sm" onClick={onNew}><Plus /> New product</Button>
        <Button type="button" size="sm" variant="outline" onClick={onImport}><PackagePlus /> Import products</Button>
      </div>
    </div>
  );
}

/**
 * Choose products from the catalog: one for a product card, several (ordered)
 * for a grid. "New product" opens the product form and selects the result.
 */
export function ProductPickerDialog({ doc, assetUrls, options, ui, onClose }: {
  doc: CatalogDocument;
  assetUrls: Record<string, string>;
  options: PickOptions;
  ui: Pick<ProductUi, "edit" | "import">;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const { multiple } = options;
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>(() => (options.initial ?? []).filter((id) => doc.products.some((p) => p.id === id)));
  useEffect(() => ref.current?.showModal(), []);

  const byId = useMemo(() => new Map(doc.products.map((p) => [p.id, p])), [doc.products]);
  const shown = doc.products.filter((p) => matchesProduct(p, query));

  const confirm = (ids = selected) => {
    if (!ids.length) return;
    onClose();
    options.onConfirm(ids);
  };
  const toggle = (id: string) => {
    if (!multiple) return setSelected([id]);
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };
  const move = (i: number, by: number) => setSelected((s) => {
    const next = [...s];
    const j = i + by;
    if (j < 0 || j >= next.length) return s;
    [next[i], next[j]] = [next[j]!, next[i]!];
    return next;
  });
  const newProduct = () => ui.edit(undefined, (id) => (multiple ? setSelected((s) => [...s, id]) : confirm([id])));

  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby={`${uid}-t`} className="m-auto w-[min(760px,calc(100vw-32px))] overflow-hidden rounded-xl border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50">
      <div className="flex max-h-[min(85vh,760px)] flex-col">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 id={`${uid}-t`} className="text-sm font-semibold">{options.title}</h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close"><X /></Button>
        </div>

        {doc.products.length === 0 ? (
          <NoProducts onNew={newProduct} onImport={() => { onClose(); ui.import(); }} />
        ) : (
          <div className={`grid min-h-0 flex-1 ${multiple ? "md:grid-cols-[minmax(0,1fr)_240px]" : ""}`}>
            <div className="flex min-h-0 flex-col">
              <div className="flex items-center gap-2 border-b px-5 py-2">
                <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <input
                  autoFocus type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name, SKU, brand or category" aria-label="Search products"
                  className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none"
                  onKeyDown={(e) => { if (e.key === "Enter" && !multiple && shown.length === 1) { e.preventDefault(); confirm([shown[0]!.id]); } }}
                />
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{shown.length} of {doc.products.length}</span>
              </div>
              <ul className="min-h-40 flex-1 divide-y overflow-y-auto" role="list" aria-label="Products">
                {shown.length === 0 && <li className="p-5 text-xs text-muted-foreground">No products match “{query}”.</li>}
                {shown.map((p) => {
                  const on = selected.includes(p.id);
                  const price = productPrice(doc, p);
                  return (
                    <li key={p.id}>
                      <label className={`flex cursor-pointer items-center gap-3 px-5 py-2 text-xs hover:bg-muted/60 ${on ? "bg-muted" : ""}`}
                        onDoubleClick={() => !multiple && confirm([p.id])}>
                        <input type={multiple ? "checkbox" : "radio"} name={`${uid}-pick`} checked={on} onChange={() => toggle(p.id)} className="shrink-0" />
                        <ProductThumb product={p} assetUrls={assetUrls} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{p.name}</span>
                          <span className="block truncate text-muted-foreground">{[p.brand, p.sku, p.category].filter(Boolean).join(" · ") || " "}</span>
                        </span>
                        {multiple && on && <span className="shrink-0 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground tabular-nums">{selected.indexOf(p.id) + 1}</span>}
                        {price && <span className="shrink-0 text-muted-foreground tabular-nums">{price}</span>}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
            {multiple && (
              <div className="flex min-h-0 flex-col border-t md:border-t-0 md:border-s">
                <h3 className="px-3 py-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">In the grid ({selected.length})</h3>
                {selected.length === 0 ? (
                  <p className="px-3 pb-3 text-xs text-muted-foreground">Tick products to add them. Their order here is the order on the slide.</p>
                ) : (
                  <ol className="max-h-56 min-h-0 flex-1 overflow-y-auto px-1 pb-2 md:max-h-none">
                    {selected.map((id, i) => {
                      const p = byId.get(id);
                      if (!p) return null;
                      return (
                        <li key={id} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-muted/60">
                          <span className="w-4 shrink-0 text-muted-foreground tabular-nums">{i + 1}</span>
                          <span className="min-w-0 flex-1 truncate">{p.name}</span>
                          <Button variant="ghost" size="icon-xs" aria-label={`Move ${p.name} up`} title="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
                          <Button variant="ghost" size="icon-xs" aria-label={`Move ${p.name} down`} title="Move down" disabled={i === selected.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
                          <Button variant="ghost" size="icon-xs" aria-label={`Remove ${p.name}`} title="Remove" onClick={() => toggle(id)}><X /></Button>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 border-t px-5 py-3">
          {doc.products.length > 0 && <Button variant="outline" size="sm" onClick={newProduct}><Plus /> New product</Button>}
          <span className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!selected.length} onClick={() => confirm()}>{options.confirmLabel}</Button>
        </div>
      </div>
    </dialog>
  );
}
