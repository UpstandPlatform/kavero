"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon, Key02Icon, Loading02Icon, Refresh01Icon, ScrollIcon, SparklesIcon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { Button } from "@Kavero/ui/components/button";
import { Badge } from "@Kavero/ui/components/badge";
import { Input } from "@Kavero/ui/components/input";
import { SimpleSelect } from "@Kavero/ui/components/simple-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@Kavero/ui/components/table";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { PageTabs, SectionHeader } from "@/components/page-tabs";
import { surface } from "@/components/surface";
import { authClient } from "@/lib/auth-client";
import { makeTRPCClient } from "@/utils/trpc";
import { confirmAction } from "@/components/confirm-dialog";

import { AiTab } from "./ai-tab";
import { ApiKeysTab } from "./api-keys-tab";
import { McpClientGuide } from "./mcp-client-guide";
import { WorkspacesTab } from "./workspaces-tab";

let client: ReturnType<typeof makeTRPCClient> | null = null;
export const api = () => (client ??= makeTRPCClient());

type Tab = "workspaces" | "ai-mcp" | "api-keys" | "activity";
const TAB_IDS: Tab[] = ["workspaces", "ai-mcp", "api-keys", "activity"];

function tabFromHash(hash: string): Tab | null {
  if (hash === "#tokens") return "api-keys";
  if (hash === "#ai" || hash === "#connections") return "ai-mcp";
  const tab = hash.slice(1);
  return TAB_IDS.includes(tab as Tab) ? tab as Tab : null;
}

export function SettingsPage() {
  const { data: session, isPending } = authClient.useSession();
  const [tab, setTab] = useState<Tab>(() => (typeof window !== "undefined" && tabFromHash(window.location.hash)) || "workspaces");
  useEffect(() => {
    const onHash = () => {
      const t = tabFromHash(window.location.hash);
      if (t) setTab(t);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  if (isPending) return <p className="p-8 text-sm text-muted-foreground">Loading…</p>;
  if (!session) {
    return (
      <div className="mx-auto max-w-md p-8 text-sm">
        <p className="mb-4">Sign in to manage API keys and connected services.</p>
        <Link href="/login"><Button>Sign in</Button></Link>
      </div>
    );
  }
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "workspaces", label: "Workspaces", icon: <HugeiconsIcon icon={UserGroupIcon} /> },
    { id: "ai-mcp", label: "AI & MCP", icon: <HugeiconsIcon icon={SparklesIcon} /> },
    { id: "api-keys", label: "API keys", icon: <HugeiconsIcon icon={Key02Icon} /> },
    { id: "activity", label: "Activity", icon: <HugeiconsIcon icon={ScrollIcon} /> },
  ];
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Settings</h1>
      <PageTabs label="Settings" tabs={tabs} value={tab} onChange={(id) => { setTab(id); history.replaceState(null, "", `#${id}`); }} />
      {tab === "workspaces" && <WorkspacesTab />}
      {tab === "ai-mcp" && <AiMcpTab />}
      {tab === "api-keys" && <ApiKeysTab />}
      {tab === "activity" && <ActivityTab />}
    </div>
  );
}

// ---------- AI & MCP ----------

type AiMcpSection = "ai" | "clients" | "connections";

function AiMcpTab() {
  const [section, setSection] = useState<AiMcpSection>(() => {
    if (typeof window !== "undefined" && window.location.hash === "#ai") return "ai";
    if (typeof window !== "undefined" && window.location.hash === "#connections") return "connections";
    return "clients";
  });
  const tabs: { id: AiMcpSection; label: string }[] = [
    { id: "ai", label: "AI model" },
    { id: "clients", label: "MCP clients" },
    { id: "connections", label: "Connected servers" },
  ];
  return (
    <div>
      <PageTabs label="AI and MCP settings" tabs={tabs} value={section} onChange={setSection} />
      {section === "ai" && <AiTab />}
      {section === "clients" && <McpClientGuide />}
      {section === "connections" && <ConnectionsTab />}
    </div>
  );
}

// ---------- Connections ----------

type ConnRow = Awaited<ReturnType<ReturnType<typeof api>["integrations"]["connections"]["list"]["query"]>>[number];

function ConnectionsTab() {
  const [rows, setRows] = useState<ConnRow[] | null>(null);
  const [form, setForm] = useState({ name: "", url: "", transport: "streamable-http" as "streamable-http" | "sse", authType: "none" as "none" | "bearer" | "header", authHeader: "X-API-Key", secret: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = useCallback(() => void api().integrations.connections.list.query().then(setRows), []);
  useEffect(refresh, [refresh]);

  async function add() {
    setBusy("add");
    try {
      const r = await api().integrations.connections.create.mutate({ ...form, authHeader: form.authType === "header" ? form.authHeader : undefined, secret: form.secret || undefined });
      if (r.status === "ok") toast.success(`Connected: ${r.tools.length} tool${r.tools.length === 1 ? "" : "s"} found`);
      else toast.error(`Saved, but couldn’t connect: ${r.error}`);
      setForm((f) => ({ ...f, name: "", url: "", secret: "" }));
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-8">
      <section className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          Connect MCP servers that provide tools for your workflows. The editor can call approved tools from these connections; credentials are encrypted and only used by the server.
        </p>
        <div className={`grid gap-4 text-xs ${surface.panel}`}>
          <SectionHeader title="Add a server" />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5">Name<Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="My store" /></label>
            <label className="grid gap-1.5">Transport
              <SimpleSelect value={form.transport} onValueChange={(v) => setForm({ ...form, transport: v })} options={[{ value: "streamable-http", label: "Streamable HTTP" }, { value: "sse", label: "SSE (older servers)" }]} />
            </label>
          </div>
          <label className="grid gap-1.5">Server URL<Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/mcp" /></label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1.5">Authentication
              <SimpleSelect value={form.authType} onValueChange={(v) => setForm({ ...form, authType: v })} options={[{ value: "none", label: "None" }, { value: "bearer", label: "Bearer token" }, { value: "header", label: "Custom header" }]} />
            </label>
            {form.authType === "header" && <label className="grid gap-1.5">Header name<Input value={form.authHeader} onChange={(e) => setForm({ ...form, authHeader: e.target.value })} /></label>}
            {form.authType !== "none" && <label className="grid gap-1.5">{form.authType === "bearer" ? "Token" : "Value"}<Input type="password" autoComplete="off" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} /></label>}
          </div>
          <p className="text-muted-foreground">Local (stdio) MCP servers need the Kavero desktop companion, which isn’t available yet.</p>
          <div><Button onClick={add} disabled={!!busy || !form.name.trim() || !form.url.trim()}>{busy === "add" && <HugeiconsIcon icon={Loading02Icon} className="animate-spin" />} Connect</Button></div>
        </div>
      </section>

      <section className="grid gap-3">
        <SectionHeader title="Connected servers" />
        {!rows ? <p className="text-xs text-muted-foreground">Loading…</p> : rows.length === 0 ? <p className="text-xs text-muted-foreground">None yet.</p> : (
          <ul className={surface.list}>
            {rows.map((c) => (
              <li key={c.id} className="grid gap-2 p-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-block size-2 rounded-full ${c.status === "ok" ? "bg-green-500" : c.status === "error" ? "bg-red-500" : "bg-muted-foreground"}`} />
                  <span className="font-medium">{c.name}</span>
                  <code className="min-w-0 truncate font-mono text-muted-foreground">{c.url}</code>
                  <span className="ml-auto flex gap-1">
                    <Button variant="ghost" size="sm" disabled={busy === c.id} onClick={async () => {
                      setBusy(c.id);
                      const r = await api().integrations.connections.check.mutate({ id: c.id }).catch((e: Error) => ({ status: "error" as const, error: e.message, tools: [] }));
                      if (r.status === "ok") toast.success(`${r.tools.length} tools available`); else toast.error(r.error ?? "Failed");
                      setBusy(null);
                      refresh();
                    }}>{busy === c.id ? <HugeiconsIcon icon={Loading02Icon} className="animate-spin" /> : <HugeiconsIcon icon={Refresh01Icon} />} Test</Button>
                    <Button variant="ghost" size="sm" onClick={async () => { if (await confirmAction({ title: `Remove “${c.name}”?`, description: "Its stored credentials will be deleted.", confirmLabel: "Remove server", destructive: true })) { await api().integrations.connections.remove.mutate({ id: c.id }); refresh(); } }}><HugeiconsIcon icon={Delete02Icon} /> Remove</Button>
                  </span>
                </div>
                {c.status === "error" && c.lastError && <p className="text-destructive">{c.lastError}</p>}
                {c.tools.length > 0 && (
                  <p className="text-muted-foreground">Tools: {c.tools.map((t) => t.name).join(", ")}</p>
                )}
                <p className="text-muted-foreground">
                  {c.authType === "none" ? "No authentication" : `${c.authType === "bearer" ? "Bearer token" : c.authHeader} ${c.hasSecret ? "saved (encrypted)" : "missing"}`}
                  {c.lastSyncAt ? ` · last import ${new Date(c.lastSyncAt).toLocaleString()}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------- Activity ----------

type AuditPage = Awaited<ReturnType<ReturnType<typeof api>["integrations"]["audit"]["query"]>>;
type AuditRow = AuditPage["rows"][number];

const AUDIT_AREAS = [
  ["", "All areas"], ["catalogs", "Catalogs"], ["assets", "Images and fonts"], ["exports", "Previews and exports"],
  ["publication", "Published sites"], ["workspace", "Workspaces"], ["ai", "AI"], ["api_keys", "API keys"],
  ["integrations", "Connected services"], ["admin", "Admin"], ["auth", "Sign-in and accounts"], ["account", "Account"],
] as const;

function ActivityTab() {
  const [area, setArea] = useState("");
  const [outcome, setOutcome] = useState("");
  const [page, setPage] = useState<AuditPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (append = false, cursor?: AuditPage["nextCursor"]) => {
    setLoading(true);
    setError(null);
    try {
      const next = await api().integrations.audit.query({ limit: 50, area: area ? area as AuditRow["area"] : undefined, outcome: outcome ? outcome as "ok" | "denied" | "error" : undefined, before: append ? cursor?.before : undefined, beforeId: append ? cursor?.beforeId : undefined });
      setPage((current) => append && current ? { ...next, rows: [...current.rows, ...next.rows] } : next);
    } catch (cause) {
      const message = (cause as Error).message;
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [area, outcome]);

  useEffect(() => { setPage(null); void load(); }, [load]);

  const rows = page?.rows ?? [];
  const areaLabel = (value: string) => AUDIT_AREAS.find(([key]) => key === value)?.[1] ?? value;
  if (!page && loading) return <p className="text-xs text-muted-foreground">Loading activity…</p>;
  return (
    <div className="grid gap-4 text-xs">
      <div className="flex flex-wrap gap-2">
        <SimpleSelect aria-label="Filter activity by area" className="w-52" value={area} onValueChange={setArea} options={AUDIT_AREAS.map(([value, label]) => ({ value, label }))} />
        <SimpleSelect aria-label="Filter activity by result" className="w-40" value={outcome} onValueChange={setOutcome} options={[{ value: "", label: "Any result" }, { value: "ok", label: "Succeeded" }, { value: "denied", label: "Denied" }, { value: "error", label: "Failed" }]} />
      </div>
      {error && <div className="flex items-center gap-2 text-destructive"><span>{error}</span><Button size="sm" variant="outline" onClick={() => void load()}>Retry</Button></div>}
      {page && rows.length === 0 && <p className="text-muted-foreground">No activity matches these filters yet.</p>}
      {rows.length > 0 && <div className={surface.table}>
        <Table>
          <TableHeader className={surface.thead}><TableRow><TableHead>When</TableHead><TableHead>Area</TableHead><TableHead>Activity</TableHead><TableHead>Target</TableHead><TableHead>Result</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((row: AuditRow) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">{new Date(row.createdAt).toLocaleString()}</TableCell>
                <TableCell><Badge variant="outline">{areaLabel(row.area)}</Badge></TableCell>
                <TableCell><span className="font-medium">{row.action.replace(/[:_]/g, " · ")}</span><span className="ms-2 text-muted-foreground">via {row.channel}</span></TableCell>
                <TableCell className="max-w-48 truncate font-mono text-muted-foreground">{row.target ?? "—"}</TableCell>
                <TableCell><Badge variant={row.outcome === "ok" ? "secondary" : "destructive"}>{row.outcome}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>}
      {page?.hasMore && <Button variant="outline" className="justify-self-center" disabled={loading} onClick={() => void load(true, page.nextCursor)}>{loading ? "Loading…" : "Load more activity"}</Button>}
    </div>
  );
}

