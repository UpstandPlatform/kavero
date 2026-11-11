"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Delete02Icon, Key02Icon, Loading02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@Kavero/ui/components/button";
import { Checkbox } from "@Kavero/ui/components/checkbox";
import { CopyField } from "@Kavero/ui/components/code-block";
import { FieldDescription, FieldLegend, FieldSet } from "@Kavero/ui/components/field";
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

const SCOPE_LABELS = {
  "catalogs:read": "View catalogs and their content",
  "catalogs:write": "Create and edit catalogs",
  "catalogs:delete": "Delete catalogs",
  "assets:write": "Import images and fonts",
  "exports:read": "Render previews and export files",
  "ai:generate": "Generate catalogs with AI",
  "workspaces:write": "Create catalogs in team workspaces",
  publish: "Publish and unpublish websites",
} as const;
type Scope = keyof typeof SCOPE_LABELS;
const DEFAULT_SCOPES: Scope[] = ["catalogs:read"];
type ApiKeyRow = Awaited<ReturnType<ReturnType<typeof api>["integrations"]["apiKeys"]["list"]["query"]>>[number];

/** Creates, lists, and revokes scoped Better Auth API keys for MCP clients. */
export function ApiKeysTab() {
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [name, setName] = useState("Claude Code");
  const [scopes, setScopes] = useState<Scope[]>(DEFAULT_SCOPES);
  const [expiresInDays, setExpiresInDays] = useState("90");
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setKeys(await api().integrations.apiKeys.list.query());
      setLoadError(false);
    } catch (error) {
      setKeys([]);
      setLoadError(true);
      toast.error((error as Error).message);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function create() {
    setBusy(true);
    setCreated(null);
    try {
      const result = await api().integrations.apiKeys.create.mutate({ name, scopes, expiresInDays: Number(expiresInDays) });
      setCreated(result.key);
      await refresh();
      toast.success("API key created");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(key: ApiKeyRow) {
    if (!await confirmAction({ title: `Revoke “${key.name ?? "API key"}”?`, description: "Clients using this key will lose access immediately.", confirmLabel: "Revoke key", destructive: true })) return;
    try {
      await api().integrations.apiKeys.revoke.mutate({ id: key.id });
      setCreated(null);
      await refresh();
      toast.success("API key revoked");
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <div className="grid gap-8 text-xs">
      <section className="grid gap-3">
        <SectionHeader title="Create an API key" description="Use a separate key for each agent or device. Keys are hashed on the server and shown once when created." />
        <div className={`grid gap-4 ${surface.panel}`}>
          <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <label className="grid gap-1.5">Name<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="My agent" /></label>
            <label className="grid gap-1.5">Expires
              <SimpleSelect value={expiresInDays} onValueChange={setExpiresInDays} options={[
                { value: "30", label: "In 30 days" },
                { value: "90", label: "In 90 days" },
                { value: "365", label: "In a year" },
              ]} />
            </label>
          </div>
          <FieldSet className="grid gap-2">
            <FieldLegend>Permissions</FieldLegend>
            <FieldDescription>Grant only the access this client needs. You can revoke a key at any time.</FieldDescription>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {(Object.entries(SCOPE_LABELS) as [Scope, string][]).map(([scope, label]) => (
                <label key={scope} className="flex cursor-pointer items-center gap-2">
                  <Checkbox checked={scopes.includes(scope)} onCheckedChange={(checked) => setScopes((current) => checked ? [...new Set([...current, scope])] : current.filter((item) => item !== scope))} />
                  {label}
                </label>
              ))}
            </div>
          </FieldSet>
          <div>
            <Button onClick={create} disabled={busy || !name.trim() || !scopes.length}>
              {busy ? <HugeiconsIcon icon={Loading02Icon} className="animate-spin" /> : <HugeiconsIcon icon={Add01Icon} />}
              Create API key
            </Button>
          </div>
        </div>
        {created && (
          <div className={`grid gap-2 ${surface.warning}`}>
            <p className="font-medium">Copy this key now. Kavero stores only its hash, so it cannot be shown again.</p>
            <CopyField value={created} />
          </div>
        )}
      </section>

      <section className="grid gap-3">
        <SectionHeader title="Active API keys" />
        {loadError ? <div className="grid justify-items-start gap-2 text-muted-foreground"><p>Couldn’t load API keys.</p><Button variant="outline" size="sm" onClick={() => void refresh()}>Retry</Button></div> : !keys ? <p className="text-muted-foreground">Loading…</p> : keys.length === 0 ? <p className="text-muted-foreground">No API keys yet.</p> : (
          <ul className={surface.list}>
            {keys.map((key) => (
              <li key={key.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <p className="font-medium">
                    <HugeiconsIcon icon={Key02Icon} className="me-1 inline size-3.5 text-muted-foreground" />
                    {key.name ?? "Unnamed key"}
                    {(key.start || key.prefix) && <code className={`ms-2 text-muted-foreground ${surface.code}`}>{key.start ?? key.prefix}…</code>}
                  </p>
                  <p className="text-muted-foreground">
                    {key.scopes.map((scope) => SCOPE_LABELS[scope] ?? scope).join(", ") || "No permissions"}
                    {key.lastRequest ? ` · used ${new Date(key.lastRequest).toLocaleString()}` : " · never used"}
                    {key.expiresAt ? ` · expires ${new Date(key.expiresAt).toLocaleDateString()}` : ""}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => void revoke(key)}>
                  <HugeiconsIcon icon={Delete02Icon} /> Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

    </div>
  );
}
