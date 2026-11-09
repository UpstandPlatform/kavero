"use client";

import { createId, type CatalogDocument } from "@Kavero/catalog-engine";
import type { Editor, EditorCommand, NewElement } from "@Kavero/editor-core";
import { Button } from "@Kavero/ui/components/button";
import { Loader2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { makeTRPCClient } from "@/utils/trpc";

import { useRun } from "./use-catalog-editor";

let client: ReturnType<typeof makeTRPCClient> | null = null;
const api = () => (client ??= makeTRPCClient());

type Conn = Awaited<ReturnType<ReturnType<typeof api>["integrations"]["connections"]["list"]["query"]>>[number];
type Found = Awaited<ReturnType<ReturnType<typeof api>["integrations"]["connections"]["importProducts"]["mutate"]>>["products"][number];

/** Prefill tool arguments from the tool's JSON schema (defaults / sensible limits). */
function defaultArgs(schema: unknown): string {
  const props = (schema as { properties?: Record<string, { default?: unknown; type?: string }> } | undefined)?.properties ?? {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v.default !== undefined) out[k] = v.default;
    else if (/^(limit|first|count|per_page|pageSize)$/i.test(k) && (v.type === "number" || v.type === "integer")) out[k] = 24;
  }
  return JSON.stringify(out, null, 2);
}

async function dataUrlToFile(dataUrl: string, name: string) {
  const blob = await (await fetch(dataUrl)).blob();
  return new File([blob], name, { type: blob.type });
}

/**
 * Import products from a connected MCP server into this catalog: pick a tool,
 * run it, review what was found, then add the selected products (and images).
 */
export function ProductImportDialog({ editor, doc, uploadImage, activeSlideIndex, onClose }: {
  editor: Editor;
  doc: CatalogDocument;
  uploadImage: (f: File) => Promise<{ assetId: string }>;
  activeSlideIndex: number;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const run = useRun(editor);
  const { data: session, isPending } = authClient.useSession();
  const [conns, setConns] = useState<Conn[] | null>(null);
  const [connId, setConnId] = useState("");
  const [tool, setTool] = useState("");
  const [args, setArgs] = useState("{}");
  const [found, setFound] = useState<Found[] | null>(null);
  const [raw, setRaw] = useState<string | undefined>();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [withImages, setWithImages] = useState(true);
  const [layout, setLayout] = useState<"none" | "single" | "per-category">("single");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => ref.current?.showModal(), []);
  useEffect(() => {
    if (!session) return;
    api().integrations.connections.list.query().then((list) => {
      setConns(list);
      const first = list.find((c) => c.status === "ok" && c.tools.length) ?? list[0];
      if (first) setConnId(first.id);
    }, (e: Error) => toast.error(e.message));
  }, [session]);

  const conn = conns?.find((c) => c.id === connId);
  const tools = useMemo(() => conn?.tools ?? [], [conn]);
  useEffect(() => {
    // Prefer a tool that sounds like it lists products.
    const t = tools.find((x) => /product|catalog|item|inventory|search/i.test(x.name)) ?? tools[0];
    setTool(t?.name ?? "");
  }, [tools]);
  useEffect(() => setArgs(defaultArgs(tools.find((t) => t.name === tool)?.inputSchema)), [tool, tools]);

  async function fetchProducts() {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(args || "{}");
    } catch {
      return toast.error("Arguments must be valid JSON");
    }
    setBusy("fetch");
    setFound(null);
    try {
      const r = await api().integrations.connections.importProducts.mutate({ id: connId, tool, args: parsed });
      setFound(r.products);
      setRaw(r.rawPreview);
      setSelected(new Set(r.products.map((_, i) => i)));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function addToCatalog() {
    if (!found) return;
    const items = found.filter((_, i) => selected.has(i));
    setBusy("add");
    try {
      // 1. Images: downloaded by the server (safely), stored locally like uploads.
      const imageIds = new Map<number, string>();
      if (withImages) {
        const withUrl = items.map((p, i) => ({ i, url: p.imageUrl })).filter((x): x is { i: number; url: string } => !!x.url);
        for (let start = 0; start < withUrl.length; start += 30) {
          const chunk = withUrl.slice(start, start + 30);
          const res = await api().integrations.fetchImages.mutate({ urls: chunk.map((c) => c.url) });
          for (const [k, r] of res.entries()) {
            if (!("dataUrl" in r) || !r.dataUrl) continue;
            const { assetId } = await uploadImage(await dataUrlToFile(r.dataUrl, `${items[chunk[k]!.i]!.name}.img`));
            imageIds.set(chunk[k]!.i, assetId);
          }
        }
      }

      // 2. Products (+ slides) as one undoable step.
      const existing = new Map(doc.products.map((p) => [p.id, p]));
      const ids = items.map((p) => (p.id && existing.has(`ext_${p.id}`) ? `ext_${p.id}` : p.id ? `ext_${p.id}`.replace(/[^\w-]/g, "_").slice(0, 100) : createId("prd")));
      const commands: EditorCommand[] = items.map((p, i) => ({
        type: "product.upsert",
        product: {
          id: ids[i], name: p.name, description: p.description, sku: p.sku, price: p.price, currency: p.currency, url: p.url?.startsWith("http") ? p.url : undefined,
          category: p.category, attributes: p.attributes, source: conn?.name, imageAssetIds: imageIds.has(i) ? [imageIds.get(i)!] : existing.get(ids[i]!)?.imageAssetIds ?? [],
        },
      }));
      if (layout !== "none") {
        const groups = new Map<string, string[]>();
        items.forEach((p, i) => {
          const key = layout === "per-category" ? (p.category || "Products") : "Products";
          groups.set(key, [...(groups.get(key) ?? []), ids[i]!]);
        });
        const { width: W, height: H } = doc.settings;
        const m = Math.round(Math.min(W, H) * 0.07);
        let at = activeSlideIndex + 1;
        for (const [name, pids] of groups) {
          // Large groups are split over several slides.
          for (let k = 0; k < pids.length; k += 6) {
            const slideId = createId("sld");
            commands.push({ type: "slide.add", index: at++, slide: { id: slideId, name } });
            commands.push({ type: "element.add", slideId, element: { type: "text", position: { x: m, y: m, width: W - 2 * m, height: H * 0.1, rotation: 0 }, content: { paragraphs: [[{ text: name }]] }, style: { fontSize: Math.round(H * 0.05), fontWeight: 700, fontFamily: "token:heading" } } as unknown as NewElement });
            commands.push({ type: "element.add", slideId, element: { type: "product-grid", position: { x: m, y: m + H * 0.14, width: W - 2 * m, height: H - 2 * m - H * 0.14, rotation: 0 }, content: { columns: 3, products: pids.slice(k, k + 6).map((productId) => ({ productId })) } } as unknown as NewElement });
          }
        }
      }
      if (run({ type: "batch", commands, label: "Import products" })) {
        toast.success(`Imported ${items.length} product${items.length === 1 ? "" : "s"}${imageIds.size ? ` with ${imageIds.size} images` : ""}`);
        onClose();
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const field = "h-8 w-full border border-input bg-transparent px-2 text-xs";
  return (
    <dialog ref={ref} onClose={onClose} className="m-auto w-[min(720px,calc(100vw-32px))] border bg-background p-0 text-foreground backdrop:bg-black/50">
      <div className="flex items-center justify-between border-b px-5 py-3">
        <h2 className="text-sm font-semibold">Import products from MCP</h2>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close"><X /></Button>
      </div>
      <div className="grid max-h-[75vh] gap-4 overflow-y-auto p-5 text-xs">
        {!isPending && !session ? (
          <div className="grid gap-2"><p>Connected product sources are tied to your account.</p><Link href="/login"><Button>Sign in</Button></Link></div>
        ) : !conns ? (
          <p className="text-muted-foreground">Loading connections…</p>
        ) : conns.length === 0 ? (
          <div className="grid gap-2"><p>No MCP servers connected yet.</p><Link href="/settings"><Button variant="outline">Connect one in Settings</Button></Link></div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1">Source
                <select className={field} value={connId} onChange={(e) => setConnId(e.target.value)}>
                  {conns.map((c) => <option key={c.id} value={c.id}>{c.name}{c.status === "error" ? " (error)" : ""}</option>)}
                </select>
              </label>
              <label className="grid gap-1">Tool
                <select className={field} value={tool} onChange={(e) => setTool(e.target.value)} disabled={!tools.length}>
                  {tools.length === 0 && <option>No tools — test the connection in Settings</option>}
                  {tools.map((t) => <option key={t.name} value={t.name}>{t.title ?? t.name}</option>)}
                </select>
              </label>
            </div>
            {tools.find((t) => t.name === tool)?.description && <p className="text-muted-foreground">{tools.find((t) => t.name === tool)!.description}</p>}
            <label className="grid gap-1">Arguments (JSON)
              <textarea className="h-24 w-full border border-input bg-transparent p-2 font-mono text-[11px]" value={args} onChange={(e) => setArgs(e.target.value)} spellCheck={false} />
            </label>
            <div><Button onClick={fetchProducts} disabled={!tool || !!busy}>{busy === "fetch" && <Loader2 className="animate-spin" />} Fetch products</Button></div>

            {found && found.length === 0 && (
              <div className="grid gap-1 border border-dashed p-3">
                <p>No products recognised in the result.</p>
                {raw && <pre className="max-h-40 overflow-auto text-[10px] text-muted-foreground">{raw}</pre>}
              </div>
            )}
            {found && found.length > 0 && (
              <>
                <div className="overflow-x-auto border">
                  <table className="w-full">
                    <thead className="bg-muted/40 text-left">
                      <tr>
                        <th className="p-2"><input type="checkbox" aria-label="Select all" checked={selected.size === found.length} onChange={(e) => setSelected(e.target.checked ? new Set(found.map((_, i) => i)) : new Set())} /></th>
                        <th className="p-2">Product</th><th className="p-2">Price</th><th className="p-2">Category</th><th className="p-2">Image</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {found.map((p, i) => (
                        <tr key={i}>
                          <td className="p-2"><input type="checkbox" aria-label={`Select ${p.name}`} checked={selected.has(i)} onChange={(e) => { const s = new Set(selected); if (e.target.checked) s.add(i); else s.delete(i); setSelected(s); }} /></td>
                          <td className="max-w-64 p-2"><p className="truncate font-medium">{p.name}</p>{p.sku && <p className="text-muted-foreground">{p.sku}</p>}</td>
                          <td className="p-2 tabular-nums">{p.price !== undefined ? `${p.price}${p.currency ? ` ${p.currency}` : ""}` : "—"}</td>
                          <td className="p-2">{p.category ?? "—"}</td>
                          <td className="p-2">{p.imageUrl ? "yes" : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={withImages} onChange={(e) => setWithImages(e.target.checked)} /> Download images</label>
                  <label className="flex items-center gap-1.5">Add slides
                    <select className="h-7 border border-input bg-transparent px-1" value={layout} onChange={(e) => setLayout(e.target.value as never)}>
                      <option value="single">one product section</option><option value="per-category">one per category</option><option value="none">no, just add products</option>
                    </select>
                  </label>
                  <Button className="ml-auto" onClick={addToCatalog} disabled={!selected.size || !!busy}>
                    {busy === "add" && <Loader2 className="animate-spin" />} Add {selected.size} to catalog
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
