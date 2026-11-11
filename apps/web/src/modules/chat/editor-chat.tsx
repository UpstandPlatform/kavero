"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Loading02Icon, SparklesIcon, Tick01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@Kavero/ui/components/button";
import type { CatalogDocument, CatalogElement } from "@Kavero/catalog-engine";
import { applyCommand, type Editor, type EditorCommand } from "@Kavero/editor-core";
import { SlideView } from "@Kavero/renderer";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { useRun } from "@/modules/editor/use-catalog-editor";
import { builtInExtensionRenderers } from "@/modules/editor/extensions/built-in-renderers";
import { builtInExtensionEffects } from "@/modules/editor/extensions/built-in-effects";
import { makeTRPCClient } from "@/utils/trpc";

import { ChatThread, ChatUnavailable, type ChatAnnotationAttachment, type ChatHistoryItem, type ToolPart } from "./chat-thread";

let client: ReturnType<typeof makeTRPCClient> | null = null;
const api = () => (client ??= makeTRPCClient());

const STARTERS = ["Make this slide more minimal", "Write a stronger headline for this slide", "Add a slide comparing our three best sellers", "Suggest a color theme for a luxury brand"];

type Proposal = { slideId: string; baseRevision?: number; instruction: string; summary: string; commands: EditorCommand[]; skipped?: string[] };
type ProposalDecision = "applied" | "dismissed";

function loadDecisions(key: string): Record<string, ProposalDecision> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, ProposalDecision] => entry[1] === "applied" || entry[1] === "dismissed"));
  } catch {
    return {};
  }
}
export type EditorChatAnnotationRef = { slideId: string; elementId: string };

function elementLabel(element: CatalogElement, doc: CatalogDocument) {
  if (element.name?.trim()) return element.name.trim();
  switch (element.type) {
    case "text": return element.content.paragraphs.flatMap((paragraph) => paragraph.map((run) => run.text)).join(" ").trim() || "Text element";
    case "image": return element.content.alt || "Image";
    case "shape": return `${element.content.shape[0]!.toUpperCase()}${element.content.shape.slice(1)} shape`;
    case "product": return doc.products.find((product) => product.id === element.content.productId)?.name || "Product card";
    case "product-grid": return `Product grid · ${element.content.products.length} products`;
    case "extension": return `${element.kind} · ${element.extensionId}`;
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
export function EditorChat({ editor, doc, assetUrls, historyOpen, onHistoryOpenChange, annotations = [], annotationMode = false, hoveredAnnotation = null, onAnnotationModeChange, onHoveredAnnotationChange, onRemoveAnnotation, onAnnotationsSent }: {
  editor: Editor;
  doc: CatalogDocument;
  assetUrls: Record<string, string>;
  historyOpen: boolean;
  onHistoryOpenChange: (open: boolean) => void;
  annotations?: EditorChatAnnotationRef[];
  annotationMode?: boolean;
  hoveredAnnotation?: EditorChatAnnotationRef | null;
  onAnnotationModeChange?: (active: boolean) => void;
  onHoveredAnnotationChange?: (annotation: EditorChatAnnotationRef | null) => void;
  onRemoveAnnotation?: (annotation: EditorChatAnnotationRef) => void;
  onAnnotationsSent?: (annotations: EditorChatAnnotationRef[]) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;
  const requestedConversationId = searchParams.get("chatId");
  const [activeConversationId, setActiveConversationId] = useState<string | null>(requestedConversationId);
  const routeSignature = `${pathname}?${requestedConversationId ?? ""}`;
  const lastRouteSignature = useRef(routeSignature);
  useEffect(() => {
    if (lastRouteSignature.current === routeSignature) return;
    lastRouteSignature.current = routeSignature;
    setActiveConversationId(requestedConversationId);
  }, [requestedConversationId, routeSignature]);
  const { data: session, isPending } = authClient.useSession();
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  // Each catalog has its own conversation, remembered in this browser, plus which proposals were applied.
  const chatKey = `kavero:chat:${doc.id}`;
  const decisionsKey = `kavero:chat-decisions:${activeConversationId ?? doc.id}`;
  const [decisionState, setDecisionState] = useState<{ key: string; values: Record<string, ProposalDecision> }>({ key: "", values: {} });
  const decisionStateRef = useRef(decisionState);
  const decided = decisionState.key === decisionsKey ? decisionState.values : {};
  const applying = useRef(new Set<string>());
  useEffect(() => {
    const next = { key: decisionsKey, values: loadDecisions(decisionsKey) };
    decisionStateRef.current = next;
    setDecisionState(next);
  }, [decisionsKey]);
  const setDecided = (toolCallId: string, decision: ProposalDecision) => {
    const snapshot = decisionStateRef.current;
    const current = snapshot.key === decisionsKey ? snapshot.values : loadDecisions(decisionsKey);
    const next = { ...current, [toolCallId]: decision };
    // Bound this browser-only UI cache; the server conversation remains authoritative.
    const bounded = Object.fromEntries(Object.entries(next).slice(-240));
    const state = { key: decisionsKey, values: bounded };
    decisionStateRef.current = state;
    setDecisionState(state);
    try {
      localStorage.setItem(decisionsKey, JSON.stringify(bounded));
    } catch {
      // Chat remains usable when browser storage is unavailable.
    }
  };
  const selectConversation = useCallback((id: string) => {
    setActiveConversationId(id);
    const query = new URLSearchParams(searchParamsRef.current.toString());
    query.set("chatId", id);
    router.replace(`/editor/${encodeURIComponent(doc.id)}?${query.toString()}`, { scroll: false });
  }, [doc.id, router]);
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
          if (applying.current.has(part.toolCallId)) return;
          applying.current.add(part.toolCallId);
          try {
            const current = editor.getDocument();
            if (p.baseRevision !== undefined && current.revision !== p.baseRevision) {
              toast.error("This proposal is out of date. Ask the assistant to prepare it again for the current catalog.");
              return;
            }
            if (!p.commands.length) {
              toast.error("This proposal contains no applicable changes. Ask for a more specific edit.");
              return;
            }
            const preview = structuredClone(current);
            applyCommand(preview, { type: "batch", commands: p.commands });
            if (JSON.stringify(preview) === JSON.stringify(current)) {
              toast.error("This proposal would not change the catalog.");
              return;
            }
            const result = run({ type: "batch", commands: p.commands, label: "AI edit" });
            if (!result || editor.getDocument().revision === current.revision) return;
            editor.setActiveSlide(p.slideId);
            setDecided(part.toolCallId, "applied");
            toast.success("Applied. Press Ctrl+Z to undo.");
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "The proposed change could not be applied.");
          } finally {
            applying.current.delete(part.toolCallId);
          }
        }}
        onDismiss={() => setDecided(part.toolCallId, "dismissed")}
      />
    );
  };

  return (
    <ChatThread
      mode="editor"
      scopeId={doc.id}
      conversationId={activeConversationId}
      onConversationIdChange={selectConversation}
      onStartNewChat={(_id, prompt) => setSent(prompt)}
      onInitialPromptConsumed={() => setSent(undefined)}
      historyOpen={historyOpen}
      onHistoryOpenChange={onHistoryOpenChange}
      canSend={!!aiReady}
      onSelectHistory={(item: ChatHistoryItem) => {
        if (item.mode !== "editor") return;
        onHistoryOpenChange(false);
        if (item.scopeId === doc.id) selectConversation(item.id);
        else router.push(`/editor/${encodeURIComponent(item.scopeId)}?chatId=${encodeURIComponent(item.id)}`);
      }}
      // Give each durable conversation its own AI SDK chat state. Switching threads
      // then cannot let an aborted stream or transient error update another thread.
      key={`${chatKey}:${activeConversationId ?? "initial"}`}
      storageKey={chatKey}
      className="min-h-0 flex-1"
      placeholder="Ask about this catalog or describe a change…"
      initialPrompt={sent}
      annotations={annotationAttachments}
      onAnnotationsSent={(ids) => {
        const sentIds = new Set(ids);
        onAnnotationsSent?.(annotationAttachments.filter((attachment) => sentIds.has(attachment.id)).map((attachment) => attachment.ref));
      }}
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
      emptyState={!aiReady ? <ChatUnavailable reason="no-model" /> :
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
  const stale = proposal.baseRevision !== undefined && proposal.baseRevision !== doc.revision;
  const preview = useMemo(() => {
    if (decision || stale || proposal.commands.length === 0) return null;
    try {
      const draft = structuredClone(doc);
      applyCommand(draft, { type: "batch", commands: proposal.commands });
      return draft;
    } catch {
      return null;
    }
  }, [doc, proposal, decision, stale]);
  const after = preview?.slides.find((s) => s.id === proposal.slideId);
  const width = 132;

  return (
    <div className="grid gap-2 rounded-xl border bg-background p-3 text-sm">
      <p className="font-medium" dir="auto">{proposal.summary}</p>
      {stale && <p role="status" className="text-xs text-muted-foreground">The catalog changed after this proposal was prepared. Ask the assistant to prepare it again.</p>}
      {!proposal.commands.length && <div role="status" className="grid gap-1 text-xs text-muted-foreground"><p>No applicable changes were produced.</p>{proposal.skipped?.slice(0, 4).map((reason, index) => <p key={`${index}:${reason}`}>· {reason}</p>)}</div>}
      {!decision && after && preview && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {doc.slides.find((s) => s.id === proposal.slideId) && (
            <figure className="grid gap-1"><figcaption>Before</figcaption><div className="overflow-hidden rounded-md border"><SlideView doc={doc} slide={doc.slides.find((s) => s.id === proposal.slideId)!} scale={width / doc.settings.width} mode="edit" resolveAsset={(id) => assetUrls[id]} extensionRenderers={builtInExtensionRenderers} extensionEffects={builtInExtensionEffects} /></div></figure>
          )}
          <figure className="grid gap-1"><figcaption>After</figcaption><div className="overflow-hidden rounded-md ring-2 ring-primary/60"><SlideView doc={preview} slide={after} scale={width / doc.settings.width} mode="edit" resolveAsset={(id) => assetUrls[id]} extensionRenderers={builtInExtensionRenderers} extensionEffects={builtInExtensionEffects} /></div></figure>
        </div>
      )}
      {decision ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">{decision === "applied" ? <><HugeiconsIcon icon={Tick01Icon} className="size-3.5" /> Applied</> : "Dismissed"}</p>
      ) : (
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={!preview || stale} onClick={() => onApply(proposal)}>Apply</Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button>
        </div>
      )}
    </div>
  );
}
