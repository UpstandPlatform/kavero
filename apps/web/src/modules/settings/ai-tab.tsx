"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, CheckmarkCircle02Icon, Delete02Icon, Key02Icon, LinkSquare01Icon, Loading02Icon, Refresh01Icon, SparklesIcon } from "@hugeicons/core-free-icons";
import { Badge } from "@Kavero/ui/components/badge";
import { Button } from "@Kavero/ui/components/button";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@Kavero/ui/components/combobox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@Kavero/ui/components/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@Kavero/ui/components/field";
import { Input } from "@Kavero/ui/components/input";
import { SimpleSelect } from "@Kavero/ui/components/simple-select";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { SectionHeader } from "@/components/page-tabs";
import { surface } from "@/components/surface";
import { makeTRPCClient } from "@/utils/trpc";
import { confirmAction } from "@/components/confirm-dialog";

let client: ReturnType<typeof makeTRPCClient> | null = null;
const api = () => (client ??= makeTRPCClient());

type Provider = "anthropic" | "openrouter" | "openai" | "openai-compatible";
type Credentials = Awaited<ReturnType<ReturnType<typeof api>["ai"]["credential"]["list"]["query"]>>;
type Credential = Credentials[number];
type Status = Awaited<ReturnType<ReturnType<typeof api>["ai"]["status"]["query"]>>;
type AiRow = Awaited<ReturnType<ReturnType<typeof api>["ai"]["history"]["query"]>>[number];
type Model = Awaited<ReturnType<ReturnType<typeof api>["ai"]["credential"]["models"]["query"]>>[number];

const PROVIDERS: { id: Provider; label: string; keyUrl?: string; keyHint: string }[] = [
  { id: "anthropic", label: "Claude (Anthropic)", keyUrl: "https://console.anthropic.com/settings/keys", keyHint: "sk-ant-…" },
  { id: "openrouter", label: "OpenRouter", keyUrl: "https://openrouter.ai/keys", keyHint: "sk-or-…" },
  { id: "openai", label: "OpenAI", keyUrl: "https://platform.openai.com/api-keys", keyHint: "sk-…" },
  { id: "openai-compatible", label: "OpenAI-compatible server (Ollama, LM Studio…)", keyHint: "Optional" },
];

function capabilityBadges(capabilities: Credential["capabilities"] | Model["capabilities"] | null | undefined) {
  if (!capabilities) return <Badge variant="outline">Capabilities unavailable</Badge>;
  return (
    <>
      {capabilities.inputModalities === null
        ? <Badge variant="outline">Input support unknown</Badge>
        : capabilities.inputModalities.map((modality) => <Badge key={`in-${modality}`} variant="secondary">{modality === "image" ? "Vision" : `${modality} input`}</Badge>)}
      {capabilities.outputModalities === null && <Badge variant="outline">Output support unknown</Badge>}
      {capabilities.outputModalities?.filter((modality) => modality !== "text").map((modality) => <Badge key={`out-${modality}`} variant="secondary">{`${modality} output`}</Badge>)}
      {capabilities.toolCalling === true && <Badge variant="outline">Tool calling</Badge>}
      {capabilities.structuredOutput === true && <Badge variant="outline">Structured output</Badge>}
      {(capabilities.toolCalling === null || capabilities.structuredOutput === null) && <Badge variant="outline">Some features unknown</Badge>}
      {capabilities.maxInputTokens !== null && <Badge variant="outline">{capabilities.maxInputTokens.toLocaleString()} context</Badge>}
      {capabilities.source === "curated" && <span className="text-muted-foreground">Provider API doesn’t publish capability metadata; these model-family details come from Kavero’s curated capability catalog.</span>}
    </>
  );
}

/** Settings → AI: multiple encrypted provider connections with verified model capabilities. */
export function AiTab() {
  const [status, setStatus] = useState<Status | null>(null);
  const [providers, setProviders] = useState<Credentials | null>(null);
  const [rows, setRows] = useState<AiRow[] | null>(null);
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://localhost:11434/v1");
  const [models, setModels] = useState<Model[]>([]);
  const [modelError, setModelError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [isNew, setIsNew] = useState(false);

  const refresh = useCallback(async () => {
    const [s, c] = await Promise.all([api().ai.status.query(), api().ai.credential.list.query()]);
    setStatus(s);
    setProviders(c);
  }, []);
  useEffect(() => {
    void refresh().catch((error: Error) => toast.error(error.message));
    void api().ai.history.query().then(setRows, (error: Error) => toast.error(error.message));
  }, [refresh]);

  const meta = PROVIDERS.find((p) => p.id === provider)!;
  const savedProvider = providers?.find((entry) => entry.provider === provider);
  const selectedModel = useMemo(() => models.find((entry) => entry.id === model), [model, models]);
  const availableProviders = PROVIDERS.filter((entry) => !providers?.some((saved) => saved.provider === entry.id));

  async function loadModels() {
    setBusy("models");
    setModelError(null);
    try {
      const list = await api().ai.credential.models.query({ provider, apiKey: apiKey || undefined, baseUrl: provider === "openai-compatible" ? baseUrl : undefined });
      setModels(list);
      if (!list.some((entry) => entry.id === model)) setModel("");
      if (!list.length) setModelError("This provider returned no available models for the current connection.");
      else toast.success(`${list.length} models loaded`);
    } catch (error) {
      setModels([]);
      setModel("");
      setModelError((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function startAdd() {
    const first = availableProviders[0];
    if (!first) return;
    setIsNew(true);
    setEditing(first.id);
    setProvider(first.id);
    setApiKey("");
    setModel("");
    setModels([]);
    setModelError(null);
    setBaseUrl("http://localhost:11434/v1");
  }

  function startEdit(entry: Credential) {
    setIsNew(false);
    setEditing(entry.provider);
    setProvider(entry.provider);
    setApiKey("");
    setModel(entry.model ?? "");
    setModels([]);
    setModelError(null);
    setBaseUrl(entry.baseUrl ?? "http://localhost:11434/v1");
  }

  async function save() {
    setBusy("save");
    try {
      const result = await api().ai.credential.set.mutate({ provider, apiKey: apiKey || undefined, model, baseUrl: provider === "openai-compatible" ? baseUrl : undefined });
      await refresh();
      setEditing(null);
      toast.success(`Connected to ${result.connection.model} (${(result.connection.ms / 1000).toFixed(1)} s)`);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function setDefault(entry: Credential) {
    setBusy(`default:${entry.provider}`);
    try {
      setProviders(await api().ai.credential.setDefault.mutate({ provider: entry.provider }));
      setStatus(await api().ai.status.query());
      toast.success(`${entry.label} is now the default provider`);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove(entry: Credential) {
    if (!await confirmAction({ title: `Remove ${entry.label}?`, description: "The encrypted key and provider settings will be deleted from your account.", confirmLabel: "Remove provider", destructive: true })) return;
    setBusy(`remove:${entry.provider}`);
    try {
      setProviders(await api().ai.credential.remove.mutate({ provider: entry.provider }));
      setStatus(await api().ai.status.query());
      toast.success(`${entry.label} removed`);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-8 text-xs">
      <section className={`grid gap-1 ${surface.panel}`}>
        <p className="flex items-center gap-2 text-sm font-medium">
          {status?.configured ? <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-4 text-green-600" /> : <HugeiconsIcon icon={Key02Icon} className="size-4 text-muted-foreground" />}
          {status?.configured ? `Using ${status.model} · ${status.source === "personal" ? "your default provider" : "the server's provider"}` : "No AI model connected"}
        </p>
        <p className="text-muted-foreground">
          {status?.configured
            ? "Catalog generation, slide edits and MCP AI tools use your selected default provider when available. Each new provider is tested before its key or settings are saved."
            : "Generation still works with Kavero's built-in planner. Add a provider below to enable model-powered catalog generation and slide edits."}
        </p>
        {status?.source === "personal" && <div className="mt-1 flex flex-wrap items-center gap-1.5">{capabilityBadges(status.capabilities)}</div>}
      </section>

      <section className="grid gap-3">
        <SectionHeader title="AI providers" description="Each key is encrypted on the server and only used for your requests." action={availableProviders.length > 0 ? <Button size="sm" onClick={startAdd}><HugeiconsIcon icon={Add01Icon} /> Add provider</Button> : undefined} />
        {!providers ? <p className="text-muted-foreground">Loading providers…</p> : providers.length === 0 ? <p className="text-muted-foreground">No personal AI providers connected.</p> : (
          <ul className={surface.list}>
            {providers.map((entry) => (
              <li key={entry.provider} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="grid min-w-0 gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{entry.label}</span>
                    {entry.isDefault && <Badge>Default</Badge>}
                    <Badge variant="outline">{entry.model}</Badge>
                    {entry.keyHint && <span className="text-muted-foreground">Key ····{entry.keyHint}</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">{capabilityBadges(entry.capabilities)}</div>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {!entry.isDefault && <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void setDefault(entry)}>{busy === `default:${entry.provider}` && <HugeiconsIcon icon={Loading02Icon} className="animate-spin" />} Make default</Button>}
                  <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => startEdit(entry)}>Edit</Button>
                  <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => void remove(entry)}><HugeiconsIcon icon={Delete02Icon} /> Remove</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open && !busy) setEditing(null); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{isNew ? "Add AI provider" : `Edit ${meta.label}`}</DialogTitle>
            <DialogDescription>Load the provider’s model list, choose a model, then save. Kavero tests the connection first and keeps the existing settings if the test fails.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            {isNew && <Field>
              <FieldLabel htmlFor="ai-provider">Provider</FieldLabel>
              <SimpleSelect id="ai-provider" value={provider} onValueChange={(value) => { setProvider(value); setApiKey(""); setModel(""); setModels([]); setModelError(null); }} options={availableProviders.map((entry) => ({ value: entry.id, label: entry.label }))} />
            </Field>}
            {provider === "openai-compatible" && <Field>
              <FieldLabel htmlFor="ai-base-url">Server URL</FieldLabel>
              <Input id="ai-base-url" value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); setModels([]); setModel(""); }} placeholder="http://localhost:11434/v1" />
              <FieldDescription>Requests are restricted to public servers in production. Local model servers are available in development.</FieldDescription>
            </Field>}
            <Field>
              <FieldLabel htmlFor="ai-api-key">API key{provider === "openai-compatible" ? " (optional)" : ""}
                {meta.keyUrl && <a className="ms-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" href={meta.keyUrl} target="_blank" rel="noreferrer">Get a key <HugeiconsIcon icon={LinkSquare01Icon} className="size-3" /></a>}
              </FieldLabel>
              <Input id="ai-api-key" type="password" autoComplete="off" value={apiKey} onChange={(event) => { setApiKey(event.target.value); setModels([]); setModel(""); }} placeholder={savedProvider?.hasKey ? `Saved key ending in ${savedProvider.keyHint ?? "…"} (leave empty to keep it)` : meta.keyHint} />
              {savedProvider?.hasKey && <FieldDescription>The saved key stays encrypted if you leave this empty.</FieldDescription>}
            </Field>
            <Field>
              <FieldLabel htmlFor="ai-model">Model</FieldLabel>
              <div className="flex items-start gap-2">
                <Combobox value={model || null} onValueChange={(value) => setModel(value ?? "")} items={models.map((entry) => entry.id)} itemToStringValue={(value) => value}>
                  <ComboboxInput id="ai-model" className="min-w-0 flex-1" placeholder={models.length ? "Search models…" : "Load models to choose"} disabled={!models.length || !!busy} />
                  <ComboboxContent>
                    <ComboboxEmpty>No models match this search.</ComboboxEmpty>
                    <ComboboxList>
                      {(id: string) => {
                        const item = models.find((entry) => entry.id === id)!;
                        return <ComboboxItem key={id} value={id}><span className="grid min-w-0"><span className="truncate">{item.name}</span><span className="truncate text-xs text-muted-foreground">{id}</span></span></ComboboxItem>;
                      }}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
                <Button type="button" variant="outline" disabled={!!busy} onClick={() => void loadModels()}>{busy === "models" ? <HugeiconsIcon icon={Loading02Icon} className="animate-spin" /> : <HugeiconsIcon icon={Refresh01Icon} />} Load models</Button>
              </div>
              {modelError && <FieldDescription className="text-destructive">{modelError}</FieldDescription>}
              {selectedModel && <div className="flex flex-wrap items-center gap-1.5 rounded-lg border p-2">{capabilityBadges(selectedModel.capabilities)}</div>}
              <FieldDescription>Capabilities are loaded from provider model metadata where available; unsupported metadata remains marked as unknown.</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={!!busy}>Cancel</Button>
            <Button onClick={() => void save()} disabled={!!busy || !model || !models.some((entry) => entry.id === model) || (!apiKey && !savedProvider?.hasKey && provider !== "openai-compatible")}>
              {busy === "save" && <HugeiconsIcon icon={Loading02Icon} className="animate-spin" />}
              <HugeiconsIcon icon={isNew ? SparklesIcon : CheckmarkCircle02Icon} /> {isNew ? "Test and add provider" : "Test and save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <section className="grid gap-3">
        <SectionHeader title="History" />
        {!rows ? <p className="text-muted-foreground">Loading…</p> : !rows.length ? <p className="text-muted-foreground">Nothing yet.</p> : (
          <ul className={surface.list}>
            {rows.map((row) => (
              <li key={row.id} className="grid gap-0.5 p-3">
                <p><span className="font-medium capitalize">{row.kind}</span> <span className="text-muted-foreground">· {new Date(row.createdAt).toLocaleString()} · {row.source === "offline" ? "built-in planner" : row.model ?? ""}</span></p>
                <p className="truncate" dir="auto">{row.prompt || "(no brief)"}</p>
                <p className={row.status === "ok" ? "text-muted-foreground" : "text-destructive"}>{row.status === "ok" ? row.summary : row.error}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
