"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, ArrowUp01Icon, Cancel01Icon, Clock01Icon, CursorPointer02Icon, Delete02Icon, Loading02Icon, SquareIcon } from "@hugeicons/core-free-icons";
import { useChat } from "@ai-sdk/react";
import { Bubble, BubbleContent } from "@Kavero/ui/components/bubble";
import { Button } from "@Kavero/ui/components/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@Kavero/ui/components/input-group";
import { Message, MessageContent } from "@Kavero/ui/components/message";
import { TooltipHint } from "@Kavero/ui/components/tooltip";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@Kavero/ui/components/message-scroller";
import { cn } from "@Kavero/ui/lib/utils";
import { DefaultChatTransport, type UIMessage } from "ai";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { forgetDecisions, purgeLegacyTranscriptCache } from "./chat-local-state";

export type ChatMode = "landing" | "editor";
export type ChatAnnotationAttachment = { id: string; label: string; detail: string };
export type ChatHistoryItem = { id: string; mode: ChatMode; scopeId: string; title: string; catalogTitle?: string | null; updatedAt: string };

const markdownComponents: Components = {
  p: ({ children }) => <p className="my-1.5 break-words leading-relaxed first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="mt-3 mb-1.5 text-base font-semibold leading-tight">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-3 mb-1.5 text-sm font-semibold leading-tight">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-2.5 mb-1 text-sm font-medium leading-tight">{children}</h3>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 ps-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 ps-5">{children}</ol>,
  li: ({ children }) => <li className="ps-0.5">{children}</li>,
  blockquote: ({ children }) => <blockquote className="my-2 border-s-2 border-primary/50 ps-3 text-muted-foreground">{children}</blockquote>,
  a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-4 hover:text-primary/80">{children}</a>,
  hr: () => <hr className="my-3 border-border" />,
  table: ({ children }) => (
    <div className="my-2 max-w-full overflow-x-auto rounded-md border border-border/80">
      <table className="w-full border-collapse text-xs leading-relaxed">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/70">{children}</thead>,
  th: ({ children }) => <th className="border-b border-e border-border/80 px-2 py-1.5 text-start font-medium last:border-e-0">{children}</th>,
  td: ({ children }) => <td className="border-b border-e border-border/70 px-2 py-1.5 align-top last:border-e-0">{children}</td>,
  tr: ({ children }) => <tr className="last:[&>td]:border-b-0">{children}</tr>,
  pre: ({ children }) => <pre className="my-2 max-w-full overflow-x-auto rounded-lg bg-muted/70 p-3 text-xs leading-relaxed">{children}</pre>,
  code: ({ children, className }) => <code className={cn("font-mono text-[0.92em]", className ? "" : "rounded bg-muted px-1 py-0.5")}>{children}</code>,
};
const remarkPlugins = [remarkGfm];

/** A tool call as the UI sees it (AI SDK "tool-<name>" parts). */
export type ToolPart = {
  type: `tool-${string}`;
  toolCallId: string;
  state: "input-streaming" | "input-available" | "output-available" | "output-error" | string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

/** Sent by the server on the assistant message (see /api/chat messageMetadata). */
type TurnMetadata = { conversationId?: string; turnRevision?: number; revision?: number };
type ChatErrorBody = { error?: string; code?: string };
type LoadResponse = { exists?: boolean; conversationId?: string; revision?: number | null; messages?: unknown[] };

/** The server's `{ error, code }` from a failed chat request. */
function errorBody(e: Error): ChatErrorBody {
  try {
    const parsed = JSON.parse(e.message) as unknown;
    if (parsed && typeof parsed === "object") return parsed as ChatErrorBody;
  } catch {
    // not JSON
  }
  return {};
}

function errorMessage(e: Error) {
  return errorBody(e).error || e.message || "Something went wrong.";
}

function textOf(message: UIMessage) {
  return message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n").trim();
}

function historyDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Markdown is parsed only when the text itself changes (not on every keystroke or streamed token elsewhere). */
const MarkdownText = memo(function MarkdownText({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>{text}</ReactMarkdown>;
});

type RenderTool = (part: ToolPart, message: UIMessage) => ReactNode;

const MessageItem = memo(function MessageItem({ message, renderTool }: { message: UIMessage; renderTool?: RenderTool }) {
  const fromUser = message.role === "user";
  return (
    <MessageScrollerItem messageId={message.id} scrollAnchor={fromUser}>
      <Message align={fromUser ? "end" : "start"}>
        <MessageContent className="gap-2">
          {message.parts.map((part, i) => {
            if (part.type === "text") {
              if (!part.text.trim()) return null;
              return (
                <Bubble key={i} align={fromUser ? "end" : "start"} variant={fromUser ? "muted" : "ghost"}>
                  <BubbleContent className="min-w-0 max-w-full break-words" dir="auto">
                    <MarkdownText text={part.text} />
                  </BubbleContent>
                </Bubble>
              );
            }
            if (part.type.startsWith("tool-") && renderTool) return <div key={i} className="w-full">{renderTool(part as unknown as ToolPart, message)}</div>;
            return null;
          })}
        </MessageContent>
      </Message>
    </MessageScrollerItem>
  );
});

/**
 * Chat thread (shadcn AI Elements: Message Scroller, Message, Bubble, Input Group)
 * driven by the AI SDK's useChat against /api/chat. The account copy on the server is the
 * only transcript: each request carries just the new user message and the revision it builds on.
 * Each mode brings its own tools; `renderTool` draws their results (catalog cards, edit proposals).
 */
export function ChatThread({
  mode,
  scopeId,
  context,
  renderTool,
  emptyState,
  placeholder = "Message Kavero…",
  initialPrompt,
  className,
  footer,
  annotations = [],
  onRemoveAnnotation,
  onAnnotationsSent,
  hoveredAnnotationId = null,
  onHoverAnnotation,
  annotationMode = false,
  onToggleAnnotationMode,
  onSelectHistory,
  historyOpen = false,
  onHistoryOpenChange,
  canSend = true,
  conversationId,
  onConversationIdChange,
  onStartNewChat,
  onInitialPromptConsumed,
}: {
  mode: ChatMode;
  /** Account-level server scope: `landing` or the open catalog id. */
  scopeId: string;
  /** Open another saved chat's catalog in the editor. */
  onSelectHistory?: (item: ChatHistoryItem) => void;
  /** Active durable conversation thread, independent of its catalog scope. */
  conversationId?: string | null;
  /** Called when the thread's id is resolved (first load) or replaced (unavailable chat). */
  onConversationIdChange?: (id: string) => void;
  /** Start a separate conversation and optionally send its first prompt. */
  onStartNewChat?: (id: string, prompt?: string) => void;
  onInitialPromptConsumed?: () => void;
  /** Control the history surface from the editor panel header. */
  historyOpen?: boolean;
  onHistoryOpenChange?: (open: boolean) => void;
  /** Keep saved history readable when no model is currently connected. */
  canSend?: boolean;
  /** Sent with every request (editor: the open catalog and current slide). */
  context?: () => unknown;
  renderTool?: RenderTool;
  emptyState?: ReactNode;
  placeholder?: string;
  /** Sent automatically once per value, e.g. the prompt typed on the landing page. */
  initialPrompt?: string;
  className?: string;
  footer?: ReactNode;
  annotations?: ChatAnnotationAttachment[];
  onRemoveAnnotation?: (id: string) => void;
  onAnnotationsSent?: (ids: string[]) => void;
  hoveredAnnotationId?: string | null;
  onHoverAnnotation?: (id: string | null) => void;
  annotationMode?: boolean;
  onToggleAnnotationMode?: () => void;
}) {
  const contextRef = useRef(context);
  contextRef.current = context;
  const onAnnotationsSentRef = useRef(onAnnotationsSent);
  onAnnotationsSentRef.current = onAnnotationsSent;
  const onInitialPromptConsumedRef = useRef(onInitialPromptConsumed);
  onInitialPromptConsumedRef.current = onInitialPromptConsumed;
  const onConversationIdChangeRef = useRef(onConversationIdChange);
  onConversationIdChangeRef.current = onConversationIdChange;

  const [activeConversationId, setActiveConversationId] = useState<string | null>(conversationId ?? null);
  const activeConversationIdRef = useRef(activeConversationId);
  activeConversationIdRef.current = activeConversationId;
  const chooseConversation = useCallback((id: string) => {
    activeConversationIdRef.current = id;
    setActiveConversationId(id);
    onConversationIdChangeRef.current?.(id);
  }, []);
  useEffect(() => {
    if (conversationId && conversationId !== activeConversationIdRef.current) {
      activeConversationIdRef.current = conversationId;
      setActiveConversationId(conversationId);
    }
  }, [conversationId]);

  const pendingSendContext = useRef<{ value: unknown } | null>(null);
  const pendingAnnotationIds = useRef<string[]>([]);
  /** The revision the next turn builds on (null: the conversation doesn't exist yet). */
  const serverRevision = useRef<number | null>(null);
  /** Bumped whenever the thread changes, so late callbacks from an older thread are ignored. */
  const conversationGeneration = useRef(0);
  const requestSequence = useRef(0);
  const activeRequest = useRef<{ id: number; generation: number } | null>(null);
  const lastFailure = useRef<ChatErrorBody | null>(null);
  const loadedConversationId = useRef<string | null | undefined>(undefined);
  /** After a reload: a message to put back in the box if the server doesn't have it, and why. */
  const restoreOnReload = useRef<{ message?: UIMessage; notice?: string } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    purgeLegacyTranscriptCache();
    return () => {
      // A stream finishing during thread navigation must not update the next thread's URL or state.
      conversationGeneration.current += 1;
      activeRequest.current = null;
      pendingSendContext.current = null;
      pendingAnnotationIds.current = [];
    };
  }, []);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }) => {
          const pendingContext = pendingSendContext.current;
          pendingSendContext.current = null;
          activeRequest.current = { id: ++requestSequence.current, generation: conversationGeneration.current };
          lastFailure.current = null;
          return {
            body: {
              // Only the new turn: the server rebuilds the history from the account copy.
              message: messages.at(-1),
              mode,
              scopeId,
              conversationId: activeConversationIdRef.current,
              expectedRevision: serverRevision.current,
              context: pendingContext?.value ?? contextRef.current?.(),
            },
          };
        },
      }),
    [mode, scopeId],
  );
  const [threadReady, setThreadReady] = useState(false);
  const [persistenceStatus, setPersistenceStatus] = useState<"loading" | "account" | "saving" | "error">("loading");
  const [input, setInput] = useState("");

  /** Reload the thread from the account copy, optionally putting an unsaved message back in the box. */
  const resync = useCallback((message?: UIMessage, reason?: string) => {
    restoreOnReload.current = { message, notice: reason };
    loadedConversationId.current = undefined;
    setReloadToken((token) => token + 1);
  }, []);

  const { messages, setMessages, sendMessage, status, stop, error, clearError } = useChat({
    id: `${mode}:${scopeId}`,
    messages: [],
    transport,
    onError: (cause) => {
      // Handled in onFinish, which always follows; remember the server's error code for it.
      if (activeRequest.current?.generation === conversationGeneration.current) lastFailure.current = errorBody(cause);
    },
    onFinish: ({ message, messages: current, isAbort, isDisconnect, isError }) => {
      const request = activeRequest.current;
      if (!request || request.generation !== conversationGeneration.current) return;
      activeRequest.current = null;
      const failure = lastFailure.current;
      lastFailure.current = null;
      const annotationIds = pendingAnnotationIds.current;
      pendingAnnotationIds.current = [];
      const meta = message.role === "assistant" ? (message.metadata as TurnMetadata | undefined) : undefined;

      if (typeof meta?.turnRevision !== "number") {
        // The server never started this turn (rejected, conflict) or we can't tell (stopped before it answered).
        const last = current.at(-1);
        const unsent = last?.role === "user" ? last : undefined;
        if (failure?.code === "conversation_not_found") {
          restoreOnReload.current = { message: unsent, notice: "That chat isn't available anymore, so a new one was started. Your message is back in the box." };
          loadedConversationId.current = undefined;
          chooseConversation(crypto.randomUUID());
        } else if (failure?.code === "conversation_conflict") {
          resync(unsent, "This chat changed in another tab, so it was reloaded. Your message is back in the box.");
        } else if (isAbort || isDisconnect) {
          resync(unsent);
        } else {
          if (unsent) {
            setMessages(current.filter((item) => item.id !== unsent.id));
            const text = textOf(unsent);
            setInput((value) => (value.trim() ? value : text));
          }
          setPersistenceStatus("account");
        }
        return;
      }
      if (!isAbort && !isDisconnect && !isError && typeof meta.revision === "number") {
        serverRevision.current = meta.revision;
        setPersistenceStatus("account");
        if (annotationIds.length) onAnnotationsSentRef.current?.(annotationIds);
        return;
      }
      // Stopped or failed mid-answer: the server saves what was produced. Keep it on screen and wait for that save.
      const id = activeConversationIdRef.current;
      if (id) void refreshRevision(id, meta.turnRevision, request.generation);
    },
  });

  // Learn the revision after an interrupted turn without downloading the transcript again.
  async function refreshRevision(id: string, turnRevision: number, generation: number) {
    setThreadReady(false);
    setPersistenceStatus("saving");
    let revision: number | null | undefined;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const response = await fetch(`/api/chat?${new URLSearchParams({ mode, scopeId, conversationId: id, meta: "1" })}`, { cache: "no-store" });
        if (response.ok) {
          revision = ((await response.json()) as LoadResponse).revision ?? null;
          if (revision !== null && revision > turnRevision) break;
        }
      } catch {
        // retry
      }
      if (generation !== conversationGeneration.current) return;
      await wait(400);
    }
    if (generation !== conversationGeneration.current) return;
    if (revision === undefined) return resync();
    serverRevision.current = revision;
    setPersistenceStatus("account");
    setThreadReady(true);
  }

  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const busy = status === "submitted" || status === "streaming";
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const stopRef = useRef(stop);
  stopRef.current = stop;
  const sentInitial = useRef<string | undefined>(undefined);
  const conversationSwitching = !!conversationId && conversationId !== activeConversationId;
  const [historyItems, setHistoryItems] = useState<ChatHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyActionError, setHistoryActionError] = useState<string | null>(null);
  const [historyReload, setHistoryReload] = useState(0);
  const [deletingHistoryId, setDeletingHistoryId] = useState<string | null>(null);
  const historyEnabled = mode === "editor";

  useEffect(() => {
    if (!historyOpen || !historyEnabled) return;
    let active = true;
    const query = new URLSearchParams({ history: "1", mode });
    setHistoryLoading(true);
    setHistoryError(null);
    setHistoryActionError(null);
    void fetch("/api/chat?" + query, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Chat history couldn't be loaded.");
        return response.json() as Promise<{ items?: ChatHistoryItem[] }>;
      })
      .then((data) => {
        if (active) setHistoryItems(Array.isArray(data.items) ? data.items : []);
      })
      .catch((error) => {
        if (active) setHistoryError(error instanceof Error ? error.message : "Chat history couldn't be loaded.");
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [historyOpen, historyEnabled, historyReload, mode]);

  // Load (or reload) the account copy of the active thread.
  useEffect(() => {
    if (activeConversationId && loadedConversationId.current === activeConversationId) return;
    let active = true;
    const generation = ++conversationGeneration.current;
    const requestedId = activeConversationId;
    activeRequest.current = null;
    pendingSendContext.current = null;
    pendingAnnotationIds.current = [];
    if (busyRef.current) void stopRef.current();
    serverRevision.current = null;
    setThreadReady(false);
    setPersistenceStatus("loading");
    clearError();
    const query = new URLSearchParams({ mode, scopeId });
    if (requestedId) query.set("conversationId", requestedId);
    void (async () => {
      try {
        const response = await fetch(`/api/chat?${query}`, { cache: "no-store" });
        if (!active || generation !== conversationGeneration.current) return;
        if (response.status === 404 && requestedId) {
          // Deleted elsewhere or not this user's chat: start a fresh thread instead of failing every send.
          restoreOnReload.current = { ...restoreOnReload.current, notice: "That chat isn't available anymore, so a new one was started." };
          loadedConversationId.current = undefined;
          chooseConversation(crypto.randomUUID());
          return;
        }
        if (!response.ok) throw new Error("Could not load conversation");
        const data = (await response.json()) as LoadResponse;
        if (!active || generation !== conversationGeneration.current) return;
        const id = data.conversationId ?? requestedId ?? crypto.randomUUID();
        // The server validated and repaired the transcript before sending it.
        const restored = Array.isArray(data.messages) ? (data.messages as UIMessage[]) : [];
        loadedConversationId.current = id;
        if (id !== activeConversationIdRef.current || !requestedId) chooseConversation(id);
        serverRevision.current = data.revision ?? null;
        setMessages(restored);
        const restore = restoreOnReload.current;
        restoreOnReload.current = null;
        if (restore?.message && !restored.some((item) => item.id === restore.message!.id)) {
          const text = textOf(restore.message);
          setInput((value) => (value.trim() ? value : text));
        }
        if (restore?.notice) setNotice(restore.notice);
        setPersistenceStatus("account");
        setThreadReady(true);
      } catch {
        if (!active || generation !== conversationGeneration.current) return;
        // Without the account copy we can't know the revision, so sending stays disabled until a retry works.
        setMessages([]);
        setPersistenceStatus("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [activeConversationId, reloadToken, chooseConversation, clearError, mode, scopeId, setMessages]);

  function startNewChat(prompt?: string) {
    const id = crypto.randomUUID();
    conversationGeneration.current += 1;
    activeRequest.current = null;
    pendingSendContext.current = null;
    pendingAnnotationIds.current = [];
    if (busy) void stop();
    serverRevision.current = null;
    sentInitial.current = undefined;
    restoreOnReload.current = null;
    setThreadReady(false);
    setPersistenceStatus("loading");
    setMessages([]);
    clearError();
    setInput("");
    setNotice(null);
    chooseConversation(id);
    onHistoryOpenChange?.(false);
    onStartNewChat?.(id, prompt);
  }

  async function deleteHistoryItem(item: ChatHistoryItem) {
    setDeletingHistoryId(item.id);
    setHistoryActionError(null);
    try {
      const query = new URLSearchParams({ historyId: item.id });
      const response = await fetch("/api/chat?" + query, { method: "DELETE" });
      if (!response.ok) throw new Error("That chat couldn't be removed. Try again.");
      setHistoryItems((current) => current.filter((entry) => entry.id !== item.id));
      forgetDecisions(item.id);
      if (item.id === activeConversationIdRef.current) startNewChat();
    } catch (error) {
      setHistoryActionError(error instanceof Error ? error.message : "That chat couldn't be removed. Try again.");
    } finally {
      setDeletingHistoryId(null);
    }
  }

  function openHistoryItem(item: ChatHistoryItem) {
    if (item.mode === mode && item.scopeId === scopeId && item.id === activeConversationIdRef.current) {
      onHistoryOpenChange?.(false);
      return;
    }
    onSelectHistory?.(item);
  }

  const sendPrompt = useCallback((text: string) => {
    if (!canSend || busyRef.current) return;
    setNotice(null);
    setPersistenceStatus("saving");
    pendingSendContext.current = annotations.length ? { value: contextRef.current?.() } : null;
    pendingAnnotationIds.current = annotations.map((annotation) => annotation.id);
    void sendMessage({ text });
  }, [annotations, canSend, sendMessage]);

  useEffect(() => {
    const text = initialPrompt?.trim();
    // Once consumed (or cleared), the same prompt can be sent again later.
    if (!text) {
      sentInitial.current = undefined;
      return;
    }
    if (!threadReady || !canSend || sentInitial.current === text) return;
    sentInitial.current = text;
    sendPrompt(text);
    onInitialPromptConsumedRef.current?.();
  }, [canSend, initialPrompt, sendPrompt, threadReady]);

  const submit = () => {
    const text = input.trim();
    if (!canSend || (!historyOpen && conversationSwitching) || (!text && !annotations.length)) return;
    const message = text || `Use the attached slide element${annotations.length === 1 ? "" : "s"} as context for this conversation.`;
    if (historyOpen) {
      setInput("");
      startNewChat(message);
      return;
    }
    if (busy || !threadReady) return;
    clearError();
    setInput("");
    sendPrompt(message);
  };

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {historyOpen ? (
        <section aria-label="Chat history" className="min-h-0 flex-1 overflow-y-auto p-3">
          <header className="mb-3 flex items-start justify-between gap-3 px-1">
            <div className="grid gap-0.5">
              <h2 className="flex items-center gap-2 text-sm font-semibold"><HugeiconsIcon icon={Clock01Icon} className="size-4 text-muted-foreground" /> Chat history</h2>
              <p className="text-xs text-muted-foreground">Your saved catalog conversations.</p>
            </div>
            {!historyLoading && !historyError && <span className="pt-0.5 text-[11px] text-muted-foreground">{historyItems.length} saved</span>}
          </header>
          {historyActionError && <p role="alert" className="mb-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{historyActionError}</p>}
          {historyLoading ? (
            <p className="flex items-center gap-2 rounded-xl border bg-muted/20 p-3 text-xs text-muted-foreground"><HugeiconsIcon icon={Loading02Icon} className="size-3.5 animate-spin" /> Loading your chats…</p>
          ) : historyError ? (
            <div role="alert" className="grid gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs">
              <p className="text-destructive">{historyError}</p>
              <Button type="button" size="sm" variant="outline" className="w-fit" onClick={() => setHistoryReload((value) => value + 1)}>Try again</Button>
            </div>
          ) : historyItems.length ? (
            <ul className="grid gap-2">
              {historyItems.map((item) => (
                <li key={item.id} className="flex min-w-0 items-center gap-1 rounded-xl border bg-background p-1.5 transition-colors hover:bg-muted/30">
                  <button type="button" onClick={() => openHistoryItem(item)} className="grid min-w-0 flex-1 gap-1 px-2 py-1.5 text-start focus-visible:outline-2 focus-visible:outline-ring">
                    <span className="w-full truncate text-xs font-medium" title={item.title}>{item.title}</span>
                    <span className="w-full truncate text-[10px] text-muted-foreground">
                      {item.scopeId === scopeId ? "This catalog" : item.catalogTitle || "Catalog " + item.scopeId.slice(0, 8)}
                      <span aria-hidden="true"> · </span>{historyDate(item.updatedAt)}
                    </span>
                  </button>
                  <TooltipHint content="Remove chat from history">
                    <Button type="button" variant="ghost" size="icon-xs" aria-label={"Remove " + item.title + " from chat history"} disabled={deletingHistoryId === item.id} onClick={() => void deleteHistoryItem(item)}>
                      {deletingHistoryId === item.id ? <HugeiconsIcon icon={Loading02Icon} className="animate-spin" /> : <HugeiconsIcon icon={Delete02Icon} />}
                    </Button>
                  </TooltipHint>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">Your saved chats will appear here after you send a message.</p>
          )}
        </section>
      ) : (
        <MessageScrollerProvider autoScroll>
          <MessageScroller className="min-h-0 flex-1">
            <MessageScrollerViewport>
              <MessageScrollerContent className="gap-4 p-4">
                {!messages.length && persistenceStatus !== "error" && emptyState}
                {messages.map((m) => <MessageItem key={m.id} message={m} renderTool={renderTool} />)}
                {status === "submitted" && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground"><HugeiconsIcon icon={Loading02Icon} className="size-4 animate-spin" /> Thinking…</p>
                )}
                {notice && <p role="status" className="rounded-xl border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">{notice}</p>}
                {persistenceStatus === "error" && (
                  <div role="alert" className="grid gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
                    <p className="text-destructive">This conversation couldn't be loaded.</p>
                    <Button type="button" size="sm" variant="outline" className="w-fit" onClick={() => resync()}>Try again</Button>
                  </div>
                )}
                {error && (
                  <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{errorMessage(error)}</p>
                )}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </MessageScroller>
        </MessageScrollerProvider>
      )}

      <form
        className="shrink-0 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {annotations.length > 0 && (
          <div role="group" className="mb-2 min-w-0" aria-label="Prompt context attachments">
            <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto overflow-y-hidden pb-1">
              {annotations.map((annotation) => (
                <TooltipHint key={annotation.id} content={`${annotation.label} · ${annotation.detail}`}>
                  <div
                    role="group"
                    tabIndex={0}
                    aria-label={`${annotation.label}, ${annotation.detail}`}
                    data-hovered={hoveredAnnotationId === annotation.id ? "true" : undefined}
                    onPointerEnter={() => onHoverAnnotation?.(annotation.id)}
                    onPointerLeave={() => onHoverAnnotation?.(null)}
                    onFocus={() => onHoverAnnotation?.(annotation.id)}
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onHoverAnnotation?.(null);
                    }}
                    className="group/chip flex h-7 max-w-48 shrink-0 items-center gap-1 rounded-full border border-border/80 bg-muted/35 py-0.5 ps-2 pe-1 text-[11px] text-foreground transition-colors hover:border-primary/50 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring data-[hovered=true]:border-primary data-[hovered=true]:bg-primary/10"
                  >
                    <span className="size-1.5 shrink-0 rounded-full bg-primary/70" aria-hidden="true" />
                    <span className="max-w-32 truncate">{annotation.label}</span>
                    <Button type="button" variant="ghost" size="icon-xs" className="size-5 shrink-0 rounded-full p-0" aria-label={`Remove ${annotation.label} from prompt context`} onClick={() => onRemoveAnnotation?.(annotation.id)}>
                      <HugeiconsIcon icon={Cancel01Icon} />
                    </Button>
                  </div>
                </TooltipHint>
              ))}
            </div>
          </div>
        )}
        <InputGroup className="rounded-2xl border border-border/80 bg-background shadow-sm transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
          <InputGroupTextarea
            value={input}
            disabled={!canSend || (!historyOpen && conversationSwitching)}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (canSend && e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={canSend ? placeholder : "Connect an AI model to send a message"}
            aria-label={canSend ? placeholder : "Connect an AI model to send a message"}
            rows={2}
            className="max-h-40 min-h-20 resize-none px-3 py-3 text-sm leading-relaxed placeholder:text-muted-foreground/80"
            dir="auto"
          />
          <InputGroupAddon align="block-end" className="justify-between gap-2 px-2.5 pb-2.5 pt-1">
            <span className="flex min-w-0 items-center gap-1">
              {!historyOpen && (persistenceStatus === "loading" || persistenceStatus === "saving") && (
                <span className="truncate px-1 text-[10px] text-muted-foreground" aria-live="polite">
                  {persistenceStatus === "loading" ? "Loading chat…" : "Saving…"}
                </span>
              )}
              {onStartNewChat && (
                <TooltipHint content="Start a new chat">
                  <InputGroupButton type="button" size="icon-sm" variant="ghost" aria-label="Start a new chat" onClick={() => startNewChat()}>
                    <HugeiconsIcon icon={Add01Icon} />
                  </InputGroupButton>
                </TooltipHint>
              )}
              {onToggleAnnotationMode && (
                <TooltipHint content={annotationMode ? "Finish selecting slide elements" : "Attach slide elements to your prompt"}>
                  <InputGroupButton type="button" size="icon-sm" variant={annotationMode ? "secondary" : "ghost"} aria-label={annotationMode ? "Finish selecting elements" : "Annotate slide elements"} aria-pressed={annotationMode} onClick={onToggleAnnotationMode}>
                    <HugeiconsIcon icon={CursorPointer02Icon} />
                  </InputGroupButton>
                </TooltipHint>
              )}
            </span>
            {busy && !historyOpen ? (
              <InputGroupButton type="button" size="icon-sm" variant="secondary" aria-label="Stop" onClick={() => void stop()}><HugeiconsIcon icon={SquareIcon} /></InputGroupButton>
            ) : (
              <InputGroupButton type="submit" size="icon-sm" variant="default" aria-label={historyOpen ? "Start a new chat" : "Send"} disabled={!canSend || (!historyOpen && (conversationSwitching || !threadReady)) || (!input.trim() && !annotations.length)}><HugeiconsIcon icon={ArrowUp01Icon} /></InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
        {footer}
      </form>
    </div>
  );
}

/** Shown instead of the thread when chat can't work yet (signed out, no model, or a broken personal key). */
export function ChatUnavailable({ reason, detail }: { reason: "signed-out" | "no-model" | "key-error"; detail?: string | null }) {
  const title = reason === "signed-out" ? "Sign in to chat" : reason === "key-error" ? "Your AI key couldn't be used" : "Connect an AI model to chat";
  const body = reason === "signed-out"
    ? "Chat uses your connected AI model, so it needs an account. Your catalogs stay in this browser either way."
    : reason === "key-error"
      ? detail || "Check the key, model and server URL in Settings → AI."
      : "Add your Claude or OpenRouter key (or a local OpenAI-compatible server) in Settings → AI. Your key stays encrypted on the server.";
  return (
    <div className="m-4 grid gap-2 rounded-xl border p-4 text-sm">
      <p className="font-medium">{title}</p>
      <p className="text-muted-foreground">{body}</p>
      <div>
        <Button size="sm" variant="outline" nativeButton={false} render={<a href={reason === "signed-out" ? "/login" : "/settings#ai"} />}>
          {reason === "signed-out" ? "Sign in" : "Open Settings → AI"}
        </Button>
      </div>
    </div>
  );
}
