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
import { DefaultChatTransport, safeValidateUIMessages, type UIMessage } from "ai";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

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

/** A tool call as the UI sees it (AI SDK "tool-<name>" parts). */
export type ToolPart = {
  type: `tool-${string}`;
  toolCallId: string;
  state: "input-streaming" | "input-available" | "output-available" | "output-error" | string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

/** Pulls the server's `{ error }` message out of a failed chat request. */
function errorMessage(e: Error) {
  try {
    const parsed = JSON.parse(e.message) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    // not JSON
  }
  return e.message || "Something went wrong.";
}

function historyDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/** How many recent messages go to the model with each request (the server accepts up to 80). */
const SEND_LIMIT = 60;
/** How many messages are kept in the browser per conversation. */
const KEEP_LIMIT = 120;

function loadMessages(key?: string): unknown[] {
  if (!key) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "null") as unknown;
    return Array.isArray(raw) ? raw.slice(-KEEP_LIMIT) : [];
  } catch {
    return [];
  }
}

/** Validate browser caches with the same UI message schema used by the server. */
async function validateStoredMessages(messages: unknown): Promise<UIMessage[]> {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const bounded = messages.slice(-KEEP_LIMIT);
  for (let start = 0; start < bounded.length; start += 1) {
    const result = await safeValidateUIMessages({ messages: bounded.slice(start) });
    if (result.success) return result.data;
  }
  return [];
}

function saveMessages(key: string, messages: UIMessage[]) {
  let keep = messages.slice(-KEEP_LIMIT);
  // Drop the oldest messages until it fits in browser storage.
  while (keep.length) {
    try {
      localStorage.setItem(key, JSON.stringify(keep));
      return;
    } catch {
      keep = keep.slice(Math.ceil(keep.length / 4));
    }
  }
  try {
    localStorage.removeItem(key);
  } catch {
    // storage unavailable
  }
}

/**
 * Chat thread (shadcn AI Elements: Message Scroller, Message, Bubble, Input Group)
 * driven by the AI SDK's useChat against /api/chat. Each mode brings its own tools;
 * `renderTool` draws their results (catalog cards, edit proposals).
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
  storageKey,
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
  scopeId?: string;
  /** Keeps the conversation in this browser under this key (e.g. one per catalog), so it's remembered across visits. */
  storageKey?: string;
  /** Open another saved chat's catalog in the editor. */
  onSelectHistory?: (item: ChatHistoryItem) => void;
  /** Active durable conversation thread, independent of its catalog scope. */
  conversationId?: string | null;
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
  renderTool?: (part: ToolPart, message: UIMessage) => ReactNode;
  emptyState?: ReactNode;
  placeholder?: string;
  /** Sent automatically once, e.g. the prompt typed on the landing page. */
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
  const resolvedScopeId = scopeId ?? (mode === "landing" ? "landing" : undefined);
  const contextRef = useRef(context);
  contextRef.current = context;
  const [activeConversationId, setActiveConversationId] = useState<string | null>(conversationId ?? null);
  const activeConversationIdRef = useRef(activeConversationId);
  activeConversationIdRef.current = activeConversationId;
  const onConversationIdChangeRef = useRef(onConversationIdChange);
  onConversationIdChangeRef.current = onConversationIdChange;
  const loadedConversationId = useRef<string | null | undefined>(undefined);
  const chooseConversation = useCallback((id: string) => {
    activeConversationIdRef.current = id;
    setActiveConversationId(id);
    onConversationIdChangeRef.current?.(id);
  }, []);
  useEffect(() => {
    if (conversationId !== undefined && conversationId !== activeConversationIdRef.current) {
      activeConversationIdRef.current = conversationId;
      setActiveConversationId(conversationId);
    }
  }, [conversationId]);
  const pendingSendContext = useRef<{ value: unknown } | null>(null);
  const pendingAnnotationIds = useRef<string[]>([]);
  const serverRevision = useRef<number | null>(null);
  const conversationGeneration = useRef(0);
  const requestSequence = useRef(0);
  const activeRequest = useRef<{ id: number; generation: number } | null>(null);
  const clearingConversation = useRef(false);
  useEffect(() => () => {
    // A stream finishing during thread navigation must not update the next thread's URL or state.
    conversationGeneration.current += 1;
    activeRequest.current = null;
    pendingSendContext.current = null;
    pendingAnnotationIds.current = [];
  }, []);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }) => {
          const pendingContext = pendingSendContext.current;
          pendingSendContext.current = null;
          activeRequest.current = { id: ++requestSequence.current, generation: conversationGeneration.current };
          return {
            body: {
              messages: messages.slice(-KEEP_LIMIT),
              mode,
              scopeId: resolvedScopeId,
              conversationId: activeConversationIdRef.current,
              expectedRevision: serverRevision.current,
              context: pendingContext?.value ?? contextRef.current?.(),
            },
          };
        },
      }),
    [mode, resolvedScopeId],
  );
  const [threadReady, setThreadReady] = useState(!resolvedScopeId);
  const [resyncGeneration, setResyncGeneration] = useState(0);
  const [persistenceStatus, setPersistenceStatus] = useState<"loading" | "account" | "device" | "saving" | "clearing" | "error">(resolvedScopeId ? "loading" : "device");
  const { messages, setMessages, sendMessage, status, stop, error, clearError } = useChat({
    id: storageKey ?? (resolvedScopeId ? `${mode}:${resolvedScopeId}` : undefined),
    // Restore asynchronously after schema validation so an old local cache cannot
    // make useChat fail before the account transcript has a chance to repair it.
    messages: [],
    transport,
    onFinish: async ({ isAbort, isDisconnect, isError }) => {
      const request = activeRequest.current;
      if (!request || request.generation !== conversationGeneration.current || clearingConversation.current) return;
      if (!isAbort && !isDisconnect && !isError && pendingAnnotationIds.current.length) {
        onAnnotationsSent?.(pendingAnnotationIds.current);
      }
      pendingAnnotationIds.current = [];
      if (!resolvedScopeId) return setPersistenceStatus("device");
      const conversationId = activeConversationIdRef.current;
      if (!conversationId) return setPersistenceStatus("device");
      const query = new URLSearchParams({ mode, scopeId: resolvedScopeId, conversationId });
      try {
        const response = await fetch(`/api/chat?${query}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Could not refresh conversation revision");
        const data = await response.json() as { conversationId?: string; revision?: number | null; messages?: unknown[] };
        if (activeRequest.current?.id !== request.id || request.generation !== conversationGeneration.current || clearingConversation.current) return;
        if (data.conversationId) chooseConversation(data.conversationId);
        serverRevision.current = data.revision ?? null;
        if (Array.isArray(data.messages)) {
          const restored = await validateStoredMessages(data.messages);
          if (activeRequest.current?.id !== request.id || request.generation !== conversationGeneration.current || clearingConversation.current) return;
          setMessages(restored);
          if (storageKey && data.conversationId) saveMessages(`${storageKey}:${data.conversationId}`, restored);
        }
        setPersistenceStatus("account");
      } catch {
        if (activeRequest.current?.id === request.id && request.generation === conversationGeneration.current && !clearingConversation.current) setPersistenceStatus("device");
      }
    },
    onError: (cause) => {
      const request = activeRequest.current;
      if (!request || request.generation !== conversationGeneration.current || clearingConversation.current) return;
      activeRequest.current = null;
      pendingAnnotationIds.current = [];
      const message = errorMessage(cause).toLowerCase();
      if (message.includes("conversation changed in another tab") && !clearingConversation.current) {
        setThreadReady(false);
        setPersistenceStatus("loading");
        setResyncGeneration((generation) => generation + 1);
      } else if (!clearingConversation.current) {
        setPersistenceStatus("device");
      }
    },
  });
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [input, setInput] = useState("");
  const sentInitial = useRef<string | undefined>(undefined);
  const busy = status === "submitted" || status === "streaming";
  const conversationSwitching = conversationId !== undefined && conversationId !== activeConversationId;
  const [historyItems, setHistoryItems] = useState<ChatHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyActionError, setHistoryActionError] = useState<string | null>(null);
  const [historyReload, setHistoryReload] = useState(0);
  const [deletingHistoryId, setDeletingHistoryId] = useState<string | null>(null);
  const historyEnabled = mode === "editor" && !!resolvedScopeId;

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

  useEffect(() => {
    if (!resolvedScopeId) return;
    if (activeConversationId && loadedConversationId.current === activeConversationId) return;
    let active = true;
    const generation = ++conversationGeneration.current;
    const requestedId = activeConversationId;
    activeRequest.current = null;
    pendingSendContext.current = null;
    pendingAnnotationIds.current = [];
    if (busy) void stop();
    serverRevision.current = null;
    setThreadReady(false);
    setPersistenceStatus("loading");
    setMessages([]);
    clearError();
    const query = new URLSearchParams({ mode, scopeId: resolvedScopeId });
    if (requestedId) query.set("conversationId", requestedId);
    void fetch(`/api/chat?${query}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load conversation");
        return response.json() as Promise<{ exists?: boolean; conversationId?: string; revision?: number | null; messages?: unknown[] }>;
      })
      .then(async (data) => {
        if (!active || generation !== conversationGeneration.current || clearingConversation.current) return;
        const id = data.conversationId ?? requestedId ?? crypto.randomUUID();
        loadedConversationId.current = id;
        chooseConversation(id);
        serverRevision.current = data.revision ?? null;
        const remote = await validateStoredMessages(data.messages);
        let hasLocalMessages = false;
        if (remote.length || data.exists) {
          setMessages(remote);
          hasLocalMessages = remote.length > 0;
          if (storageKey) saveMessages(`${storageKey}:${id}`, remote);
        } else if (!data.exists) {
          const localCache = loadMessages(storageKey ? `${storageKey}:${id}` : undefined);
          const legacyCache = !requestedId && !localCache.length ? loadMessages(storageKey) : [];
          const local = await validateStoredMessages(localCache.length ? localCache : legacyCache);
          if (active && generation === conversationGeneration.current && !clearingConversation.current) {
            setMessages(local);
            hasLocalMessages = local.length > 0;
            if (storageKey && local.length) saveMessages(`${storageKey}:${id}`, local);
          }
        }
        setPersistenceStatus(data.exists || !hasLocalMessages ? "account" : "device");
      })
      .catch(async () => {
        if (active && generation === conversationGeneration.current && !clearingConversation.current) {
          const id = requestedId ?? crypto.randomUUID();
          loadedConversationId.current = id;
          chooseConversation(id);
          const localCache = loadMessages(storageKey ? `${storageKey}:${id}` : undefined);
          const legacyCache = !requestedId && !localCache.length ? loadMessages(storageKey) : [];
          setMessages(await validateStoredMessages(localCache.length ? localCache : legacyCache));
          setPersistenceStatus("device");
        }
      })
      .finally(() => {
        if (active && generation === conversationGeneration.current && !clearingConversation.current) setThreadReady(true);
      });
    return () => {
      active = false;
    };
  }, [activeConversationId, clearError, chooseConversation, mode, resolvedScopeId, setMessages, storageKey]);

  useEffect(() => {
    if (resolvedScopeId) return;
    let active = true;
    void validateStoredMessages(loadMessages(storageKey)).then((local) => {
      if (active) setMessages(local);
    });
    return () => {
      active = false;
    };
  }, [resolvedScopeId, setMessages, storageKey]);

  useEffect(() => {
    if (!resolvedScopeId || resyncGeneration === 0) return;
    let active = true;
    const generation = conversationGeneration.current;
    const query = new URLSearchParams({ mode, scopeId: resolvedScopeId });
    if (activeConversationId) query.set("conversationId", activeConversationId);
    void fetch(`/api/chat?${query}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not reload conversation");
        return response.json() as Promise<{ exists?: boolean; conversationId?: string; revision?: number | null; messages?: unknown[] }>;
      })
      .then(async (data) => {
        if (!active || generation !== conversationGeneration.current || clearingConversation.current) return;
        if (data.conversationId) chooseConversation(data.conversationId);
        serverRevision.current = data.revision ?? null;
        const remote = await validateStoredMessages(data.messages);
        const remoteIds = new Set(remote.map((message) => message.id));
        const pending = [...messagesRef.current].reverse().find((message) => message.role === "user" && !remoteIds.has(message.id));
        const retryText = pending?.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n").trim();
        if (retryText) setInput(retryText);
        setMessages(remote);
        if (storageKey && data.conversationId) saveMessages(`${storageKey}:${data.conversationId}`, remote);
        setPersistenceStatus("account");
      })
      .catch(() => {
        if (active && generation === conversationGeneration.current && !clearingConversation.current) setPersistenceStatus("device");
      })
      .finally(() => {
        if (active && generation === conversationGeneration.current && !clearingConversation.current) setThreadReady(true);
      });
    return () => {
      active = false;
    };
  }, [activeConversationId, chooseConversation, mode, resyncGeneration, resolvedScopeId, setMessages, storageKey]);

  // Save after each finished reply (not on every streamed token).
  useEffect(() => {
    if (!storageKey || busy || !threadReady) return;
    if (messages.length && activeConversationIdRef.current) saveMessages(`${storageKey}:${activeConversationIdRef.current}`, messages);
  }, [storageKey, messages, busy, threadReady, activeConversationId]);

  function startNewChat(prompt?: string) {
    if (clearingConversation.current) return;
    const id = crypto.randomUUID();
    conversationGeneration.current += 1;
    activeRequest.current = null;
    pendingSendContext.current = null;
    pendingAnnotationIds.current = [];
    if (busy) void stop();
    clearingConversation.current = false;
    serverRevision.current = null;
    sentInitial.current = undefined;
    setThreadReady(false);
    setPersistenceStatus(resolvedScopeId ? "loading" : "device");
    setMessages([]);
    clearError();
    setInput("");
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
      if (item.mode === "editor") {
        try {
          localStorage.removeItem(`kavero:chat:${item.scopeId}:${item.id}`);
          localStorage.removeItem(`kavero:chat:${item.scopeId}`);
          localStorage.removeItem(`kavero:chat-decisions:${item.id}`);
        } catch {
          // Keep the account delete successful when browser storage is unavailable.
        }
      }
      if (item.id === activeConversationIdRef.current) startNewChat();
    } catch (error) {
      setHistoryActionError(error instanceof Error ? error.message : "That chat couldn't be removed. Try again.");
    } finally {
      setDeletingHistoryId(null);
    }
  }

  function openHistoryItem(item: ChatHistoryItem) {
    if (item.mode === mode && item.scopeId === resolvedScopeId && item.id === activeConversationIdRef.current) {
      onHistoryOpenChange?.(false);
      return;
    }
    onSelectHistory?.(item);
  }

  const sendPrompt = useCallback((text: string) => {
    if (!canSend) return;
    pendingSendContext.current = annotations.length ? { value: contextRef.current?.() } : null;
    pendingAnnotationIds.current = annotations.map((annotation) => annotation.id);
    void sendMessage({ text });
  }, [annotations, canSend, sendMessage]);

  useEffect(() => {
    if (!threadReady || !canSend) return;
    const text = initialPrompt?.trim();
    if (!text || sentInitial.current === text) return;
    sentInitial.current = text;
    sendPrompt(text);
    onInitialPromptConsumed?.();
  }, [initialPrompt, sendPrompt, threadReady]);

  const submit = () => {
    const text = input.trim();
    if (!canSend || (!historyOpen && conversationSwitching) || (!text && !annotations.length)) return;
    clearError();
    const message = text || `Use the attached slide element${annotations.length === 1 ? "" : "s"} as context for this conversation.`;
    setInput("");
    if (historyOpen) {
      startNewChat(message);
      return;
    }
    if (busy || !threadReady) return;
    if (resolvedScopeId) setPersistenceStatus("saving");
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
                      {item.scopeId === resolvedScopeId ? "This catalog" : item.catalogTitle || "Catalog " + item.scopeId.slice(0, 8)}
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
                {!messages.length && emptyState}
                {messages.map((m) => (
                  <MessageScrollerItem key={m.id} messageId={m.id} scrollAnchor={m.role === "user"}>
                    <Message align={m.role === "user" ? "end" : "start"}>
                      <MessageContent className="gap-2">
                        {m.parts.map((part, i) => {
                          if (part.type === "text") {
                            if (!part.text.trim()) return null;
                            return (
                              <Bubble key={i} align={m.role === "user" ? "end" : "start"} variant={m.role === "user" ? "muted" : "ghost"}>
                                <BubbleContent className="min-w-0 max-w-full break-words" dir="auto">
                                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{part.text}</ReactMarkdown>
                                </BubbleContent>
                              </Bubble>
                            );
                          }
                          if (part.type.startsWith("tool-") && renderTool) return <div key={i} className="w-full">{renderTool(part as unknown as ToolPart, m)}</div>;
                          return null;
                        })}
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                ))}
                {status === "submitted" && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground"><HugeiconsIcon icon={Loading02Icon} className="size-4 animate-spin" /> Thinking…</p>
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
              {!historyOpen && resolvedScopeId && persistenceStatus !== "account" && (
                <span className="truncate px-1 text-[10px] text-muted-foreground" aria-live="polite">
                  {persistenceStatus === "loading" ? "Loading chat…" : persistenceStatus === "saving" ? "Saving…" : persistenceStatus === "clearing" ? "Clearing…" : persistenceStatus === "error" ? "Account chat couldn't be cleared" : "Saved on this device"}
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

/** Shown instead of the thread when chat can't work yet (signed out, or no model connected). */
export function ChatUnavailable({ reason }: { reason: "signed-out" | "no-model" }) {
  return (
    <div className="m-4 grid gap-2 rounded-xl border p-4 text-sm">
      <p className="font-medium">{reason === "signed-out" ? "Sign in to chat" : "Connect an AI model to chat"}</p>
      <p className="text-muted-foreground">
        {reason === "signed-out"
          ? "Chat uses your connected AI model, so it needs an account. Your catalogs stay in this browser either way."
          : "Add your Claude or OpenRouter key (or a local OpenAI-compatible server) in Settings → AI. Your key stays encrypted on the server."}
      </p>
      <div>
        <Button size="sm" variant="outline" nativeButton={false} render={<a href={reason === "signed-out" ? "/login" : "/settings#ai"} />}>
          {reason === "signed-out" ? "Sign in" : "Open Settings → AI"}
        </Button>
      </div>
    </div>
  );
}
