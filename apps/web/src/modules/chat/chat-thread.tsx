"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUp01Icon, Loading02Icon, RotateLeft01Icon, SquareIcon } from "@hugeicons/core-free-icons";
import { useChat } from "@ai-sdk/react";
import { Bubble, BubbleContent } from "@Kavero/ui/components/bubble";
import { Button } from "@Kavero/ui/components/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@Kavero/ui/components/input-group";
import { Message, MessageContent } from "@Kavero/ui/components/message";
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
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type ChatMode = "landing" | "editor";

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
  context,
  renderTool,
  emptyState,
  placeholder = "Message Kavero…",
  initialPrompt,
  className,
  footer,
  storageKey,
  onClear,
}: {
  mode: ChatMode;
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
}) {
  const contextRef = useRef(context);
  contextRef.current = context;
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }) => ({ body: { messages: messages.slice(-SEND_LIMIT), mode, context: contextRef.current?.() } }),
      }),
    [mode],
  );
  // Restore this conversation (read once, before the first render of the thread).
  const [saved] = useState(() => (typeof window === "undefined" ? [] : loadMessages(storageKey)));
  const { messages, setMessages, sendMessage, status, stop, error, clearError } = useChat({ id: storageKey, messages: saved, transport });
  const [input, setInput] = useState("");
  const busy = status === "submitted" || status === "streaming";

  // Save after each finished reply (not on every streamed token).
  useEffect(() => {
    if (!storageKey || busy) return;
    if (messages.length) saveMessages(storageKey, messages);
  }, [storageKey, messages, busy]);

  const clear = () => {
    if (busy) void stop();
    setMessages([]);
    clearError();
    sentInitial.current = undefined;
    if (storageKey) {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // storage unavailable
      }
    }
    onClear?.();
  };

  const sentInitial = useRef<string | undefined>(undefined);
  useEffect(() => {
    const text = initialPrompt?.trim();
    if (!text || sentInitial.current === text) return;
    sentInitial.current = text;
    void sendMessage({ text });
  }, [initialPrompt, sendMessage]);

  const submit = () => {
    const text = input.trim();
    if (!text || busy) return;
    clearError();
    setInput("");
    void sendMessage({ text });
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
                              <BubbleContent className="whitespace-pre-wrap" dir="auto">{part.text}</BubbleContent>
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
        <InputGroup className="rounded-xl bg-background">
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
            className="max-h-40 min-h-16 resize-none"
            dir="auto"
          />
          <InputGroupAddon align="block-end" className="justify-between">
            <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              {messages.length > 0 && (
                <InputGroupButton type="button" size="xs" variant="ghost" onClick={clear} title="Start over: forget this conversation">
                  <HugeiconsIcon icon={RotateLeft01Icon} /> New chat
                </InputGroupButton>
              )}
              <span className="truncate">Enter to send · Shift+Enter for a new line</span>
            </span>
            {busy ? (
              <InputGroupButton type="button" size="icon-sm" variant="secondary" aria-label="Stop" onClick={() => void stop()}><HugeiconsIcon icon={SquareIcon} /></InputGroupButton>
            ) : (
              <InputGroupButton type="submit" size="icon-sm" variant="default" aria-label="Send" disabled={!input.trim()}><HugeiconsIcon icon={ArrowUp01Icon} /></InputGroupButton>
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
