"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUp01Icon, Cancel01Icon, Loading02Icon, Presentation01Icon, SparklesIcon } from "@hugeicons/core-free-icons";
import { Button } from "@Kavero/ui/components/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@Kavero/ui/components/input-group";
import type { CatalogDocument } from "@Kavero/catalog-engine";
import { SlideView } from "@Kavero/renderer";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { saveLocalCatalog } from "@/modules/catalog/local-catalogs";
import { makeTRPCClient } from "@/utils/trpc";

import { ChatThread, type ToolPart } from "./chat-thread";

const SUGGESTIONS = [
  "A spring linen lookbook",
  "A coffee machine price list",
  "A warm, elegant jewelry pitch deck",
  "A Persian home appliance catalog",
];

let client: ReturnType<typeof makeTRPCClient> | null = null;
const api = () => (client ??= makeTRPCClient());

/**
 * "Start with a prompt" on the home page. With a connected AI model the prompt opens
 * a chat that creates the catalog; otherwise it goes to Generate with AI (built-in planner).
 */
export function LandingPrompt() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [prompt, setPrompt] = useState("");
  const [started, setStarted] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    void api().ai.status.query().then((s) => setAiReady(s.configured), () => setAiReady(false));
  }, [session]);

  const start = (text: string) => {
    const t = text.trim();
    if (!t) return;
    if (session && aiReady) return setStarted(t);
    // No model to chat with: the dashboard's Generate with AI uses the built-in planner.
    router.push(`/dashboard?generate=1&brief=${encodeURIComponent(t.slice(0, 2000))}` as Route);
  };

  if (started) {
    return (
      <div className="flex h-[min(640px,75vh)] flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b px-4 py-2">
          <p className="flex items-center gap-2 text-sm font-medium"><HugeiconsIcon icon={SparklesIcon} className="size-4" /> Kavero assistant</p>
          <Button variant="ghost" size="icon-sm" aria-label="Close chat" onClick={() => setStarted(null)}><HugeiconsIcon icon={Cancel01Icon} /></Button>
        </div>
        <ChatThread mode="landing" initialPrompt={started} renderTool={(part) => <CreateCatalogPart part={part} />} placeholder="Reply or add details…" className="min-h-0 flex-1" />
      </div>
    );
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(prompt);
      }}
    >
      <InputGroup className="rounded-xl border bg-background shadow-sm">
        <InputGroupTextarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              start(prompt);
            }
          }}
          placeholder="Describe the catalog or presentation you want to make…"
          aria-label="Describe the catalog you want to make"
          rows={3}
          className="min-h-20 resize-none text-base"
          dir="auto"
        />
        <InputGroupAddon align="block-end" className="justify-between">
          <span className="text-xs text-muted-foreground">
            {isPending ? " " : session && aiReady ? "Chat with your AI model" : "Generates with Kavero's built-in planner · connect a model for chat"}
          </span>
          <InputGroupButton type="submit" size="icon-sm" variant="default" aria-label="Start" disabled={!prompt.trim()}><HugeiconsIcon icon={ArrowUp01Icon} /></InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setPrompt(s)}
            className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {s}
          </button>
        ))}
      </div>
    </form>
  );
}

type CreateOutput = { document: CatalogDocument; title: string; slides: number };

/** The catalog the assistant created: saved to this browser once, then shown with a preview. */
function CreateCatalogPart({ part }: { part: ToolPart }) {
  const saved = useRef(false);
  const [state, setState] = useState<"saving" | "saved" | "error">("saving");
  const output = part.state === "output-available" ? (part.output as CreateOutput) : null;

  useEffect(() => {
    if (!output || saved.current) return;
    saved.current = true;
    saveLocalCatalog(output.document).then(() => setState("saved"), () => setState("error"));
  }, [output]);

  if (part.type !== "tool-create_catalog") return null;
  if (part.state === "output-error") return <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">Couldn't create the catalog: {part.errorText}</p>;
  if (!output) {
    return <p className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm text-muted-foreground"><HugeiconsIcon icon={Loading02Icon} className="size-4 animate-spin" /> Designing your catalog…</p>;
  }
  const doc = output.document;
  const cover = doc.slides[0];
  const width = 280;
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-background p-3">
      {cover && <div className="overflow-hidden rounded-lg border"><SlideView doc={doc} slide={cover} scale={width / doc.settings.width} /></div>}
      <div className="grid min-w-0 flex-1 gap-1">
        <p className="truncate font-medium" dir="auto">{output.title}</p>
        <p className="text-xs text-muted-foreground">{output.slides} slides · {state === "saved" ? "saved in this browser" : state === "error" ? "couldn't save in this browser" : "saving…"}</p>
        <div className="mt-1">
          <Button size="sm" disabled={state !== "saved"} nativeButton={false} render={<Link href={`/editor/${doc.id}` as Route} />}><HugeiconsIcon icon={Presentation01Icon} /> Open in editor</Button>
        </div>
      </div>
    </div>
  );
}
