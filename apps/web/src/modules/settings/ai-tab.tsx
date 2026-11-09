"use client";

import { Button } from "@Kavero/ui/components/button";
import { Input } from "@Kavero/ui/components/input";
import { CheckCircle2, ExternalLink, KeyRound, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { makeTRPCClient } from "@/utils/trpc";

let client: ReturnType<typeof makeTRPCClient> | null = null;
const api = () => (client ??= makeTRPCClient());

type Provider = "anthropic" | "openrouter" | "openai" | "openai-compatible";
type Credential = Awaited<ReturnType<ReturnType<typeof api>["ai"]["credential"]["get"]["query"]>>;
type Status = Awaited<ReturnType<ReturnType<typeof api>["ai"]["status"]["query"]>>;
type AiRow = Awaited<ReturnType<ReturnType<typeof api>["ai"]["history"]["query"]>>[number];

const PROVIDERS: { id: Provider; label: string; keyUrl?: string; keyHint: string; modelHint: string; modelRequired: boolean }[] = [
  { id: "anthropic", label: "Claude (Anthropic)", keyUrl: "https://console.anthropic.com/settings/keys", keyHint: "sk-ant-…", modelHint: "Leave empty for claude-opus-5-5", modelRequired: false },
  { id: "openrouter", label: "OpenRouter", keyUrl: "https://openrouter.ai/keys", keyHint: "sk-or-…", modelHint: "A model id from openrouter.ai/models, e.g. a Claude model", modelRequired: true },
  { id: "openai", label: "OpenAI", keyUrl: "https://platform.openai.com/api-keys", keyHint: "sk-…", modelHint: "An OpenAI model id", modelRequired: true },
  { id: "openai-compatible", label: "OpenAI-compatible server (Ollama, LM Studio…)", keyHint: "Optional", modelHint: "The model name on that server", modelRequired: true },
];

/** Settings → AI: connect your own Claude / OpenRouter / OpenAI key and see generation history. */
export function AiTab() {
  const [status, setStatus] = useState<Status | null>(null);
  const [cred, setCred] = useState<Credential | undefined>(undefined);
  const [rows, setRows] = useState<AiRow[] | null>(null);
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://localhost:11434/v1");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, c] = await Promise.all([api().ai.status.query(), api().ai.credential.get.query()]);
    setStatus(s);
    setCred(c);
    if (c) {
      setProvider(c.provider);
      setModel(c.model ?? "");
      if (c.baseUrl) setBaseUrl(c.baseUrl);
    }
  }, []);
  useEffect(() => {
    void load();
    void api().ai.history.query().then(setRows);
  }, [load]);

  const meta = PROVIDERS.find((p) => p.id === provider)!;
  const keepsKey = !!cred?.hasKey && cred.provider === provider;

  async function save() {
    setBusy("save");
    try {
      await api().ai.credential.set.mutate({ provider, apiKey: apiKey || undefined, model: model || undefined, baseUrl: provider === "openai-compatible" ? baseUrl : undefined });
      setApiKey("");
      await load();
      toast.success("Saved. Testing the connection…");
      await test();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    try {
      const r = await api().ai.credential.test.mutate();
      toast.success(`Connected to ${r.model} (${(r.ms / 1000).toFixed(1)} s)`);
    } catch (e) {
      toast.error(`Connection failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm("Remove your AI key? Kavero will use the server's model (if any) or its built-in planner.")) return;
    setBusy("remove");
    await api().ai.credential.remove.mutate().catch((e: Error) => toast.error(e.message));
    setApiKey("");
    setModel("");
    await load();
    setBusy(null);
  }

  const field = "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs";
  return (
    <div className="grid gap-8 text-xs">
      <section className="grid gap-1 rounded-xl border p-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          {status?.configured ? <CheckCircle2 className="size-4 text-green-600" /> : <KeyRound className="size-4 text-muted-foreground" />}
          {status?.configured ? `Using ${status.model} · ${status.source === "personal" ? "your key" : "the server's key"}` : "No AI model connected"}
        </p>
        <p className="text-muted-foreground">
          {status?.configured
            ? "AI generation, AI slide edits and the MCP catalog_generate tool use this model. Your brief, product list and slide outline are sent to the provider."
            : "Generation still works with Kavero's built-in planner. Connect a model below to get AI-written copy, smarter layouts and AI slide edits."}
        </p>
      </section>

      <section className="grid gap-3">
        <div>
          <h2 className="text-sm font-semibold">Your AI key</h2>
          <p className="text-muted-foreground">Use your own Claude or OpenRouter account. The key is encrypted on the server, never shown again, and only used for your requests.</p>
        </div>
        <div className="grid gap-3 rounded-xl border p-4">
          <label className="grid gap-1">Provider
            <select className={field} value={provider} onChange={(e) => { setProvider(e.target.value as Provider); setApiKey(""); if (cred?.provider !== e.target.value) setModel(""); }}>
              {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          {provider === "openai-compatible" && (
            <label className="grid gap-1">Server URL<Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:11434/v1" /></label>
          )}
          <label className="grid gap-1">
            <span className="flex items-center justify-between">API key
              {meta.keyUrl && <a className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" href={meta.keyUrl} target="_blank" rel="noreferrer">Get a key <ExternalLink className="size-3" /></a>}
            </span>
            <Input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
              placeholder={keepsKey ? `Saved key ending in ${cred?.keyHint ?? "…"} (leave empty to keep it)` : meta.keyHint} />
          </label>
          <label className="grid gap-1"><span>Model{!meta.modelRequired && <span className="text-muted-foreground"> (optional)</span>}</span>
            <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder={meta.modelHint} spellCheck={false} />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={save} disabled={!!busy || (!apiKey && !keepsKey && provider !== "openai-compatible") || (meta.modelRequired && !model)}>
              {busy === "save" && <Loader2 className="animate-spin" />} Save and test
            </Button>
            {cred && <Button variant="outline" onClick={test} disabled={!!busy}>{busy === "test" && <Loader2 className="animate-spin" />} Test connection</Button>}
            {cred && <Button variant="ghost" onClick={remove} disabled={!!busy}><Trash2 /> Remove</Button>}
          </div>
          {cred && <p className="text-muted-foreground">Saved: {cred.label}{cred.model ? ` · ${cred.model}` : ""}{cred.keyHint ? ` · key …${cred.keyHint}` : ""}</p>}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">History</h2>
        {!rows ? <p className="text-muted-foreground">Loading…</p> : !rows.length ? <p className="text-muted-foreground">Nothing yet.</p> : (
          <ul className="divide-y rounded-xl border">
            {rows.map((r) => (
              <li key={r.id} className="grid gap-0.5 p-3">
                <p><span className="font-medium capitalize">{r.kind}</span> <span className="text-muted-foreground">· {new Date(r.createdAt).toLocaleString()} · {r.source === "offline" ? "built-in planner" : r.model ?? ""}</span></p>
                <p className="truncate" dir="auto">{r.prompt || "(no brief)"}</p>
                <p className={r.status === "ok" ? "text-muted-foreground" : "text-destructive"}>{r.status === "ok" ? r.summary : r.error}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
