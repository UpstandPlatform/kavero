"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Loading02Icon, SparklesIcon, Tick01Icon } from "@hugeicons/core-free-icons";
import { proposalIsStale } from "@Kavero/api/services/chat-message-utils";
import { Button } from "@Kavero/ui/components/button";
import { catalogElementSchema, createId, markdownTitle, type CatalogDocument, type CatalogElement } from "@Kavero/catalog-engine";import { applyCommand, type Editor, type EditorCommand } from "@Kavero/editor-core";
import { SlideView } from "@Kavero/renderer";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { useRun } from "@/modules/editor/use-catalog-editor";
import { builtInExtensionRenderers } from "@/modules/editor/extensions/built-in-renderers";
import { builtInExtensionEffects } from "@/modules/editor/extensions/built-in-effects";
import { makeTRPCClient } from "@/utils/trpc";
import { MediaJobPreview } from "@/modules/ai/media-job-preview";

import { loadDecisions, saveDecision, type ProposalDecision } from "./chat-local-state";
import { ChatThread, ChatUnavailable, type ChatAnnotationAttachment, type ChatHistoryItem, type ToolPart } from "./chat-thread";

let client: ReturnType<typeof makeTRPCClient> | null = null;
const api = () => (client ??= makeTRPCClient());

const STARTERS = ["Make this slide more minimal", "Write a stronger headline for this slide", "Add a slide comparing our three best sellers", "Suggest a color theme for a luxury brand"];

type Proposal = {
  slideId: string;
  /** Older proposals: stale after any catalog change. */
  baseRevision?: number;
  /** Fingerprints of the slides the proposal touches: stale only when one of those changed. */
  baseSlides?: Record<string, string>;
  instruction: string;
  summary: string;
  commands: EditorCommand[];
  skipped?: string[];
};

function isStale(proposal: Proposal, doc: CatalogDocument) {
  if (proposal.baseSlides) return proposalIsStale(doc, proposal.baseSlides);
  return proposal.baseRevision !== undefined && proposal.baseRevision !== doc.revision;
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
    case "markdown": return markdownTitle(element.content.markdown) || "Markdown";
    case "table": return `Table · ${element.content.rows.length} rows`;
    case "path": return `Path · ${element.content.points.length} points`;
  }
}

function annotationKey(ref: EditorChatAnnotationRef) {
  return JSON.stringify([ref.slideId, ref.elementId]);
}

/**
 * Chat in the editor: the assistant sees the catalog and the current slide, answers
 * questions, and proposes slide edits that the user previews and applies (one undo step each).
 */
export function EditorChat({ editor, doc, assetUrls, uploadImage, uploadVideo, historyOpen, onHistoryOpenChange, annotations = [], annotationMode = false, hoveredAnnotation = null, onAnnotationModeChange, onHoveredAnnotationChange, onRemoveAnnotation, onAnnotationsSent }: {
  editor: Editor;
  doc: CatalogDocument;
  assetUrls: Record<string, string>;
  uploadImage: (file: File) => Promise<{ assetId: string; width: number; height: number }>;
  uploadVideo: (file: File) => Promise<{ assetId: string; width: number; height: number }>;
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
  const searchParams = useSearchParams();
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;
  const requestedConversationId = searchParams.get("chatId");
  // `key` changes only when the user switches threads (history, new chat, URL navigation), so the
  // thread's own id resolution on first load doesn't remount it and download the transcript twice.
  const [thread, setThread] = useState<{ id: string | null; key: number }>({ id: requestedConversationId, key: 0 });
  const threadRef = useRef(thread);
  threadRef.current = thread;
  useEffect(() => {
    if (requestedConversationId && requestedConversationId !== threadRef.current.id) {
      setThread((current) => ({ id: requestedConversationId, key: current.key + 1 }));
    }
  }, [requestedConversationId]);
  const syncUrl = useCallback((id: string) => {
    if (searchParamsRef.current.get("chatId") === id) return;
    const query = new URLSearchParams(searchParamsRef.current.toString());
    query.set("chatId", id);
    router.replace(`/editor/${encodeURIComponent(doc.id)}?${query.toString()}`, { scroll: false });
  }, [doc.id, router]);
  const switchConversation = useCallback((id: string) => {
    threadRef.current = { id, key: threadRef.current.key + 1 };
    setThread(threadRef.current);
    syncUrl(id);
  }, [syncUrl]);
  const resolveConversation = useCallback((id: string) => {
    if (threadRef.current.id !== id) {
      threadRef.current = { ...threadRef.current, id };
      setThread(threadRef.current);
    }
    syncUrl(id);
  }, [syncUrl]);

  const { data: session, isPending } = authClient.useSession();
  const [aiStatus, setAiStatus] = useState<{ configured: boolean; error: string | null } | null>(null);
  const aiReady = aiStatus?.configured ?? null;
  // Which proposals were applied or dismissed, per conversation (bounded browser-only UI state).
  const [decisionState, setDecisionState] = useState<{ id: string | null; values: Record<string, ProposalDecision> }>({ id: null, values: {} });
  const decided = useMemo(() => (decisionState.id === thread.id ? decisionState.values : {}), [decisionState, thread.id]);
  const applying = useRef(new Set<string>());
  useEffect(() => {
    setDecisionState({ id: thread.id, values: loadDecisions(thread.id) });
  }, [thread.id]);
  const setDecided = useCallback((toolCallId: string, decision: ProposalDecision) => {
    const id = threadRef.current.id;
    if (!id) return;
    setDecisionState({ id, values: saveDecision(id, toolCallId, decision) });
  }, []);
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
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;

  useEffect(() => {
    if (!session) return;
    void api().ai.status.query().then((s) => setAiStatus({ configured: s.configured, error: s.error ?? null }), () => setAiStatus({ configured: false, error: null }));
  }, [session]);

  // Proposal previews and staleness follow the document revision; renders for other reasons reuse this callback.
  const revision = doc.revision;
  const renderTool = useCallback((part: ToolPart) => {
    if (part.type === "tool-generate_media") {
      if (part.state === "output-error") return <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">Couldn't start media generation: {part.errorText}</p>;
      if (part.state !== "output-available") return <p className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs text-muted-foreground"><HugeiconsIcon icon={Loading02Icon} className="size-3.5 animate-spin" /> Starting media generation…</p>;
      const output = part.output as { jobId?: string; purpose?: "image" | "video"; error?: string };
      if (output.error || !output.jobId || !output.purpose) return <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{output.error || "Media generation could not be started."}</p>;
      return <MediaJobPreview jobId={output.jobId} purpose={output.purpose} onAdd={async (media, poster) => {
        const activeSlideId = editor.getState().activeSlideId;
        const activeSlide = editor.getDocument().slides.find((candidate) => candidate.id === activeSlideId);
        if (!activeSlide) throw new Error("Choose a slide before adding generated media.");
        const isVideo = media.type.startsWith("video/");
        const main = isVideo ? await uploadVideo(media) : await uploadImage(media);
        let width = main.width || doc.settings.width * 0.55;
        let height = main.height || doc.settings.height * 0.55;
        const scale = Math.min((doc.settings.width * 0.72) / width, (doc.settings.height * 0.72) / height, 1);
        width = Math.round(width * scale); height = Math.round(height * scale);
        const x = Math.round((doc.settings.width - width) / 2);
        const y = Math.round((doc.settings.height - height) / 2);
        const posterAssetId = poster ? (await uploadImage(poster)).assetId : undefined;
        const element = catalogElementSchema.parse({
          id: createId("el"), type: isVideo ? "video" : "image",
          content: isVideo ? { assetId: main.assetId, posterAssetId } : { assetId: main.assetId, alt: media.name },
          position: { x, y, width, height, rotation: 0 },
          style: isVideo ? { autoplay: false, loop: true, muted: true } : { fit: "contain", borderRadius: 0 },
        });
        if (!run({ type: "element.add", slideId: activeSlide.id, element })) throw new Error("The generated media could not be added to the active slide.");
        toast.success(isVideo ? "Video added to the active slide" : "Image added to the active slide");
      }} />;
    }
    if (part.type !== "tool-propose_edit") return null;
    if (part.state === "output-error") return <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">Couldn't prepare the change: {part.errorText}</p>;
    if (part.state !== "output-available") return <p className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs text-muted-foreground"><HugeiconsIcon icon={Loading02Icon} className="size-3.5 animate-spin" /> Preparing a change…</p>;
    return (
      <ProposalCard
        proposal={part.output as Proposal}
        doc={editor.getDocument()}
        revision={revision}
        assetUrls={assetUrls}
        decision={decided[part.toolCallId]}
        onApply={(p) => {
          if (applying.current.has(part.toolCallId)) return;
          applying.current.add(part.toolCallId);
          try {
            const current = editor.getDocument();
            if (isStale(p, current)) {
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
  }, [assetUrls, decided, doc, editor, revision, run, setDecided, uploadImage, uploadVideo]);

  const context = useCallback(() => {
    const s = editor.getState();
    return { document: editor.getDocument(), slideId: s.activeSlideId, selection: s.selection, annotations: annotationsRef.current };
  }, [editor]);

  if (isPending || (session && aiStatus === null)) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  if (!session) return <ChatUnavailable reason="signed-out" />;

  return (
    <ChatThread
      mode="editor"
      scopeId={doc.id}
      conversationId={thread.id}
      onConversationIdChange={resolveConversation}
      onStartNewChat={(id, prompt) => {
        switchConversation(id);
        setSent(prompt);
      }}
      onInitialPromptConsumed={() => setSent(undefined)}
      historyOpen={historyOpen}
      onHistoryOpenChange={onHistoryOpenChange}
      canSend={!!aiReady}
      onSelectHistory={(item: ChatHistoryItem) => {
        if (item.mode !== "editor") return;
        onHistoryOpenChange(false);
        if (item.scopeId === doc.id) switchConversation(item.id);
        else router.push(`/editor/${encodeURIComponent(item.scopeId)}?chatId=${encodeURIComponent(item.id)}`);
      }}
      // Give each durable conversation its own AI SDK chat state. Switching threads
      // then cannot let an aborted stream or transient error update another thread.
      key={`${doc.id}:${thread.key}`}
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
      context={context}
      renderTool={renderTool}
      emptyState={!aiReady ? <ChatUnavailable reason={aiStatus?.error ? "key-error" : "no-model"} detail={aiStatus?.error} /> :
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

function ProposalCard({ proposal, doc, revision, assetUrls, decision, onApply, onDismiss }: {
  proposal: Proposal;
  doc: CatalogDocument;
  /** The revision `doc` belongs to: staleness and the preview are recomputed only when it changes. */
  revision: number;
  assetUrls: Record<string, string>;
  decision?: "applied" | "dismissed";
  onApply: (p: Proposal) => void;
  onDismiss: () => void;
}) {
  const docRef = useRef(doc);
  docRef.current = doc;
  // Staleness is per slide: applying a proposal for another slide keeps this one applicable.
  const stale = useMemo(() => (revision >= 0 ? isStale(proposal, docRef.current) : false), [proposal, revision]);
  // Preview: the proposed commands applied to a copy of the current document.
  const preview = useMemo(() => {
    if (decision || stale || proposal.commands.length === 0 || revision < 0) return null;
    try {
      const draft = structuredClone(docRef.current);
      applyCommand(draft, { type: "batch", commands: proposal.commands });
      return draft;
    } catch {
      return null;
    }
  }, [proposal, decision, stale, revision]);
  const after = preview?.slides.find((s) => s.id === proposal.slideId);
  const before = doc.slides.find((s) => s.id === proposal.slideId);
  const width = 132;

  return (
    <div className="grid gap-2 rounded-xl border bg-background p-3 text-sm">
      <p className="font-medium" dir="auto">{proposal.summary}</p>
      {stale && !decision && <p role="status" className="text-xs text-muted-foreground">This part of the catalog changed after the proposal was prepared. Ask the assistant to prepare it again.</p>}
      {!proposal.commands.length && <div role="status" className="grid gap-1 text-xs text-muted-foreground"><p>No applicable changes were produced.</p>{proposal.skipped?.slice(0, 4).map((reason, index) => <p key={`${index}:${reason}`}>· {reason}</p>)}</div>}
      {!decision && after && preview && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {before && (
            <figure className="grid gap-1"><figcaption>Before</figcaption><div className="overflow-hidden rounded-md border"><SlideView doc={doc} slide={before} scale={width / doc.settings.width} mode="edit" resolveAsset={(id) => assetUrls[id]} extensionRenderers={builtInExtensionRenderers} extensionEffects={builtInExtensionEffects} /></div></figure>
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
