"use client";

import type { CatalogDocument } from "@Kavero/catalog-engine";
import { applyCommand, type Editor, type EditorCommand } from "@Kavero/editor-core";
import { SlideView } from "@Kavero/renderer";
import { Button } from "@Kavero/ui/components/button";
import { Loader2, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { makeTRPCClient } from "@/utils/trpc";

import { useRun } from "./use-catalog-editor";

let client: ReturnType<typeof makeTRPCClient> | null = null;
const api = () => (client ??= makeTRPCClient());

const SUGGESTIONS = [
  "Make this slide more minimal",
  "Improve the typography hierarchy",
  "Add a short persuasive tagline",
  "Add a closing slide with a call to action after this one",
  "Change the theme to dark luxury",
  "Animate the elements so they appear one after another",
];

/**
 * Ask AI to change the current slide (or the catalog). Nothing is applied until
 * the user reviews the before/after preview and clicks Apply; it's one undo step.
 */
export function AiEditDialog({ editor, doc, slideId, assetUrls, onClose }: { editor: Editor; doc: CatalogDocument; slideId: string; assetUrls: Record<string, string>; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const run = useRun(editor);
  const { data: session, isPending } = authClient.useSession();
  const [status, setStatus] = useState<{ configured: boolean; model: string | null } | null>(null);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<{ summary: string; commands: EditorCommand[]; skipped: string[] } | null>(null);

  useEffect(() => ref.current?.showModal(), []);
  useEffect(() => void api().ai.status.query().then(setStatus, () => setStatus({ configured: false, model: null })), []);

  // Preview: apply the proposed commands to a copy.
  const preview = useMemo(() => {
    if (!proposal) return null;
    const draft = structuredClone(doc);
    try {
      applyCommand(draft, { type: "batch", commands: proposal.commands });
      return draft;
    } catch {
      return null;
    }
  }, [proposal, doc]);

  async function propose() {
    setBusy(true);
    setProposal(null);
    try {
      const r = await api().ai.edit.mutate({ document: doc, slideId, instruction });
      if (!r.commands.length) toast.error("The AI didn't suggest any valid change. Try being more specific.");
      else setProposal({ summary: r.summary, commands: r.commands as EditorCommand[], skipped: r.skipped });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function apply() {
    if (!proposal) return;
    if (run({ type: "batch", commands: proposal.commands, label: "AI edit" })) {
      toast.success("Applied. Press Ctrl+Z to undo.");
      onClose();
    }
  }

  const before = doc.slides.find((s) => s.id === slideId);
  const after = preview?.slides.find((s) => s.id === slideId) ?? preview?.slides[preview.slides.findIndex((s) => s.id === slideId) + 1];
  const scale = 300 / doc.settings.width;
  const added = preview ? preview.slides.length - doc.slides.length : 0;

  return (
    <dialog ref={ref} onClose={onClose} className="m-auto w-[min(720px,calc(100vw-32px))] border bg-background p-0 text-foreground backdrop:bg-black/50">
      <div className="flex items-center justify-between border-b px-5 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4" /> Edit with AI</h2>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close"><X /></Button>
      </div>
      <div className="grid max-h-[78vh] gap-4 overflow-y-auto p-5 text-xs">
        {!isPending && !session ? (
          <div className="grid gap-2"><p>AI editing runs on the server with your account.</p><Link href="/login"><Button>Sign in</Button></Link></div>
        ) : status && !status.configured ? (
          <p>No AI model is configured on this server. An administrator can set <code>ANTHROPIC_API_KEY</code> (or an OpenAI-compatible endpoint) to enable AI editing.</p>
        ) : (
          <>
            <label className="grid gap-1">What should change?
              <textarea className="h-20 w-full border border-input bg-transparent p-2 text-sm" value={instruction} onChange={(e) => setInstruction(e.target.value)} maxLength={2000} autoFocus
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && instruction.trim()) void propose(); }} />
            </label>
            <div className="flex flex-wrap gap-1">
              {SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => setInstruction(s)} className="border px-2 py-1 hover:bg-muted">{s}</button>)}
            </div>
            <div className="flex justify-end">
              <Button onClick={propose} disabled={busy || !instruction.trim()}>{busy ? <Loader2 className="animate-spin" /> : <Sparkles />} Suggest changes</Button>
            </div>

            {proposal && (
              <div className="grid gap-3 border-t pt-4">
                <p className="text-sm">{proposal.summary}</p>
                <p className="text-muted-foreground">
                  {proposal.commands.length} change{proposal.commands.length === 1 ? "" : "s"}{added > 0 ? `, ${added} new slide${added === 1 ? "" : "s"}` : ""}
                  {proposal.skipped.length ? ` · ${proposal.skipped.length} suggestion${proposal.skipped.length === 1 ? "" : "s"} couldn’t be applied and were left out` : ""}
                </p>
                {before && after && preview && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <figure className="grid gap-1"><figcaption className="text-muted-foreground">Before</figcaption><div className="ring-1 ring-border"><SlideView doc={doc} slide={before} scale={scale} mode="edit" resolveAsset={(id) => assetUrls[id]} /></div></figure>
                    <figure className="grid gap-1"><figcaption className="text-muted-foreground">After</figcaption><div className="ring-1 ring-sky-500"><SlideView doc={preview} slide={after} scale={scale} mode="edit" resolveAsset={(id) => assetUrls[id]} /></div></figure>
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setProposal(null)}>Discard</Button>
                  <Button onClick={apply}>Apply</Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
