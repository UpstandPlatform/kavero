"use client";

import { Button } from "@Kavero/ui/components/button";
import { Input } from "@Kavero/ui/components/input";
import { Check, Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { makeTRPCClient } from "@/utils/trpc";

let client: ReturnType<typeof makeTRPCClient> | null = null;
const api = () => (client ??= makeTRPCClient());

type Role = "owner" | "admin" | "editor" | "viewer";
type Ws = Awaited<ReturnType<ReturnType<typeof api>["workspace"]["list"]["query"]>>[number];
type Members = Awaited<ReturnType<ReturnType<typeof api>["workspace"]["members"]["query"]>>;

const ROLE_HELP: Record<Role, string> = {
  owner: "Everything, including deleting the workspace",
  admin: "Manage members, publish and delete catalogs",
  editor: "Create and edit catalogs",
  viewer: "View and preview catalogs",
};
const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

export function WorkspacesTab() {
  const { data: session } = authClient.useSession();
  const [list, setList] = useState<Ws[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const refresh = useCallback(() => void api().workspace.list.query().then((l) => { setList(l); setSelected((s) => s ?? l[0]?.id ?? null); }), []);
  useEffect(refresh, [refresh]);

  async function create() {
    try {
      const r = await api().workspace.create.mutate({ name });
      setName("");
      setSelected(r.id);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="grid gap-6 text-xs">
      <p className="text-sm text-muted-foreground">Workspaces let a team share catalogs. Save a catalog to a workspace from the dashboard (catalog menu → Save to cloud).</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1">New workspace<Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Marketing team" maxLength={80} /></label>
        <Button onClick={create} disabled={!name.trim()}><Plus /> Create</Button>
      </div>
      {!list ? <p className="text-muted-foreground">Loading…</p> : list.length === 0 ? <p className="text-muted-foreground">You’re not in any workspace yet.</p> : (
        <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
          <ul className="grid content-start gap-1">
            {list.map((w) => (
              <li key={w.id}>
                <button type="button" onClick={() => setSelected(w.id)} aria-pressed={selected === w.id} className="w-full border px-3 py-2 text-left hover:bg-muted aria-pressed:border-foreground">
                  <span className="block truncate font-medium">{w.name}</span>
                  <span className="text-muted-foreground capitalize">{w.role}</span>
                </button>
              </li>
            ))}
          </ul>
          {selected && session && <WorkspaceDetail key={selected} workspaceId={selected} me={session.user.id} onChanged={refresh} onGone={() => { setSelected(null); refresh(); }} />}
        </div>
      )}
    </div>
  );
}

function WorkspaceDetail({ workspaceId, me, onChanged, onGone }: { workspaceId: string; me: string; onChanged: () => void; onGone: () => void }) {
  const [data, setData] = useState<Members | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => void api().workspace.members.query({ workspaceId }).then(setData, (e: Error) => toast.error(e.message)), [workspaceId]);
  useEffect(load, [load]);

  async function act(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      await fn();
      if (done) toast.success(done);
      load();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <p className="text-muted-foreground">Loading…</p>;
  const canManage = RANK[data.you] >= RANK.admin;
  const roles: Role[] = data.you === "owner" ? ["owner", "admin", "editor", "viewer"] : ["admin", "editor", "viewer"];

  return (
    <div className="grid gap-5">
      <section>
        <h3 className="mb-2 text-sm font-semibold">Members</h3>
        <ul className="divide-y border">
          {data.members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center gap-2 p-2">
              <div className="min-w-0 flex-1"><p className="truncate font-medium">{m.name}{m.userId === me ? " (you)" : ""}</p><p className="truncate text-muted-foreground">{m.email}</p></div>
              {canManage && m.userId !== me && (data.you === "owner" || m.role !== "owner") ? (
                <select className="h-7 border border-input bg-transparent px-1" value={m.role} disabled={busy} title={ROLE_HELP[m.role]}
                  onChange={(e) => act(() => api().workspace.setRole.mutate({ workspaceId, userId: m.userId, role: e.target.value as Role }), "Role updated")}>
                  {roles.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              ) : <span className="capitalize text-muted-foreground" title={ROLE_HELP[m.role]}>{m.role}</span>}
              {(m.userId === me || (canManage && (data.you === "owner" || m.role !== "owner"))) && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => confirm(m.userId === me ? "Leave this workspace?" : `Remove ${m.name}?`) && act(() => api().workspace.removeMember.mutate({ workspaceId, userId: m.userId }), m.userId === me ? "You left the workspace" : "Member removed").then(() => m.userId === me && onGone())}>
                  {m.userId === me ? "Leave" : "Remove"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {canManage && (
        <section className="grid gap-2">
          <h3 className="text-sm font-semibold">Invite someone</h3>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid min-w-48 flex-1 gap-1">Email<Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" /></label>
            <label className="grid gap-1">Role
              <select className="h-8 border border-input bg-transparent px-2" value={role} onChange={(e) => setRole(e.target.value as Role)}>{roles.map((r) => <option key={r} value={r}>{r}</option>)}</select>
            </label>
            <Button disabled={busy || !email} onClick={() => act(async () => {
              const r = await api().workspace.invite.mutate({ workspaceId, email, role });
              setLink(`${window.location.origin}/invite/${r.token}`);
              setEmail("");
            })}>{busy && <Loader2 className="animate-spin" />} Create invite link</Button>
          </div>
          <p className="text-muted-foreground">{ROLE_HELP[role]}. Kavero doesn’t send email yet: share the link yourself. Only {email || "that address"} can accept it, within 7 days.</p>
          {link && (
            <div className="flex items-center gap-2 border border-amber-500/50 bg-amber-500/5 p-2">
              <code className="min-w-0 flex-1 truncate">{link}</code>
              <Button variant="outline" size="sm" onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? <Check /> : <Copy />} Copy</Button>
            </div>
          )}
          {data.invites.length > 0 && (
            <ul className="divide-y border">
              {data.invites.map((i) => (
                <li key={i.id} className="flex items-center gap-2 p-2">
                  <span className="min-w-0 flex-1 truncate">{i.email} <span className="text-muted-foreground">· {i.role} · expires {new Date(i.expiresAt).toLocaleDateString()}</span></span>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => act(() => api().workspace.revokeInvite.mutate({ workspaceId, inviteId: i.id }), "Invite revoked")}>Revoke</Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {data.you === "owner" && (
        <section className="border border-destructive/40 p-3">
          <Button variant="destructive" size="sm" disabled={busy} onClick={() => confirm("Delete this workspace? Members lose access. Its catalogs return to their creators as personal catalogs.") && act(() => api().workspace.remove.mutate({ workspaceId }), "Workspace deleted").then(onGone)}>
            <Trash2 /> Delete workspace
          </Button>
        </section>
      )}
    </div>
  );
}
