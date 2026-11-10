"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUp01Icon, Cancel01Icon, CursorPointer02Icon, Loading02Icon, RotateLeft01Icon, SquareIcon } from "@hugeicons/core-free-icons";
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
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type ChatMode = "landing" | "editor";
export type ChatAnnotationAttachment = { id: string; label: string; detail: string };

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

/** How many recent messages go to the model with each request (the server accepts up to 80). */
const SEND_LIMIT = 60;
/** How many messages are kept in the browser per conversation. */
const KEEP_LIMIT = 120;

function loadMessages(key?: string): UIMessage[] {
  if (!key) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "null") as UIMessage[] | null;
    return Array.isArray(raw) ? raw.filter((m) => m && typeof m === "object" && "role" in m && Array.isArray(m.parts)) : [];
  } catch {
    return [];
  }
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
  hoveredAnnotationId = null,
  onHoverAnnotation,
  annotationMode = false,
  onToggleAnnotationMode,
  storageKey,
  onClear,
}: {
  mode: ChatMode;
  /** Account-level server scope: `landing` or the open catalog id. */
  scopeId?: string;
  /** Keeps the conversation in this browser under this key (e.g. one per catalog), so it's remembered across visits. */
  storageKey?: string;
  /** Called after the user clears the conversation. */
  onClear?: () => void;
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
  hoveredAnnotationId?: string | null;
  onHoverAnnotation?: (id: string | null) => void;
  annotationMode?: boolean;
  onToggleAnnotationMode?: () => void;
}) {
  const resolvedScopeId = scopeId ?? (mode === "landing" ? "landing" : undefined);
  const contextRef = useRef(context);
  contextRef.current = context;
  const serverRevision = useRef<number | null>(null);
  const conversationGeneration = useRef(0);
  const clearingConversation = useRef(false);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: {
            messages: messages.slice(-KEEP_LIMIT),
            mode,
            scopeId: resolvedScopeId,
            expectedRevision: serverRevision.current,
            context: contextRef.current?.(),
          },
        }),
      }),
    [mode, resolvedScopeId],
  );
  // Restore this conversation (read once, before the first render of the thread).
  const [saved] = useState(() => (typeof window === "undefined" ? [] : loadMessages(storageKey)));
  const [threadReady, setThreadReady] = useState(!resolvedScopeId);
  const [resyncGeneration, setResyncGeneration] = useState(0);
  const [persistenceStatus, setPersistenceStatus] = useState<"loading" | "account" | "device" | "saving" | "clearing" | "error">(resolvedScopeId ? "loading" : "device");
  const { messages, setMessages, sendMessage, status, stop, error, clearError } = useChat({
    id: storageKey ?? (resolvedScopeId ? `${mode}:${resolvedScopeId}` : undefined),
    messages: saved,
    transport,
    onFinish: async () => {
      if (!resolvedScopeId) return setPersistenceStatus("device");
      const generation = conversationGeneration.current;
      const query = new URLSearchParams({ mode, scopeId: resolvedScopeId });
      try {
        const response = await fetch(`/api/chat?${query}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Could not refresh conversation revision");
        const data = await response.json() as { revision?: number | null };
        if (generation !== conversationGeneration.current || clearingConversation.current) return;
        serverRevision.current = data.revision ?? null;
        setPersistenceStatus("account");
      } catch {
        if (generation === conversationGeneration.current && !clearingConversation.current) setPersistenceStatus("device");
      }
    },
    onError: (cause) => {
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
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (!resolvedScopeId) return;
    let active = true;
    const generation = conversationGeneration.current;
    const query = new URLSearchParams({ mode, scopeId: resolvedScopeId });
    void fetch(`/api/chat?${query}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load conversation");
        return response.json() as Promise<{ exists?: boolean; revision?: number | null; messages?: unknown[] }>;
      })
      .then((data) => {
        if (!active || generation !== conversationGeneration.current || clearingConversation.current) return;
        serverRevision.current = data.revision ?? null;
        const remote = Array.isArray(data.messages)
          ? data.messages.filter((message): message is UIMessage => !!message && typeof message === "object" && "id" in message && "role" in message && "parts" in message)
          : [];
        if (remote.length || data.exists) {
          setMessages(remote);
          if (storageKey) saveMessages(storageKey, remote);
        }
        setPersistenceStatus(data.exists || !saved.length ? "account" : "device");
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
  }, [mode, resolvedScopeId, saved.length, setMessages, storageKey]);

  useEffect(() => {
    if (!resolvedScopeId || resyncGeneration === 0) return;
    let active = true;
    const generation = conversationGeneration.current;
    const query = new URLSearchParams({ mode, scopeId: resolvedScopeId });
    void fetch(`/api/chat?${query}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not reload conversation");
        return response.json() as Promise<{ exists?: boolean; revision?: number | null; messages?: unknown[] }>;
      })
      .then((data) => {
        if (!active || generation !== conversationGeneration.current || clearingConversation.current) return;
        serverRevision.current = data.revision ?? null;
        const remote = Array.isArray(data.messages)
          ? data.messages.filter((message): message is UIMessage => !!message && typeof message === "object" && "id" in message && "role" in message && "parts" in message)
          : [];
        const remoteIds = new Set(remote.map((message) => message.id));
        const pending = [...messagesRef.current].reverse().find((message) => message.role === "user" && !remoteIds.has(message.id));
        const retryText = pending?.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n").trim();
        if (retryText) setInput(retryText);
        setMessages(remote);
        if (storageKey) saveMessages(storageKey, remote);
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
  }, [mode, resyncGeneration, resolvedScopeId, setMessages, storageKey]);

  // Save after each finished reply (not on every streamed token).
  useEffect(() => {
    if (!storageKey || busy || !threadReady) return;
    if (messages.length) saveMessages(storageKey, messages);
  }, [storageKey, messages, busy, threadReady]);

  const clear = () => {
    if (resolvedScopeId) {
      conversationGeneration.current += 1;
      clearingConversation.current = true;
      setThreadReady(false);
    }
    if (busy) void stop();
    setMessages([]);
    clearError();
    setPersistenceStatus(resolvedScopeId ? "clearing" : "device");
    sentInitial.current = undefined;
    if (storageKey) {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // storage unavailable
      }
    }
    if (resolvedScopeId) {
      const query = new URLSearchParams({ mode, scopeId: resolvedScopeId });
      void fetch(`/api/chat?${query}`, { method: "DELETE" })
        .then(async (response) => {
          if (!response.ok) throw new Error("Could not clear conversation");
          const data = await response.json() as { revision?: number | null };
          serverRevision.current = data.revision ?? null;
          clearingConversation.current = false;
          setPersistenceStatus("account");
          setThreadReady(true);
        })
        .catch(async () => {
          try {
            const query = new URLSearchParams({ mode, scopeId: resolvedScopeId });
            const response = await fetch(`/api/chat?${query}`, { cache: "no-store" });
            if (response.ok) {
              const data = await response.json() as { revision?: number | null; messages?: unknown[] };
              serverRevision.current = data.revision ?? null;
              const remote = Array.isArray(data.messages)
                ? data.messages.filter((message): message is UIMessage => !!message && typeof message === "object" && "id" in message && "role" in message && "parts" in message)
                : [];
              setMessages(remote);
              if (storageKey) saveMessages(storageKey, remote);
            }
          } catch {
            // Keep the locally cleared transcript when the account copy can't be read.
          }
          clearingConversation.current = false;
          setPersistenceStatus("error");
          setThreadReady(true);
        });
    }
    onClear?.();
  };

  const sentInitial = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!threadReady) return;
    const text = initialPrompt?.trim();
    if (!text || sentInitial.current === text) return;
    sentInitial.current = text;
    void sendMessage({ text });
  }, [initialPrompt, sendMessage, threadReady]);

  const submit = () => {
    const text = input.trim();
    if ((!text && !annotations.length) || busy || !threadReady) return;
    clearError();
    if (resolvedScopeId) setPersistenceStatus("saving");
    setInput("");
    const message = text || `Use the attached slide element${annotations.length === 1 ? "" : "s"} as context for this conversation.`;
    void sendMessage({ text: message });
  };

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
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
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={placeholder}
            aria-label={placeholder}
            rows={2}
            className="max-h-40 min-h-20 resize-none px-3 py-3 text-sm leading-relaxed placeholder:text-muted-foreground/80"
            dir="auto"
          />
          <InputGroupAddon align="block-end" className="justify-between gap-2 px-2.5 pb-2.5 pt-1">
            <span className="flex min-w-0 items-center gap-1">
              {resolvedScopeId && (
                <span className="truncate px-1 text-[10px] text-muted-foreground" aria-live="polite">
                  {persistenceStatus === "loading" ? "Loading chat…" : persistenceStatus === "saving" ? "Saving…" : persistenceStatus === "clearing" ? "Clearing…" : persistenceStatus === "error" ? "Account chat couldn't be cleared" : persistenceStatus === "device" ? "Saved on this device" : "Saved to your account"}
                </span>
              )}
              {messages.length > 0 && (
                <TooltipHint content="Start a new chat">
                  <InputGroupButton type="button" size="xs" variant="ghost" onClick={clear}>
                    <HugeiconsIcon icon={RotateLeft01Icon} /> New chat
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
            {busy ? (
              <InputGroupButton type="button" size="icon-sm" variant="secondary" aria-label="Stop" onClick={() => void stop()}><HugeiconsIcon icon={SquareIcon} /></InputGroupButton>
            ) : (
              <InputGroupButton type="submit" size="icon-sm" variant="default" aria-label="Send" disabled={!threadReady || (!input.trim() && !annotations.length)}><HugeiconsIcon icon={ArrowUp01Icon} /></InputGroupButton>
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
