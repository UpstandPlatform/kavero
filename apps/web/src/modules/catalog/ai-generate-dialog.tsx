"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Loading02Icon, SparklesIcon } from "@hugeicons/core-free-icons";
import { buildCatalog, heuristicPlan } from "@Kavero/ai/browser";
import { PAGE_PRESETS, TEMPLATES, createId, type CatalogDocument, type PagePreset, type Product } from "@Kavero/catalog-engine";
import { SlideView } from "@Kavero/renderer";
import { Button } from "@Kavero/ui/components/button";
import { SimpleSelect } from "@Kavero/ui/components/simple-select";
import { Textarea } from "@Kavero/ui/components/textarea";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { makeTRPCClient } from "@/utils/trpc";

import { localCatalogs, saveLocalCatalog } from "./local-catalogs";

let client: ReturnType<typeof makeTRPCClient> | null = null;
const api = () => (client ??= makeTRPCClient());

type SourceProduct = Product & { imageUrl?: string };
type Conn = Awaited<ReturnType<ReturnType<typeof api>["integrations"]["connections"]["list"]["query"]>>[number];

/** "Name, price, category" per line (comma, tab or semicolon separated). */
export function parsePastedProducts(text: string): SourceProduct[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 500).map((line) => {
    const [name = "", price = "", category = "", ...rest] = line.split(/\t|;|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.trim().replace(/^"|"$/g, ""));
    const n = Number(price.replace(/[^0-9.]/g, ""));
    const url = rest.find((r) => /^https?:\/\//.test(r));
    return { id: createId("prd"), name: name.slice(0, 200), price: price && Number.isFinite(n) ? n : undefined, category: category || undefined, imageAssetIds: [], attributes: {}, imageUrl: url };
  }).filter((p) => p.name);
}

const PAGE_LABELS: Record<PagePreset, string> = { "16:9": "Widescreen 16:9", "4:3": "Standard 4:3", "a4-portrait": "A4 portrait", "a4-landscape": "A4 landscape", "letter-portrait": "US Letter", square: "Square" };

export function AiGenerateDialog({ onClose, initialBrief = "" }: { onClose: () => void; initialBrief?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const [aiStatus, setAiStatus] = useState<{ configured: boolean; model: string | null } | null>(null);
  const [brief, setBrief] = useState(initialBrief);
  const [templateId, setTemplateId] = useState("auto");
  const [page, setPage] = useState<PagePreset>("16:9");
  const [language, setLanguage] = useState("en");
  const [currency, setCurrency] = useState("USD");
  const [source, setSource] = useState<"none" | "paste" | "mcp">("none");
  const [pasted, setPasted] = useState("");
  const [conns, setConns] = useState<Conn[]>([]);
  const [connId, setConnId] = useState("");
  const [tool, setTool] = useState("");
  const [mcpProducts, setMcpProducts] = useState<SourceProduct[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  // `products` are the exact ones sent to generate(), so create() can match their ids to fetch images.
  const [result, setResult] = useState<{ document: CatalogDocument; source: "ai" | "offline"; model?: string; products: SourceProduct[] } | null>(null);

  const briefRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    // showModal focuses the first control (the close button); start in the brief instead.
    briefRef.current?.focus();
  }, []);
  useEffect(() => void api().ai.status.query().then(setAiStatus, () => setAiStatus({ configured: false, model: null })), []);
  useEffect(() => {
    if (!session) return;
    api().integrations.connections.list.query().then((list) => {
      setConns(list);
      const c = list.find((x) => x.tools.length) ?? list[0];
      if (c) setConnId(c.id);
    }, () => undefined);
  }, [session]);
  const conn = conns.find((c) => c.id === connId);
  useEffect(() => setTool(conn?.tools.find((t) => /product|catalog|item|search/i.test(t.name))?.name ?? conn?.tools[0]?.name ?? ""), [conn]);

  // Parse once per text change: parsing assigns fresh product ids.
  const pastedProducts = useMemo(() => parsePastedProducts(pasted), [pasted]);
  const products: SourceProduct[] = source === "paste" ? pastedProducts : source === "mcp" ? mcpProducts : [];
  const usesModel = !!session && !!aiStatus?.configured;

  async function fetchMcp() {
    setBusy("mcp");
    try {
      const r = await api().integrations.connections.importProducts.mutate({ id: connId, tool, args: {} });
      setMcpProducts(r.products.map((p) => ({
        id: p.id ? `ext_${p.id}`.replace(/[^\w-]/g, "_").slice(0, 100) : createId("prd"), name: p.name, description: p.description, sku: p.sku, price: p.price, currency: p.currency,
        url: p.url?.startsWith("http") ? p.url : undefined, category: p.category, attributes: p.attributes, imageAssetIds: [], imageUrl: p.imageUrl, source: conn?.name,
        brand: p.brand, compareAtPrice: p.compareAtPrice, availability: p.availability, rating: p.rating, tags: p.tags,
      })));
      if (!r.products.length) toast.error("No products found in that tool's result");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function generate() {
    setBusy("generate");
    setResult(null);
    const used = products;
    const plainProducts: Product[] = used.map(({ imageUrl: _u, ...p }) => p);
    const input = { brief, products: plainProducts, templateId: templateId === "auto" ? undefined : templateId, page, language, currency };
    try {
      if (session) {
        const r = await api().ai.generate.mutate(input);
        setResult({ document: r.document as CatalogDocument, source: r.source, model: r.model, products: used });
      } else {
        const plan = heuristicPlan(input);
        setResult({ document: buildCatalog(plan, input), source: "offline", products: used });
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    if (!result) return;
    setBusy("create");
    try {
      const doc = structuredClone(result.document);
      // Product images: downloaded by the server (safely), stored locally with the catalog.
      const withImages = result.products.filter((p) => p.imageUrl);
      if (session && withImages.length) {
        for (let i = 0; i < withImages.length; i += 30) {
          const part = withImages.slice(i, i + 30);
          const res = await api().integrations.fetchImages.mutate({ urls: part.map((p) => p.imageUrl!) });
          for (const [k, r] of res.entries()) {
            if (!("dataUrl" in r) || !r.dataUrl) continue;
            const blob = await (await fetch(r.dataUrl)).blob();
            const assetId = createId("ast");
            await localCatalogs().putAsset({ id: assetId, catalogId: doc.id, blob, hash: "" });
            doc.assets.push({ id: assetId, kind: "image", mimeType: blob.type, name: part[k]!.name, uri: `local://${assetId}`, bytes: blob.size });
            const product = doc.products.find((p) => p.id === part[k]!.id);
            if (product) product.imageAssetIds = [assetId];
          }
        }
      }
      await saveLocalCatalog(doc);
      router.push(`/editor/${doc.id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(null);
    }
  }

  const thumb = result ? 150 / result.document.settings.width : 0;

  return (
    <dialog ref={ref} onClose={onClose} className="m-auto w-[min(820px,calc(100vw-32px))] overflow-hidden rounded-xl border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50">
      <div className="flex items-center justify-between border-b px-5 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><HugeiconsIcon icon={SparklesIcon} className="size-4" /> Generate a catalog</h2>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close"><HugeiconsIcon icon={Cancel01Icon} /></Button>
      </div>
      <div className="grid max-h-[78vh] gap-4 overflow-y-auto p-5 text-xs">
        {!result ? (
          <>
            <label className="grid gap-1.5">Describe the catalog
              <Textarea ref={briefRef} className="h-24 field-sizing-fixed" value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={4000}
                placeholder="e.g. Autumn 2027 lookbook for our handmade leather goods: warm, premium, for wholesale buyers." />
            </label>
            <div className="grid gap-3 sm:grid-cols-4">
              <label className="grid gap-1.5">Style
                <SimpleSelect value={templateId} onValueChange={setTemplateId} options={[{ value: "auto", label: "Pick for me" }, ...TEMPLATES.map((t) => ({ value: t.id, label: `${t.name} (${t.category})` }))]} />
              </label>
              <label className="grid gap-1.5">Page
                <SimpleSelect value={page} onValueChange={setPage} options={(Object.keys(PAGE_PRESETS) as PagePreset[]).map((p) => ({ value: p, label: PAGE_LABELS[p] }))} />
              </label>
              <label className="grid gap-1.5">Language
                <SimpleSelect value={language} onValueChange={setLanguage} options={[["en", "English"], ["de", "German"], ["fr", "French"], ["es", "Spanish"], ["it", "Italian"], ["fa", "Persian"], ["ar", "Arabic"]].map(([value, label]) => ({ value, label }))} />
              </label>
              <label className="grid gap-1.5">Currency
                <SimpleSelect value={currency} onValueChange={setCurrency} options={["USD", "EUR", "GBP", "CHF", "JPY", "AED", "IRR"].map((c) => ({ value: c, label: c }))} />
              </label>
            </div>

            <fieldset className="grid gap-2">
              <legend className="mb-1 font-medium">Products</legend>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2"><input type="radio" className="accent-primary" checked={source === "none"} onChange={() => setSource("none")} /> None (add later)</label>
                <label className="flex items-center gap-2"><input type="radio" className="accent-primary" checked={source === "paste"} onChange={() => setSource("paste")} /> Paste a list</label>
                <label className="flex items-center gap-2"><input type="radio" className="accent-primary" checked={source === "mcp"} disabled={!session || !conns.length} onChange={() => setSource("mcp")} /> From a connected source {!session ? "(sign in)" : !conns.length ? "(none connected)" : ""}</label>
              </div>
              {source === "paste" && (
                <>
                  <Textarea className="h-28 field-sizing-fixed font-mono text-xs md:text-xs" value={pasted} onChange={(e) => setPasted(e.target.value)}
                    placeholder={"One product per line: name, price, category, image URL (optional)\nWeekender Bag, 640, Bags\nCard Holder, 85, Small leather goods"} />
                  <span className="text-muted-foreground">{products.length} product{products.length === 1 ? "" : "s"} recognised</span>
                </>
              )}
              {source === "mcp" && (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="grid gap-1.5">Source<SimpleSelect className="w-48" value={connId} onValueChange={setConnId} options={conns.map((c) => ({ value: c.id, label: c.name }))} /></label>
                  <label className="grid gap-1.5">Tool<SimpleSelect className="w-48" value={tool} onValueChange={setTool} options={(conn?.tools ?? []).map((t) => ({ value: t.name, label: t.name }))} /></label>
                  <Button variant="outline" onClick={fetchMcp} disabled={!tool || !!busy}>{busy === "mcp" && <HugeiconsIcon icon={Loading02Icon} className="animate-spin" />} Fetch</Button>
                  <span className="text-muted-foreground">{mcpProducts.length} products loaded</span>
                </div>
              )}
            </fieldset>

            <p className="text-muted-foreground">
              {usesModel ? `Planned by ${aiStatus?.model}. Your brief and product list are sent to the AI provider.`
                : session ? "No AI model is configured on this server, so Kavero’s built-in planner arranges your products (no data leaves the server)."
                : "Signed out: Kavero’s built-in planner runs in your browser. Sign in to use an AI model when one is configured."}
            </p>
          </>
        ) : (
          <>
            <p className="text-muted-foreground">
              Review the {result.document.slides.length} slides below. {result.source === "ai" ? `Planned by ${result.model}.` : "Arranged by the built-in planner."} Everything stays editable after you create it.
            </p>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
              {result.document.slides.map((s, i) => (
                <figure key={s.id} className="grid gap-1">
                  <div className="overflow-hidden rounded-md ring-1 ring-foreground/10"><SlideView doc={result.document} slide={s} scale={thumb} mode="edit" /></div>
                  <figcaption className="truncate text-muted-foreground">{i + 1}. {s.name}</figcaption>
                </figure>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
        {!result ? (
          <Button onClick={generate} disabled={!!busy || (!brief.trim() && !products.length)}>{busy === "generate" ? <HugeiconsIcon icon={Loading02Icon} className="animate-spin" /> : <HugeiconsIcon icon={SparklesIcon} />} Generate</Button>
        ) : (
          <>
            <Button variant="ghost" className="me-auto" onClick={() => setResult(null)} disabled={!!busy}>Back</Button>
            <Button variant="outline" onClick={generate} disabled={!!busy}>{busy === "generate" && <HugeiconsIcon icon={Loading02Icon} className="animate-spin" />} Try again</Button>
            <Button onClick={create} disabled={!!busy}>{busy === "create" && <HugeiconsIcon icon={Loading02Icon} className="animate-spin" />} Create catalog</Button>
          </>
        )}
      </div>
    </dialog>
  );
}
