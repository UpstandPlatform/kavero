"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Loading02Icon, SparklesIcon, Tick01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@Kavero/ui/components/button";
import type { CatalogDocument, CatalogElement } from "@Kavero/catalog-engine";
import { applyCommand, type Editor, type EditorCommand } from "@Kavero/editor-core";
import { SlideView } from "@Kavero/renderer";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { useRun } from "@/modules/editor/use-catalog-editor";
import { makeTRPCClient } from "@/utils/trpc";

import { ChatThread, ChatUnavailable, type ChatAnnotationAttachment, type ToolPart } from "./chat-thread";

let client: ReturnType<typeof makeTRPCClient> | null = null;
const api = () => (client ??= makeTRPCClient());

const STARTERS = ["Make this slide more minimal", "Write a stronger headline for this slide", "Add a slide comparing our three best sellers", "Suggest a color theme for a luxury brand"];

type Proposal = { slideId: string; instruction: string; summary: string; commands: EditorCommand[] };
export type EditorChatAnnotationRef = { slideId: string; elementId: string };

function elementLabel(element: CatalogElement, doc: CatalogDocument) {
  if (element.name?.trim()) return element.name.trim();
  switch (element.type) {
    case "text": return element.content.paragraphs.flatMap((paragraph) => paragraph.map((run) => run.text)).join(" ").trim() || "Text element";
    case "image": return element.content.alt || "Image";
    case "shape": return `${element.content.shape[0]!.toUpperCase()}${element.content.shape.slice(1)} shape`;
    case "product": return doc.products.find((product) => product.id === element.content.productId)?.name || "Product card";
    case "product-grid": return `Product grid · ${element.content.products.length} products`;
    case "icon": return `${element.content.name} icon`;
    case "video": return "Video";
    case "button": return element.content.label || "Button";
    case "html": return "HTML block";
  }
}

function annotationKey(ref: EditorChatAnnotationRef) {
  return JSON.stringify([ref.slideId, ref.elementId]);
}

/**
 * Chat in the editor: the assistant sees the catalog and the current slide, answers
 * questions, and proposes slide edits that the user previews and applies (one undo step each).
 */
export function EditorChat({ editor, doc, assetUrls, annotations = [], annotationMode = false, hoveredAnnotation = null, onAnnotationModeChange, onHoveredAnnotationChange, onRemoveAnnotation }: {
  editor: Editor;
  doc: CatalogDocument;
  assetUrls: Record<string, string>;
  annotations?: EditorChatAnnotationRef[];
  annotationMode?: boolean;
  hoveredAnnotation?: EditorChatAnnotationRef | null;
  onAnnotationModeChange?: (active: boolean) => void;
  onHoveredAnnotationChange?: (annotation: EditorChatAnnotationRef | null) => void;
  onRemoveAnnotation?: (annotation: EditorChatAnnotationRef) => void;
}) {
  const { data: session, isPending } = authClient.useSession();
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  // Each catalog has its own conversation, remembered in this browser, plus which proposals were applied.
  const chatKey = `kavero:chat:${doc.id}`;
  const decisionsKey = `kavero:chat-decisions:${doc.id}`;
  const [decided, setDecidedState] = useState<Record<string, "applied" | "dismissed">>(() => {
    try {
      return typeof window === "undefined" ? {} : (JSON.parse(localStorage.getItem(decisionsKey) ?? "{}") as Record<string, "applied" | "dismissed">);
    } catch {
      return {};
    }
  });
  const setDecided = (fn: (d: Record<string, "applied" | "dismissed">) => Record<string, "applied" | "dismissed">) =>
    setDecidedState((d) => {
      const next = fn(d);
      try {
        localStorage.setItem(decisionsKey, JSON.stringify(next));
      } catch {
        // storage unavailable
      }
      return next;
    });
  const run = useRun(editor);
  const [sent, setSent] = useState<string | undefined>(undefined);
  const annotationAttachments = useMemo(() => annotations.flatMap((ref): (ChatAnnotationAttachment & { ref: EditorChatAnnotationRef })[] => {
    const slideIndex = doc.slides.findIndex((slide) => slide.id === ref.slideId);
    const slide = doc.slides[slideIndex];
    const element = slide?.elements.find((item) => item.id === ref.elementId);
    if (!slide || !element) return [];
    return [{
      id: annotationKey(ref),
      ref,
      label: elementLabel(element, doc).slice(0, 72),
      detail: `Slide ${slideIndex + 1} · ${slide.name} · ${element.type}`,
    }];
  }), [annotations, doc]);

  useEffect(() => {
    if (!session) return;
    void api().ai.status.query().then((s) => setAiReady(s.configured), () => setAiReady(false));
  }, [session]);

  if (isPending || (session && aiReady === null)) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  if (!session) return <ChatUnavailable reason="signed-out" />;
  if (!aiReady) return <ChatUnavailable reason="no-model" />;

  const renderTool = (part: ToolPart) => {
    if (part.type !== "tool-propose_edit") return null;
    if (part.state === "output-error") return <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">Couldn't prepare the change: {part.errorText}</p>;
    if (part.state !== "output-available") return <p className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs text-muted-foreground"><HugeiconsIcon icon={Loading02Icon} className="size-3.5 animate-spin" /> Preparing a change…</p>;
    return (
      <ProposalCard
        proposal={part.output as Proposal}
        doc={editor.getDocument()}
        assetUrls={assetUrls}
        decision={decided[part.toolCallId]}
        onApply={(p) => {
          if (run({ type: "batch", commands: p.commands, label: "AI edit" })) {
            editor.setActiveSlide(p.slideId);
            setDecided((d) => ({ ...d, [part.toolCallId]: "applied" }));
            toast.success("Applied. Press Ctrl+Z to undo.");
          }
        }}
        onDismiss={() => setDecided((d) => ({ ...d, [part.toolCallId]: "dismissed" }))}
      />
    );
  };

  return (
    <ChatThread
      mode="editor"
      key={chatKey}
      storageKey={chatKey}
      onClear={() => {
        setSent(undefined);
        setDecidedState({});
        try {
          localStorage.removeItem(decisionsKey);
        } catch {
          // storage unavailable
        }
      }}
      className="min-h-0 flex-1"
      placeholder="Ask about this catalog or describe a change…"
      initialPrompt={sent}
      annotations={annotationAttachments}
      hoveredAnnotationId={hoveredAnnotation ? annotationKey(hoveredAnnotation) : null}
      onHoverAnnotation={(id) => {
        const attachment = id ? annotationAttachments.find((item) => item.id === id) : undefined;
        onHoveredAnnotationChange?.(attachment?.ref ?? null);
      }}
      onRemoveAnnotation={(id) => {
        const attachment = annotationAttachments.find((item) => item.id === id);
        if (attachment) onRemoveAnnotation?.(attachment.ref);
      }}
      annotationMode={annotationMode}
      onToggleAnnotationMode={() => onAnnotationModeChange?.(!annotationMode)}
      context={() => {
        const s = editor.getState();
        return { document: editor.getDocument(), slideId: s.activeSlideId, selection: s.selection, annotations };
      }}
      renderTool={(part) => renderTool(part)}
      emptyState={
        <div className="grid gap-3 py-6 text-sm">
          <p className="flex items-center gap-2 font-medium"><HugeiconsIcon icon={SparklesIcon} className="size-4" /> Edit with your AI model</p>
          <p className="text-muted-foreground">Ask about “{doc.metadata.title}” or describe a change. You review every edit before it's applied, and the conversation is remembered for this catalog.</p>
          <div className="flex flex-wrap gap-1.5">
            {STARTERS.map((s) => (
              <button key={s} type="button" onClick={() => setSent(s)} className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">{s}</button>
            ))}
          </div>
        </div>
      }
    />
  );
}

function ProposalCard({ proposal, doc, assetUrls, decision, onApply, onDismiss }: {
  proposal: Proposal;
  doc: CatalogDocument;
  assetUrls: Record<string, string>;
  decision?: "applied" | "dismissed";
  onApply: (p: Proposal) => void;
  onDismiss: () => void;
}) {
  // Preview: the proposed commands applied to a copy of the current document.
  const preview = useMemo(() => {
    if (decision) return null;
    try {
      const draft = structuredClone(doc);
      applyCommand(draft, { type: "batch", commands: proposal.commands });
      return draft;
    } catch {
      return null;
    }
  }, [doc, proposal, decision]);
  const after = preview?.slides.find((s) => s.id === proposal.slideId);
  const width = 132;

  return (
    <div className="grid gap-2 rounded-xl border bg-background p-3 text-sm">
      <p className="font-medium" dir="auto">{proposal.summary}</p>
      {!decision && after && preview && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {doc.slides.find((s) => s.id === proposal.slideId) && (
            <figure className="grid gap-1"><figcaption>Before</figcaption><div className="overflow-hidden rounded-md border"><SlideView doc={doc} slide={doc.slides.find((s) => s.id === proposal.slideId)!} scale={width / doc.settings.width} mode="edit" resolveAsset={(id) => assetUrls[id]} /></div></figure>
          )}
          <figure className="grid gap-1"><figcaption>After</figcaption><div className="overflow-hidden rounded-md ring-2 ring-primary/60"><SlideView doc={preview} slide={after} scale={width / doc.settings.width} mode="edit" resolveAsset={(id) => assetUrls[id]} /></div></figure>
        </div>
      )}
      {decision ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">{decision === "applied" ? <><HugeiconsIcon icon={Tick01Icon} className="size-3.5" /> Applied</> : "Dismissed"}</p>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" disabled={!preview} onClick={() => onApply(proposal)}>Apply</Button>
          <Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button>
        </div>
      )}
    </div>
  );
}
