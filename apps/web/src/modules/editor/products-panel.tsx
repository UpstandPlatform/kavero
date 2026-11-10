"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, AddSquareIcon, Copy01Icon, Delete02Icon, PackageAddIcon, PencilIcon } from "@hugeicons/core-free-icons";
import { matchesProduct, productUsage, type CatalogDocument } from "@Kavero/catalog-engine";
import { Button } from "@Kavero/ui/components/button";
import { Input } from "@Kavero/ui/components/input";
import { useState } from "react";
import { toast } from "sonner";

import { kbd } from "./editor-actions";
import { NoProducts, ProductThumb, productPrice, type ProductUi } from "./product-picker";
import { useRun } from "./use-catalog-editor";
import { confirmAction } from "@/components/confirm-dialog";
import { TooltipHint } from "@Kavero/ui/components/tooltip";
import type { ExtensionEditorApi } from "./extensions/types";

/** Delete a product, warning first when slides show it. Returns false when cancelled. */
export async function deleteProduct(editor: Pick<ExtensionEditorApi, "getDocument">, run: ReturnType<typeof useRun>, productId: string): Promise<boolean> {
  const doc = editor.getDocument();
  const product = doc.products.find((p) => p.id === productId);
  if (!product) return false;
  const usage = productUsage(doc, productId);
  if (usage.length) {
    const where = usage.map((u) => `• Slide ${u.slideIndex + 1} “${u.slideName}”: ${u.elementType === "product" ? "product card (removed)" : u.elementType === "product-grid" ? "product grid (taken out)" : "Products extension element (removed)"}`).join("\n");
    if (!await confirmAction({ title: `Delete “${product.name}” from this catalog?`, description: `It is used on ${usage.length === 1 ? "1 element" : `${usage.length} elements`}:\n${where}\n\nYou can undo this.`, confirmLabel: "Delete product", destructive: true })) return false;
  }
  if (!run({ type: "product.delete", productId, removeFromSlides: true })) return false;
  toast.success(`Deleted “${product.name}”. Undo with ${kbd("Ctrl+Z")}.`);
  return true;
}

/** Product library in the left sidebar: every product in the catalog. */
export function ProductsPanel({ editor, doc, assetUrls, ui, onInsert }: {
  editor: ExtensionEditorApi;
  doc: CatalogDocument;
  assetUrls: Record<string, string>;
  ui: ProductUi;
  onInsert: (productId: string) => void;
}) {
  const run = useRun(editor);
  const [query, setQuery] = useState("");
  if (doc.products.length === 0) return <NoProducts compact onNew={() => ui.edit()} onImport={ui.import} />;
  const shown = doc.products.filter((p) => matchesProduct(p, query));
  const uses = new Map(doc.products.map((p) => [p.id, productUsage(doc, p.id).length]));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid gap-1 px-2 pb-2">
        <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search products" aria-label="Search products" />
        <div className="flex gap-1">
          <Button size="xs" className="flex-1" onClick={() => ui.edit()}><HugeiconsIcon icon={Add01Icon} /> New</Button>
          <Button size="xs" variant="outline" className="flex-1" title="Import products from MCP" onClick={ui.import}><HugeiconsIcon icon={PackageAddIcon} /> Import</Button>
        </div>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-1 pb-2" aria-label="Products">
        {shown.length === 0 && <li className="px-2 py-3 text-[11px] text-muted-foreground">No match.</li>}
        {shown.map((p) => {
          const price = productPrice(doc, p);
          const n = uses.get(p.id) ?? 0;
          return (
            <li key={p.id} className="group relative rounded-md hover:bg-muted/60 focus-within:bg-muted/60">
              <TooltipHint content={`Edit ${p.name}`}><button type="button" className="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1.5 text-start" onClick={() => ui.edit(p.id)}>
                <ProductThumb product={p} assetUrls={assetUrls} className="size-8" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{p.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {[price, n ? `on ${n === 1 ? "1 card" : `${n} cards`}` : "not placed"].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </button></TooltipHint>
              {/* Revealed on hover/focus, like slide actions. */}
              <span className="absolute end-1 top-1 hidden gap-0.5 rounded-md bg-background/95 shadow-sm group-hover:flex group-focus-within:flex">
                <Button variant="ghost" size="icon-xs" title="Add to slide" aria-label={`Add ${p.name} to slide`} onClick={() => onInsert(p.id)}><HugeiconsIcon icon={AddSquareIcon} /></Button>
                <Button variant="ghost" size="icon-xs" title="Edit" aria-label={`Edit ${p.name}`} onClick={() => ui.edit(p.id)}><HugeiconsIcon icon={PencilIcon} /></Button>
                <Button variant="ghost" size="icon-xs" title="Duplicate" aria-label={`Duplicate ${p.name}`} onClick={() => run({ type: "product.duplicate", productId: p.id })}><HugeiconsIcon icon={Copy01Icon} /></Button>
                <Button variant="ghost" size="icon-xs" title="Delete" aria-label={`Delete ${p.name}`} onClick={() => deleteProduct(editor, run, p.id)}><HugeiconsIcon icon={Delete02Icon} /></Button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
