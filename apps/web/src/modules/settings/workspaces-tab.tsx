"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Delete02Icon, Loading02Icon } from "@hugeicons/core-free-icons";
import { Badge } from "@Kavero/ui/components/badge";
import { Button } from "@Kavero/ui/components/button";
import { Input } from "@Kavero/ui/components/input";
import { CopyField } from "@Kavero/ui/components/code-block";
import { SimpleSelect } from "@Kavero/ui/components/simple-select";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { SectionHeader } from "@/components/page-tabs";
import { surface } from "@/components/surface";
import { authClient } from "@/lib/auth-client";
import { makeTRPCClient } from "@/utils/trpc";
import { confirmAction } from "@/components/confirm-dialog";
import { TooltipHint } from "@Kavero/ui/components/tooltip";

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
  const refresh = useCallback(() => void api().workspace.list.query().then((l) => { setList(l); setSelected((s) => s ?? l.find((w) => w.isPersonal)?.id ?? l[0]?.id ?? null); }), []);
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
      <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">Every account has a protected Personal workspace. New cloud catalogs are saved there by default; choose a team workspace from a catalog’s save menu to share work with others.</p>
      <div className="grid gap-2 sm:max-w-xl sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <label className="grid gap-1.5">New workspace<Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Marketing team" maxLength={80} /></label>
        <Button onClick={create} disabled={!name.trim()}><HugeiconsIcon icon={Add01Icon} /> Create workspace</Button>
      </div>
      {!list ? <p className="text-muted-foreground">Loading…</p> : list.length === 0 ? <p className="text-muted-foreground">You’re not in any workspace yet.</p> : (
        <div className="grid items-start gap-5 sm:grid-cols-[220px_minmax(0,1fr)]">
          <ul className="grid content-start gap-2">
            {list.map((w) => (
              <li key={w.id}>
                <button type="button" onClick={() => setSelected(w.id)} aria-pressed={selected === w.id} className={`grid w-full gap-1 px-3 py-3 text-start ${surface.option}`}>
                  <span className="flex min-w-0 items-center gap-2"><span className="truncate font-medium">{w.name}</span>{w.isPersonal && <Badge variant="secondary">Personal</Badge>}</span>
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
    <div className="grid min-w-0 gap-6 rounded-xl border bg-card p-4 sm:p-5">
      {data.isPersonal && <p className={surface.muted}>This is your default workspace. It stays with your account, and you can’t delete it, leave it, or invite other members to it.</p>}
      <section className="grid gap-3">
        <SectionHeader as="h3" title="Members" />
        <ul className={surface.list}>
          {data.members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center gap-2 p-3">
              <div className="min-w-0 flex-1"><p className="truncate font-medium">{m.name}{m.userId === me ? " (you)" : ""}</p><p className="truncate text-muted-foreground">{m.email}</p></div>
              {!data.isPersonal && canManage && m.userId !== me && (data.you === "owner" || m.role !== "owner") ? (
                <SimpleSelect size="sm" className="w-28 capitalize" contentClassName="capitalize" value={m.role} disabled={busy} title={ROLE_HELP[m.role]} aria-label={`Role of ${m.name}`}
                  onValueChange={(v) => act(() => api().workspace.setRole.mutate({ workspaceId, userId: m.userId, role: v }), "Role updated")}
                  options={roles.map((r) => ({ value: r, label: r }))} />
              ) : <TooltipHint content={data.isPersonal ? "Owner of your protected Personal workspace" : ROLE_HELP[m.role]}><span tabIndex={0} className="capitalize text-muted-foreground">{m.role}</span></TooltipHint>}
              {!data.isPersonal && (m.userId === me || (canManage && (data.you === "owner" || m.role !== "owner"))) && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={async () => {
                  const leaving = m.userId === me;
                  if (!await confirmAction({ title: leaving ? "Leave this workspace?" : `Remove ${m.name}?`, description: leaving ? "You will lose access to this workspace and its shared catalogs." : "This person will lose access to the workspace and its shared catalogs.", confirmLabel: leaving ? "Leave workspace" : "Remove member", destructive: true })) return;
                  await act(() => api().workspace.removeMember.mutate({ workspaceId, userId: m.userId }), leaving ? "You left the workspace" : "Member removed");
                  if (leaving) onGone();
                }}>
                  {m.userId === me ? "Leave" : "Remove"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {canManage && !data.isPersonal && (
        <section className="grid gap-3">
          <SectionHeader as="h3" title="Invite someone" />
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid min-w-48 flex-1 gap-1.5">Email<Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" /></label>
            <label className="grid gap-1.5">Role
              <SimpleSelect className="w-32 capitalize" contentClassName="capitalize" value={role} onValueChange={setRole} options={roles.map((r) => ({ value: r, label: r }))} />
            </label>
            <Button disabled={busy || !email} onClick={() => act(async () => {
              const r = await api().workspace.invite.mutate({ workspaceId, email, role });
              setLink(`${window.location.origin}/invite/${r.token}`);
              setEmail("");
            })}>{busy && <HugeiconsIcon icon={Loading02Icon} className="animate-spin" />} Create invite link</Button>
          </div>
          <p className="text-muted-foreground">{ROLE_HELP[role]}. Kavero doesn’t send email yet: share the link yourself. Only {email || "that address"} can accept it, within 7 days.</p>
          {link && (
            <div className={`grid gap-2 ${surface.warning}`}>
              <p className="font-medium">Share this invite link</p>
              <CopyField value={link} />
            </div>
          )}
          {data.invites.length > 0 && (
            <ul className={surface.list}>
              {data.invites.map((i) => (
                <li key={i.id} className="flex items-center gap-2 p-3">
                  <span className="min-w-0 flex-1 truncate">{i.email} <span className="text-muted-foreground">· {i.role} · expires {new Date(i.expiresAt).toLocaleDateString()}</span></span>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => act(() => api().workspace.revokeInvite.mutate({ workspaceId, inviteId: i.id }), "Invite revoked")}>Revoke</Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {data.you === "owner" && !data.isPersonal && (
        <section className={`flex flex-wrap items-center justify-between gap-3 ${surface.danger}`}>
          <div className="grid gap-0.5">
            <p className="text-sm font-semibold">Delete workspace</p>
            <p className="text-muted-foreground">Members lose access. Its catalogs move into their creators’ Personal workspaces.</p>
          </div>
          <Button variant="destructive" size="sm" disabled={busy} onClick={async () => {
            if (!await confirmAction({ title: "Delete this workspace?", description: "Members lose access. Its catalogs move into their creators’ Personal workspaces.", confirmLabel: "Delete workspace", destructive: true })) return;
            await act(() => api().workspace.remove.mutate({ workspaceId }), "Workspace deleted");
            onGone();
          }}>
            <HugeiconsIcon icon={Delete02Icon} /> Delete workspace
          </Button>
        </section>
      )}
    </div>
  );
}
