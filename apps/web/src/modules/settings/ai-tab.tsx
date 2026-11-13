"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, CheckmarkCircle02Icon, Delete02Icon, Key02Icon, LinkSquare01Icon, Loading02Icon, SparklesIcon } from "@hugeicons/core-free-icons";
import { Badge } from "@Kavero/ui/components/badge";
import { Button } from "@Kavero/ui/components/button";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@Kavero/ui/components/combobox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@Kavero/ui/components/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@Kavero/ui/components/field";
import { Input } from "@Kavero/ui/components/input";
import { SimpleSelect } from "@Kavero/ui/components/simple-select";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { SectionHeader } from "@/components/page-tabs";
import { surface } from "@/components/surface";
import { confirmAction } from "@/components/confirm-dialog";
import { makeTRPCClient } from "@/utils/trpc";

let client: ReturnType<typeof makeTRPCClient> | null = null;
const api = () => (client ??= makeTRPCClient());

type Provider = "anthropic" | "openrouter" | "openai" | "openai-compatible" | "google" | "ai-gateway";
type Purpose = "text" | "image" | "video";
type Credentials = Awaited<ReturnType<ReturnType<typeof api>["ai"]["credential"]["list"]["query"]>>;
type Credential = Credentials[number];
type Assignments = Awaited<ReturnType<ReturnType<typeof api>["ai"]["credential"]["assignments"]["query"]>>;
type Assignment = Assignments[number];
type Status = Awaited<ReturnType<ReturnType<typeof api>["ai"]["status"]["query"]>>;
type AiRow = Awaited<ReturnType<ReturnType<typeof api>["ai"]["history"]["query"]>>[number];
type Model = Awaited<ReturnType<ReturnType<typeof api>["ai"]["credential"]["models"]["query"]>>[number];

const PROVIDERS: { id: Provider; label: string; keyUrl?: string; keyHint: string }[] = [
  { id: "anthropic", label: "Claude (Anthropic)", keyUrl: "https://console.anthropic.com/settings/keys", keyHint: "sk-ant-…" },
  { id: "openrouter", label: "OpenRouter", keyUrl: "https://openrouter.ai/keys", keyHint: "sk-or-…" },
  { id: "openai", label: "OpenAI", keyUrl: "https://platform.openai.com/api-keys", keyHint: "sk-…" },
  { id: "google", label: "Google AI Studio", keyUrl: "https://aistudio.google.com/apikey", keyHint: "AIza…" },
  { id: "ai-gateway", label: "Vercel AI Gateway", keyUrl: "https://vercel.com/ai-gateway", keyHint: "Gateway key" },
  { id: "openai-compatible", label: "OpenAI-compatible server (Ollama, LM Studio…)", keyHint: "Optional" },
];
const PURPOSES: { id: Purpose; title: string; description: string }[] = [
  { id: "text", title: "Text generation", description: "Catalog planning, slide edits and editor chat." },
  { id: "image", title: "Image generation", description: "Generate images for preview and insertion into slides." },
  { id: "video", title: "Video generation", description: "Generate MP4 clips that can also be converted to GIF." },
];

function capabilityBadges(capabilities: Model["capabilities"] | null | undefined) {
  if (!capabilities) return <Badge variant="outline">Capabilities unavailable</Badge>;
  return <>
    {capabilities.inputModalities?.map((modality) => <Badge key={`in-${modality}`} variant="secondary">{modality === "image" ? "Vision" : `${modality} input`}</Badge>)}
    {capabilities.outputModalities?.filter((modality) => modality !== "text").map((modality) => <Badge key={`out-${modality}`} variant="secondary">{`${modality} output`}</Badge>)}
    {capabilities.toolCalling === true && <Badge variant="outline">Tool calling</Badge>}
    {capabilities.structuredOutput === true && <Badge variant="outline">Structured output</Badge>}
    {capabilities.maxInputTokens !== null && <Badge variant="outline">{capabilities.maxInputTokens.toLocaleString()} context</Badge>}
    {capabilities.source === "curated" && <span className="text-muted-foreground">Capability details come from Kavero’s curated model catalog.</span>}
  </>;
}

function PurposeAssignment({ purpose, providers, assignment, onChanged }: { purpose: Purpose; providers: Credentials; assignment?: Assignment; onChanged: () => Promise<void> }) {
  const [provider, setProvider] = useState<Provider | "">(assignment?.provider ?? providers[0]?.provider ?? "");
  const [model, setModel] = useState(assignment?.model ?? "");
  const [models, setModels] = useState<Model[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const assigned = assignment?.provider === provider ? assignment.model : "";

  useEffect(() => {
    if (assignment) { setProvider(assignment.provider); setModel(assignment.model); }
    else if (!providers.some((entry) => entry.provider === provider)) { setProvider(providers[0]?.provider ?? ""); setModel(""); }
  // provider is intentionally managed by the selector and should not be reset on each render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignment?.provider, assignment?.model, providers.length]);

  useEffect(() => {
    if (!provider) { setModels([]); return; }
    let active = true;
    setModels([]);
    setModel("");
    setError(null);
    setBusy(true);
    void api().ai.credential.models.query({ provider, purpose }).then((list) => {
      if (!active) return;
      setModels(list);
      const preferred = assigned || model;
      setModel(list.some((item) => item.id === preferred) ? preferred : "");
      if (!list.length) setError(`No verified ${purpose} models are available from this provider.`);
    }).catch((cause: Error) => active && setError(cause.message)).finally(() => active && setBusy(false));
    return () => { active = false; };
  // assignment model is used as the initial choice; refresh when the provider or purpose changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, purpose, providers.length]);

  async function save() {
    if (!provider || !model) return;
    setBusy(true);
    try {
      await api().ai.credential.setAssignment.mutate({ purpose, provider, model });
      await onChanged();
      toast.success(`${purpose === "text" ? "Text" : purpose === "image" ? "Image" : "Video"} model assigned`);
    } catch (cause) { toast.error((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function clear() {
    setBusy(true);
    try { await api().ai.credential.clearAssignment.mutate({ purpose }); await onChanged(); setModel(""); toast.success(`${purpose} assignment cleared`); }
    catch (cause) { toast.error((cause as Error).message); }
    finally { setBusy(false); }
  }

  const selected = models.find((entry) => entry.id === model);
  return (
    <article className="grid gap-2 rounded-xl border bg-card p-3">
      <div><h3 className="text-xs font-semibold">{PURPOSES.find((entry) => entry.id === purpose)?.title}</h3><p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{PURPOSES.find((entry) => entry.id === purpose)?.description}</p></div>
      {!providers.length ? <p className="text-[11px] text-muted-foreground">Connect a provider to assign a model.</p> : <>
        <Field><FieldLabel htmlFor={`ai-provider-${purpose}`}>Provider</FieldLabel><SimpleSelect id={`ai-provider-${purpose}`} value={provider} onValueChange={(value) => { setProvider(value as Provider); setModel(""); }} options={providers.map((entry) => ({ value: entry.provider, label: entry.label }))} /></Field>
        <Field>
          <FieldLabel htmlFor={`ai-model-${purpose}`}>Model</FieldLabel>
          <Combobox value={model || null} onValueChange={(value) => setModel(value ?? "")} items={models.map((entry) => entry.id)} itemToStringValue={(value) => value}>
            <ComboboxInput id={`ai-model-${purpose}`} placeholder={busy ? "Loading models…" : models.length ? "Search supported models…" : "No supported models"} disabled={busy || !models.length} />
            <ComboboxContent><ComboboxEmpty>No models match this search.</ComboboxEmpty><ComboboxList>{(id: string) => {
              const item = models.find((entry) => entry.id === id)!;
              return <ComboboxItem key={id} value={id}><span className="grid min-w-0"><span className="truncate">{item.name}</span><span className="truncate text-[10px] text-muted-foreground">{id}</span></span></ComboboxItem>;
            }}</ComboboxList></ComboboxContent>
          </Combobox>
          {selected && <div className="flex flex-wrap items-center gap-1">{capabilityBadges(selected.capabilities)}</div>}
          {error && <FieldDescription className="text-destructive">{error}</FieldDescription>}
          {purpose !== "text" && <FieldDescription>Models with unknown or unsupported {purpose} output are hidden.</FieldDescription>}
        </Field>
        <div className="flex justify-end gap-1.5">
          {assignment && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void clear()}>Clear</Button>}
          <Button type="button" size="sm" disabled={busy || !model || model === assignment?.model && provider === assignment.provider} onClick={() => void save()}>{busy && <HugeiconsIcon icon={Loading02Icon} className="animate-spin" />} Save assignment</Button>
        </div>
      </>}
    </article>
  );
}

/** Settings → AI: encrypted provider connections plus independent text/image/video model assignments. */
export function AiTab() {
  const [status, setStatus] = useState<Status | null>(null);
  const [providers, setProviders] = useState<Credentials | null>(null);
  const [assignments, setAssignments] = useState<Assignments | null>(null);
  const [rows, setRows] = useState<AiRow[] | null>(null);
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://localhost:11434/v1");
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [isNew, setIsNew] = useState(false);

  const refresh = useCallback(async () => {
    const [s, c, a] = await Promise.all([api().ai.status.query(), api().ai.credential.list.query(), api().ai.credential.assignments.query()]);
    setStatus(s); setProviders(c); setAssignments(a);
  }, []);
  useEffect(() => {
    void refresh().catch((error: Error) => toast.error(error.message));
    void api().ai.history.query().then(setRows, (error: Error) => toast.error(error.message));
  }, [refresh]);

  const meta = PROVIDERS.find((entry) => entry.id === provider)!;
  const savedProvider = providers?.find((entry) => entry.provider === provider);
  const availableProviders = PROVIDERS.filter((entry) => !providers?.some((saved) => saved.provider === entry.id));

  function startAdd() {
    const first = availableProviders[0];
    if (!first) return;
    setIsNew(true); setEditing(first.id); setProvider(first.id); setApiKey(""); setBaseUrl("http://localhost:11434/v1");
  }
  function startEdit(entry: Credential) {
    setIsNew(false); setEditing(entry.provider); setProvider(entry.provider); setApiKey(""); setBaseUrl(entry.baseUrl ?? "http://localhost:11434/v1");
  }
  async function save() {
    setBusy("save");
    try {
      await api().ai.credential.set.mutate({ provider, apiKey: apiKey || undefined, baseUrl: provider === "openai-compatible" ? baseUrl : undefined });
      await refresh(); setEditing(null); toast.success(`${meta.label} connected`);
    } catch (error) { toast.error((error as Error).message); }
    finally { setBusy(null); }
  }
  async function remove(entry: Credential) {
    if (!await confirmAction({ title: `Remove ${entry.label}?`, description: "The encrypted key, connection and assignments using this provider will be deleted from your account.", confirmLabel: "Remove provider", destructive: true })) return;
    setBusy(`remove:${entry.provider}`);
    try { await api().ai.credential.remove.mutate({ provider: entry.provider }); await refresh(); toast.success(`${entry.label} removed`); }
    catch (error) { toast.error((error as Error).message); }
    finally { setBusy(null); }
  }

  return (
    <div className="grid gap-8 text-xs">
      <section className={`grid gap-1 ${surface.panel}`}>
        <p className="flex items-center gap-2 text-sm font-medium">
          {status?.configured ? <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-4 text-green-600" /> : <HugeiconsIcon icon={Key02Icon} className="size-4 text-muted-foreground" />}
          {status?.configured ? `Text tasks use ${status.model} · ${status.source === "personal" ? "your text assignment" : "the server fallback"}` : "No text model connected"}
        </p>
        <p className="text-muted-foreground">Connect providers once, then assign independent models to text, image and video generation. Provider keys stay encrypted on the server.</p>
      </section>

      <section className="grid gap-3">
        <SectionHeader title="Model assignments" description="Image and video models must advertise or match verified media support." />
        {!providers || !assignments ? <p className="text-muted-foreground">Loading assignments…</p> : <div className="grid gap-3 md:grid-cols-3">
          {PURPOSES.map((purpose) => <PurposeAssignment key={purpose.id} purpose={purpose.id} providers={providers} assignment={assignments.find((entry) => entry.purpose === purpose.id)} onChanged={refresh} />)}
        </div>}
      </section>

      <section className="grid gap-3">
        <SectionHeader title="Provider connections" description="Add a connection before assigning its models. Keys are encrypted and never returned to the browser." action={availableProviders.length > 0 ? <Button size="sm" onClick={startAdd}><HugeiconsIcon icon={Add01Icon} /> Add provider</Button> : undefined} />
        {!providers ? <p className="text-muted-foreground">Loading providers…</p> : providers.length === 0 ? <p className="text-muted-foreground">No personal providers connected.</p> : <ul className={surface.list}>
          {providers.map((entry) => <li key={entry.provider} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="grid min-w-0 gap-1.5"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{entry.label}</span>{entry.keyHint && <span className="text-muted-foreground">Key ····{entry.keyHint}</span>}</div>
              {entry.provider === "openai-compatible" && <span className="truncate text-muted-foreground">{entry.baseUrl}</span>}
              <div className="flex flex-wrap gap-1">{assignments?.filter((assignment) => assignment.provider === entry.provider).map((assignment) => <Badge key={assignment.purpose} variant="outline">{assignment.purpose}: {assignment.model}</Badge>)}</div>
            </div>
            <div className="flex items-center gap-1"><Button variant="ghost" size="sm" disabled={!!busy} onClick={() => startEdit(entry)}>Edit</Button><Button variant="ghost" size="sm" disabled={!!busy} onClick={() => void remove(entry)}><HugeiconsIcon icon={Delete02Icon} /> Remove</Button></div>
          </li>)}
        </ul>}
      </section>

      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open && !busy) setEditing(null); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>{isNew ? "Add provider connection" : `Edit ${meta.label}`}</DialogTitle><DialogDescription>Enter the provider credentials. Kavero checks model discovery before saving; model choices are assigned separately by purpose.</DialogDescription></DialogHeader>
          <FieldGroup>
            {isNew && <Field><FieldLabel htmlFor="ai-provider">Provider</FieldLabel><SimpleSelect id="ai-provider" value={provider} onValueChange={(value) => { setProvider(value as Provider); setApiKey(""); }} options={availableProviders.map((entry) => ({ value: entry.id, label: entry.label }))} /></Field>}
            {provider === "openai-compatible" && <Field><FieldLabel htmlFor="ai-base-url">Server URL</FieldLabel><Input id="ai-base-url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="http://localhost:11434/v1" /><FieldDescription>Requests to custom servers are guarded against private network access in production.</FieldDescription></Field>}
            <Field><FieldLabel htmlFor="ai-api-key">API key{provider === "openai-compatible" ? " (optional)" : ""}{meta.keyUrl && <a className="ms-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" href={meta.keyUrl} target="_blank" rel="noreferrer">Get a key <HugeiconsIcon icon={LinkSquare01Icon} className="size-3" /></a>}</FieldLabel>
              <Input id="ai-api-key" type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={savedProvider?.hasKey ? `Saved key ending in ${savedProvider.keyHint ?? "…"} (leave empty to keep it)` : meta.keyHint} />
              {savedProvider?.hasKey && <FieldDescription>The saved key stays encrypted if you leave this empty.</FieldDescription>}
            </Field>
          </FieldGroup>
          <DialogFooter><Button variant="outline" onClick={() => setEditing(null)} disabled={!!busy}>Cancel</Button><Button onClick={() => void save()} disabled={!!busy || (!apiKey && !savedProvider?.hasKey && provider !== "openai-compatible")}>{busy === "save" && <HugeiconsIcon icon={Loading02Icon} className="animate-spin" />}<HugeiconsIcon icon={isNew ? SparklesIcon : CheckmarkCircle02Icon} /> {isNew ? "Test and connect" : "Test and save"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <section className="grid gap-3"><SectionHeader title="History" />
        {!rows ? <p className="text-muted-foreground">Loading…</p> : !rows.length ? <p className="text-muted-foreground">Nothing yet.</p> : <ul className={surface.list}>{rows.map((row) => <li key={row.id} className="grid gap-0.5 p-3"><p><span className="font-medium capitalize">{row.kind}</span> <span className="text-muted-foreground">· {new Date(row.createdAt).toLocaleString()} · {row.source === "offline" ? "built-in planner" : row.model ?? ""}</span></p><p className="truncate" dir="auto">{row.prompt || "(no brief)"}</p><p className={row.status === "ok" ? "text-muted-foreground" : "text-destructive"}>{row.status === "ok" ? row.summary : row.error}</p></li>)}</ul>}
      </section>
    </div>
  );
}
