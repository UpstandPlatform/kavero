"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Loading02Icon, SparklesIcon } from "@hugeicons/core-free-icons";
import { buildCatalog, heuristicPlan } from "@Kavero/ai/browser";
import { PAGE_PRESETS, TEMPLATES, type CatalogDocument, type PagePreset } from "@Kavero/catalog-engine";
import { SlideView } from "@Kavero/renderer";
import { Button } from "@Kavero/ui/components/button";
import { SimpleSelect } from "@Kavero/ui/components/simple-select";
import { Textarea } from "@Kavero/ui/components/textarea";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { builtInExtensionRenderers } from "@/modules/editor/extensions/built-in-renderers";
import { builtInExtensionEffects } from "@/modules/editor/extensions/built-in-effects";
import { makeTRPCClient } from "@/utils/trpc";

import { localCatalogs, saveLocalCatalog } from "./local-catalogs";

let client: ReturnType<typeof makeTRPCClient> | null = null;
const api = () => (client ??= makeTRPCClient());

const PAGE_LABELS: Record<PagePreset, string> = { "16:9": "Widescreen 16:9", "4:3": "Standard 4:3", "a4-portrait": "A4 portrait", "a4-landscape": "A4 landscape", "letter-portrait": "US Letter", square: "Square" };

export function AiGenerateDialog({ onClose, initialBrief = "" }: { onClose: () => void; initialBrief?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const [aiStatus, setAiStatus] = useState<{ configured: boolean; model: string | null } | null>(null);
  const [brief, setBrief] = useState(initialBrief);
  const [templateId, setTemplateId] = useState("auto");
  const [page, setPage] = useState<PagePreset>("16:9");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ document: CatalogDocument; source: "ai" | "offline"; model?: string } | null>(null);

  const briefRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    // showModal focuses the first control (the close button); start in the brief instead.
    briefRef.current?.focus();
  }, []);
  useEffect(() => void api().ai.status.query().then(setAiStatus, () => setAiStatus({ configured: false, model: null })), []);
  const usesModel = !!session && !!aiStatus?.configured;

  async function generate() {
    setBusy("generate");
    setResult(null);
    const input = { brief, products: [], templateId: templateId === "auto" ? undefined : templateId, page, language: "en", currency: "USD" };
    try {
      if (session) {
        const r = await api().ai.generate.mutate(input);
        setResult({ document: r.document as CatalogDocument, source: r.source, model: r.model });
      } else {
        const plan = heuristicPlan(input);
        setResult({ document: buildCatalog(plan, input), source: "offline" });
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
      await saveLocalCatalog(doc);
      router.push(`/editor/${doc.id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(null);
    }
  }

  const thumb = result ? 150 / result.document.settings.width : 0;

  return (
    <dialog ref={ref} aria-labelledby="catalog-generation-title" onClose={onClose} className="fixed inset-0 m-0 h-dvh w-screen max-h-none max-w-none overflow-y-auto border-0 bg-background p-0 text-foreground backdrop:bg-background">
      <div className="relative min-h-dvh overflow-hidden">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 left-1/2 h-96 w-[min(80vw,900px)] -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]" />
          <div className="absolute top-1/2 -left-28 size-72 -translate-y-1/2 rounded-full bg-orange-400/10 blur-[100px]" />
          <div className="absolute top-1/2 -right-24 size-72 -translate-y-1/2 rounded-full bg-amber-300/10 blur-[100px]" />
        </div>
        <Button variant="ghost" size="icon-sm" className="fixed top-4 right-4 z-30 rounded-full" onClick={onClose} aria-label="Close"><HugeiconsIcon icon={Cancel01Icon} /></Button>
        <main className="relative mx-auto grid min-h-dvh w-full max-w-6xl content-center justify-items-center gap-10 px-4 py-16 sm:px-8">
          <section className="grid justify-items-center text-center">
            <h1 id="catalog-generation-title" className="max-w-4xl text-4xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">Turn a clear idea into a <span className="text-primary">catalog worth sharing.</span></h1>
          </section>

          <div className="w-full max-w-4xl text-sm">
            {!result ? (
              <div className="grid gap-6">
                <div className="relative">
                  <Textarea
                    ref={briefRef}
                    aria-label="Describe the catalog you want to create"
                    className="min-h-40 resize-y rounded-3xl px-6 py-5 pb-16 pe-40 text-base shadow-lg shadow-primary/5 sm:min-h-48 sm:text-lg"
                    value={brief}
                    onChange={(e) => setBrief(e.target.value)}
                    maxLength={4000}
                    placeholder="Describe the catalog you want to create…"
                  />
                  <Button className="absolute right-3 bottom-3 rounded-full px-5" onClick={generate} disabled={!!busy || !brief.trim()}>
                    {busy === "generate" ? <HugeiconsIcon icon={Loading02Icon} className="animate-spin" /> : <HugeiconsIcon icon={SparklesIcon} />}
                    Generate
                  </Button>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">Style
                    <SimpleSelect value={templateId} onValueChange={setTemplateId} options={[{ value: "auto", label: "Pick for me" }, ...TEMPLATES.map((t) => ({ value: t.id, label: `${t.name} (${t.category})` }))]} />
                  </label>
                  <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">Page
                    <SimpleSelect value={page} onValueChange={setPage} options={(Object.keys(PAGE_PRESETS) as PagePreset[]).map((p) => ({ value: p, label: PAGE_LABELS[p] }))} />
                  </label>
                </div>

                <p className="text-center text-xs text-muted-foreground">
                  {usesModel ? `Using ${aiStatus?.model}. Your brief is sent to the AI provider.`
                    : session ? "No AI model is configured, so Kavero’s built-in planner will create a draft from your brief."
                    : "Kavero’s built-in planner runs in your browser. Sign in to use a connected AI model."}
                </p>
              </div>
            ) : (
              <div className="grid gap-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    {result.document.slides.length} slides ready. {result.source === "ai" ? `Planned by ${result.model}.` : "Arranged by the built-in planner."} Everything stays editable.
                  </p>
                  <Button variant="ghost" onClick={() => setResult(null)} disabled={!!busy}>Back to brief</Button>
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
                  {result.document.slides.map((s, i) => (
                    <figure key={s.id} className="grid gap-2">
                      <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10"><SlideView doc={result.document} slide={s} scale={thumb} mode="edit" extensionRenderers={builtInExtensionRenderers} extensionEffects={builtInExtensionEffects} /></div>
                      <figcaption className="truncate text-xs text-muted-foreground">{i + 1}. {s.name}</figcaption>
                    </figure>
                  ))}
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={generate} disabled={!!busy}>{busy === "generate" && <HugeiconsIcon icon={Loading02Icon} className="animate-spin" />} Try again</Button>
                  <Button onClick={create} disabled={!!busy}>{busy === "create" && <HugeiconsIcon icon={Loading02Icon} className="animate-spin" />} Create catalog</Button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </dialog>
  );
}
