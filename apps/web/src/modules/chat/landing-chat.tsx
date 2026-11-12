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
import { builtInExtensionRenderers } from "@/modules/editor/extensions/built-in-renderers";
import { builtInExtensionEffects } from "@/modules/editor/extensions/built-in-effects";
import { localCatalogs, saveLocalCatalog } from "@/modules/catalog/local-catalogs";
import { makeTRPCClient } from "@/utils/trpc";

import { rememberCatalogImported, wasCatalogImported } from "./chat-local-state";
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
  // Each prompt from the home page starts its own conversation (a fresh id), instead of appending to the last one.
  const [started, setStarted] = useState<{ prompt: string; conversationId: string } | null>(null);

  useEffect(() => {
    if (!session) return;
    void api().ai.status.query().then((s) => setAiReady(s.configured), () => setAiReady(false));
  }, [session]);

  const start = (text: string) => {
    const t = text.trim();
    if (!t) return;
    if (session && aiReady) return setStarted({ prompt: t, conversationId: crypto.randomUUID() });
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
        <ChatThread key={started.conversationId} mode="landing" scopeId="landing" conversationId={started.conversationId} initialPrompt={started.prompt} renderTool={renderCreateCatalog} placeholder="Reply or add details…" className="min-h-0 flex-1" />
      </div>
    );
  }

  return (
    <form
      className="grid w-full gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(prompt);
      }}
    >
      <InputGroup className="rounded-2xl border bg-card/90 text-start shadow-xl shadow-primary/10 ring-1 ring-border/50 backdrop-blur-sm">
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
          className="min-h-28 resize-none px-4 pt-4 text-base leading-relaxed sm:min-h-32 sm:px-5 sm:pt-5"
          dir="auto"
        />
        <InputGroupAddon align="block-end" className="justify-between gap-3 px-3 pb-3 sm:px-4 sm:pb-4">
          <span className="min-w-0 text-start text-[11px] leading-relaxed text-muted-foreground sm:text-xs">
            {isPending ? " " : session && aiReady ? "Chat with your AI model" : "Generates with Kavero's built-in planner · connect a model for chat"}
          </span>
          <InputGroupButton type="submit" size="icon-sm" variant="default" className="size-10 shrink-0 rounded-full shadow-md shadow-primary/20" aria-label="Start" disabled={!prompt.trim()}><HugeiconsIcon icon={ArrowUp01Icon} /></InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <div role="group" aria-label="Try an example prompt" className="flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setPrompt(s)}
            className="rounded-full border border-border/70 bg-background/55 px-3.5 py-1.5 text-xs text-muted-foreground shadow-sm transition-[background-color,border-color,color,transform] hover:-translate-y-0.5 hover:border-primary/30 hover:bg-primary/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {s}
          </button>
        ))}
      </div>
    </form>
  );
}

type CreateOutput = { document: CatalogDocument; title: string; slides: number };

const renderCreateCatalog = (part: ToolPart) => <CreateCatalogPart part={part} />;

/**
 * Save a chat-created catalog into this browser once. Reopening the conversation later must not
 * overwrite edits made since, or bring back a catalog the user deleted.
 */
async function importCreatedCatalog(doc: CatalogDocument): Promise<"saved" | "removed"> {
  if (await localCatalogs().getSummary(doc.id)) {
    rememberCatalogImported(doc.id);
    return "saved";
  }
  if (wasCatalogImported(doc.id)) return "removed";
  await saveLocalCatalog(doc);
  rememberCatalogImported(doc.id);
  return "saved";
}

/** The catalog the assistant created: saved to this browser once, then shown with a preview. */
function CreateCatalogPart({ part }: { part: ToolPart }) {
  const handled = useRef(false);
  const [state, setState] = useState<"saving" | "saved" | "removed" | "error">("saving");
  const output = part.state === "output-available" ? (part.output as CreateOutput) : null;

  useEffect(() => {
    if (!output || handled.current) return;
    handled.current = true;
    importCreatedCatalog(output.document).then(setState, () => setState("error"));
  }, [output]);

  if (part.type !== "tool-create_catalog") return null;
  if (part.state === "output-error") return <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">Couldn't create the catalog: {part.errorText}</p>;
  if (!output) {
    return <p className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm text-muted-foreground"><HugeiconsIcon icon={Loading02Icon} className="size-4 animate-spin" /> Designing your catalog…</p>;
  }
  const doc = output.document;
  const cover = doc.slides[0];
  const width = 280;
  const restore = () => {
    setState("saving");
    saveLocalCatalog(doc).then(() => {
      rememberCatalogImported(doc.id);
      setState("saved");
    }, () => setState("error"));
  };
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-background p-3">
      {cover && <div className="overflow-hidden rounded-lg border"><SlideView doc={doc} slide={cover} scale={width / doc.settings.width} extensionRenderers={builtInExtensionRenderers} extensionEffects={builtInExtensionEffects} /></div>}
      <div className="grid min-w-0 flex-1 gap-1">
        <p className="truncate font-medium" dir="auto">{output.title}</p>
        <p className="text-xs text-muted-foreground">{output.slides} slides · {state === "saved" ? "saved in this browser" : state === "removed" ? "removed from this browser" : state === "error" ? "couldn't save in this browser" : "saving…"}</p>
        <div className="mt-1">
          {state === "removed" ? (
            <Button size="sm" variant="outline" onClick={restore}>Add it again</Button>
          ) : (
            <Button size="sm" disabled={state !== "saved"} nativeButton={false} render={<Link href={`/editor/${doc.id}` as Route} />}><HugeiconsIcon icon={Presentation01Icon} /> Open in editor</Button>
          )}
        </div>
      </div>
    </div>
  );
}
