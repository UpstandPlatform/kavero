"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { BanIcon, DashboardCircleIcon, Delete02Icon, GlobeIcon, LinkSquare01Icon, Loading02Icon, Logout01Icon, MoreHorizontalIcon, ScrollIcon, Search01Icon, Settings02Icon, Shield01Icon, Shield02Icon, UserCheck01Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { Badge } from "@Kavero/ui/components/badge";
import { Button } from "@Kavero/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@Kavero/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@Kavero/ui/components/dropdown-menu";
import { Input } from "@Kavero/ui/components/input";
import { RadioGroup, RadioGroupItem } from "@Kavero/ui/components/radio-group";
import { SimpleSelect } from "@Kavero/ui/components/simple-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@Kavero/ui/components/table";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { PageTabs } from "@/components/page-tabs";
import { surface } from "@/components/surface";
import { authClient } from "@/lib/auth-client";
import { makeTRPCClient } from "@/utils/trpc";
import { confirmAction } from "@/components/confirm-dialog";

let client: ReturnType<typeof makeTRPCClient> | null = null;
const api = () => (client ??= makeTRPCClient());

type Api = ReturnType<typeof api>;
type Overview = Awaited<ReturnType<Api["admin"]["overview"]["query"]>>;
type UserRow = Awaited<ReturnType<Api["admin"]["users"]["list"]["query"]>>["users"][number];
type SiteRow = Awaited<ReturnType<Api["admin"]["sites"]["list"]["query"]>>["sites"][number];
type ActivityPage = Awaited<ReturnType<Api["admin"]["activity"]["query"]>>;
type ActivityRow = ActivityPage["rows"][number];
type Tab = "overview" | "users" | "sites" | "activity" | "settings";
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <HugeiconsIcon icon={DashboardCircleIcon} /> },
  { id: "users", label: "Users", icon: <HugeiconsIcon icon={UserGroupIcon} /> },
  { id: "sites", label: "Published sites", icon: <HugeiconsIcon icon={GlobeIcon} /> },
  { id: "activity", label: "Activity", icon: <HugeiconsIcon icon={ScrollIcon} /> },
  { id: "settings", label: "Sign-ups", icon: <HugeiconsIcon icon={Settings02Icon} /> },
];

const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`);
const fmtDate = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");
function ago(d: Date | string | null | undefined) {
  if (!d) return "never";
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
const errMsg = (e: unknown) => (e as Error).message;

export function AdminPage() {
  const { data: session, isPending } = authClient.useSession();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  useEffect(() => {
    const fromHash = () => setTab((TABS.find((t) => `#${t.id}` === window.location.hash)?.id) ?? "overview");
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  useEffect(() => {
    if (!session) return;
    api().admin.me.query().then((r) => setAllowed(r.isAdmin)).catch(() => setAllowed(false));
  }, [session]);

  if (isPending || (session && allowed === null)) return <p className="p-8 text-sm text-muted-foreground">Loading…</p>;
  if (!session) {
    return (
      <div className="mx-auto max-w-md p-8 text-sm">
        <p className="mb-4">Sign in with an admin account to manage this server.</p>
        <Link href="/login"><Button>Sign in</Button></Link>
      </div>
    );
  }
  if (!allowed) {
    return (
      <div className="mx-auto max-w-md p-8 text-sm">
        <h1 className="mb-2 text-lg font-semibold">Admins only</h1>
        <p className="text-muted-foreground">Your account doesn&apos;t have admin access. The first account created on a Kavero server is its admin; admins can make other accounts admins.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <h1 className="mb-1 flex items-center gap-2 text-2xl font-semibold tracking-tight"><HugeiconsIcon icon={Shield01Icon} className="size-6" /> Admin</h1>
      <p className="mb-6 text-sm text-muted-foreground">Manage accounts, sign-ups and published sites on this Kavero server.</p>
      <PageTabs label="Admin" tabs={TABS} value={tab} onChange={(id) => { setTab(id); history.replaceState(null, "", `#${id}`); }} />
      {tab === "overview" && <OverviewTab onOpen={(t) => { setTab(t); history.replaceState(null, "", `#${t}`); }} />}
      {tab === "users" && <UsersTab />}
      {tab === "sites" && <SitesTab />}
      {tab === "activity" && <ActivityTab />}
      {tab === "settings" && <SignupsTab />}
    </div>
  );
}

// ---------- Overview ----------

function Stat({ label, value, hint, onClick }: { label: string; value: React.ReactNode; hint?: string; onClick?: () => void }) {
  const body = (
    <>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </>
  );
  return onClick
    ? <button type="button" onClick={onClick} className={`${surface.panel} text-start transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50`}>{body}</button>
    : <div className={surface.panel}>{body}</div>;
}

const POLICY_LABEL = { open: "Open — anyone can sign up", "invite-only": "Invite-only", closed: "Closed" } as const;

function OverviewTab({ onOpen }: { onOpen: (t: Tab) => void }) {
  const [o, setO] = useState<Overview | null>(null);
  useEffect(() => { api().admin.overview.query().then(setO).catch((e) => toast.error(errMsg(e))); }, []);
  if (!o) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Accounts" value={o.users.total} hint={`${o.users.new7} new this week · ${o.users.new30} this month`} onClick={() => onOpen("users")} />
        <Stat label="Admins" value={o.users.admins} hint={o.users.banned ? `${o.users.banned} suspended` : "No suspended accounts"} onClick={() => onOpen("users")} />
        <Stat label="Cloud catalogs" value={o.catalogs} hint={`${o.workspaces} workspace${o.workspaces === 1 ? "" : "s"}`} />
        <Stat label="Published sites" value={o.sites.total} hint={`${o.sites.views.toLocaleString()} views`} onClick={() => onOpen("sites")} />
        <Stat label="Stored files" value={fmtBytes(o.storage.bytes)} hint={`${o.storage.files} images, fonts and videos`} />
        <Stat label="AI requests (30 days)" value={o.ai30d.total} hint={o.ai30d.errors ? `${o.ai30d.errors} failed` : "No failures"} />
        <Stat label="Sign-ups" value={<span className="text-base">{POLICY_LABEL[o.signupPolicy]}</span>} onClick={() => onOpen("settings")} />
      </div>
    </div>
  );
}

// ---------- Users ----------

function UsersTab() {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [suspending, setSuspending] = useState<UserRow | null>(null);
  const [deleting, setDeleting] = useState<UserRow | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (offset = 0) => {
    const r = await api().admin.users.list.query({ query: query || undefined, limit: 25, offset });
    setRows((prev) => (offset ? [...(prev ?? []), ...r.users] : r.users));
    setTotal(r.total);
    setHasMore(r.hasMore);
  }, [query]);
  useEffect(() => {
    const t = setTimeout(() => void load().catch((e) => toast.error(errMsg(e))), 250);
    return () => clearTimeout(t);
  }, [load]);

  async function act(u: UserRow, label: string, fn: () => Promise<unknown>) {
    setBusy(u.id);
    try {
      await fn();
      toast.success(label);
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-4 text-sm">
      <div className="flex items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <HugeiconsIcon icon={Search01Icon} className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="ps-8" placeholder="Search by name or email" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search users" />
        </div>
        <span className="text-xs text-muted-foreground">{total} account{total === 1 ? "" : "s"}</span>
      </div>

      {suspending && <SuspendForm user={suspending} onClose={() => setSuspending(null)} onDone={() => { setSuspending(null); void load(); }} />}

      {!rows ? <p className="text-muted-foreground">Loading…</p> : !rows.length ? <p className="text-muted-foreground">No accounts match.</p> : (
        <div className={surface.table}>
          <table className="w-full min-w-[640px] text-start">
            <thead className={surface.thead}>
              <tr>
                <th className="px-3 py-2 text-start font-medium">Account</th>
                <th className="px-3 py-2 text-start font-medium">Role</th>
                <th className="px-3 py-2 text-end font-medium">Catalogs</th>
                <th className="px-3 py-2 text-start font-medium">Joined</th>
                <th className="px-3 py-2 text-start font-medium">Last active</th>
                <th className="w-10 px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((u) => (
                <tr key={u.id} className={u.banned ? "bg-destructive/5" : undefined}>
                  <td className="px-3 py-2">
                    <p className="font-medium" dir="auto">{u.name} {u.isYou && <span className="text-xs font-normal text-muted-foreground">(you)</span>}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                    {u.banned && <p className="text-xs text-destructive">Suspended{u.banExpires ? ` until ${fmtDate(u.banExpires)}` : ""}{u.banReason ? ` — ${u.banReason}` : ""}</p>}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={u.role === "admin" ? "default" : "secondary"}>
                      {u.role === "admin" && <HugeiconsIcon icon={Shield01Icon} />} {u.role === "admin" ? "Admin" : "User"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums">{u.catalogs}</td>
                  <td className="px-3 py-2 text-muted-foreground">{fmtDate(u.createdAt)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{ago(u.lastSeenAt)}</td>
                  <td className="px-3 py-2">
                    {busy === u.id ? <HugeiconsIcon icon={Loading02Icon} className="size-4 animate-spin" /> : (
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${u.email}`} />}><HugeiconsIcon icon={MoreHorizontalIcon} /></DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-52">
                          {u.role === "admin"
                            ? <DropdownMenuItem disabled={u.isYou} onClick={() => act(u, "Admin removed", () => api().admin.users.setRole.mutate({ userId: u.id, role: "user" }))}><HugeiconsIcon icon={Shield02Icon} /> Remove admin</DropdownMenuItem>
                            : <DropdownMenuItem disabled={u.banned} onClick={() => act(u, `${u.name} is now an admin`, () => api().admin.users.setRole.mutate({ userId: u.id, role: "admin" }))}><HugeiconsIcon icon={Shield01Icon} /> Make admin</DropdownMenuItem>}
                          {u.banned
                            ? <DropdownMenuItem onClick={() => act(u, "Suspension lifted", () => api().admin.users.unban.mutate({ userId: u.id }))}><HugeiconsIcon icon={UserCheck01Icon} /> Lift suspension</DropdownMenuItem>
                            : <DropdownMenuItem disabled={u.isYou || u.role === "admin"} onClick={() => setSuspending(u)}><HugeiconsIcon icon={BanIcon} /> Suspend…</DropdownMenuItem>}
                          <DropdownMenuItem
                            disabled={u.isYou}
                            onClick={() => act(u, "Signed out everywhere", () => api().admin.users.revokeSessions.mutate({ userId: u.id }))}
                          >
                            <HugeiconsIcon icon={Logout01Icon} /> Sign out everywhere
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={u.isYou}
                            onClick={() => { setDeleting(u); setDeleteConfirmation(""); }}
                          >
                            <HugeiconsIcon icon={Delete02Icon} /> Delete account…
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hasMore && <Button variant="outline" className="justify-self-center" onClick={() => void load(rows?.length ?? 0)}>Load more</Button>}
      <Dialog open={!!deleting} onOpenChange={(open) => { if (!open) { setDeleting(null); setDeleteConfirmation(""); } }}>
        {deleting && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {deleting.email}?</DialogTitle>
              <DialogDescription>This permanently removes the account, all of its cloud catalogs and published sites. Type the email address to confirm.</DialogDescription>
            </DialogHeader>
            <Input autoFocus type="email" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} aria-label="Type the account email to confirm deletion" placeholder={deleting.email} />
            <DialogFooter>
              <Button variant="outline" onClick={() => { setDeleting(null); setDeleteConfirmation(""); }}>Cancel</Button>
              <Button variant="destructive" disabled={deleteConfirmation.trim().toLowerCase() !== deleting.email.toLowerCase()} onClick={() => {
                const target = deleting;
                setDeleting(null);
                setDeleteConfirmation("");
                void act(target, "Account deleted", () => api().admin.users.remove.mutate({ userId: target.id }));
              }}>Delete account</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function SuspendForm({ user, onClose, onDone }: { user: UserRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className={`grid gap-3 ${surface.danger}`}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api().admin.users.ban.mutate({ userId: user.id, reason: reason || undefined, days: days ? Number(days) : undefined });
          toast.success(`${user.email} suspended`);
          onDone();
        } catch (err) {
          toast.error(errMsg(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="font-medium">Suspend {user.email}</p>
      <p className="text-xs text-muted-foreground">They are signed out, can&apos;t sign in, their API keys stop working and their published sites go offline until the suspension is lifted.</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
        <label className="grid gap-1.5 text-xs">Reason (shown to admins)<Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Optional" /></label>
        <label className="grid gap-1.5 text-xs">For
          <SimpleSelect value={days} onValueChange={setDays} options={[{ value: "", label: "Until lifted" }, { value: "1", label: "1 day" }, { value: "7", label: "7 days" }, { value: "30", label: "30 days" }]} />
        </label>
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="destructive" disabled={busy}>{busy && <HugeiconsIcon icon={Loading02Icon} className="animate-spin" />} Suspend</Button>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}

// ---------- Sites ----------

function SitesTab() {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<SiteRow[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const load = useCallback(async (offset = 0) => {
    const r = await api().admin.sites.list.query({ query: query || undefined, limit: 25, offset });
    setRows((prev) => (offset ? [...(prev ?? []), ...r.sites] : r.sites));
    setHasMore(r.hasMore);
  }, [query]);
  useEffect(() => {
    const t = setTimeout(() => void load().catch((e) => toast.error(errMsg(e))), 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="grid gap-4 text-sm">
      <div className="relative max-w-sm">
        <HugeiconsIcon icon={Search01Icon} className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="ps-8" placeholder="Search by title, address or owner" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search sites" />
      </div>
      {!rows ? <p className="text-muted-foreground">Loading…</p> : !rows.length ? <p className="text-muted-foreground">No published sites.</p> : (
        <ul className={surface.list}>
          {rows.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium" dir="auto">{s.title || s.slug}</p>
                <p className="text-xs text-muted-foreground">/c/{s.slug} · {s.visibility} · v{s.version} · {s.views.toLocaleString()} views · {s.ownerEmail} · updated {ago(s.updatedAt)}</p>
              </div>
              {s.visibility !== "private" && (
                <a href={`/c/${s.slug}`} target="_blank" rel="noreferrer"><Button variant="ghost" size="sm"><HugeiconsIcon icon={LinkSquare01Icon} /> Open</Button></a>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  if (!await confirmAction({ title: `Take “${s.title || s.slug}” offline?`, description: "The owner keeps the catalog and can publish again.", confirmLabel: "Unpublish site", destructive: true })) return;
                  try {
                    await api().admin.sites.unpublish.mutate({ publicationId: s.id });
                    toast.success("Site taken offline");
                    await load();
                  } catch (e) {
                    toast.error(errMsg(e));
                  }
                }}
              >
                Unpublish
              </Button>
            </li>
          ))}
        </ul>
      )}
      {hasMore && <Button variant="outline" className="justify-self-center" onClick={() => void load(rows?.length ?? 0)}>Load more</Button>}
    </div>
  );
}

// ---------- Activity ----------

const ACTIVITY_AREAS = [
  ["", "All areas"], ["catalogs", "Catalogs"], ["assets", "Images and fonts"], ["exports", "Previews and exports"],
  ["publication", "Published sites"], ["workspace", "Workspaces"], ["ai", "AI"], ["api_keys", "API keys"],
  ["integrations", "Connected services"], ["admin", "Admin"], ["auth", "Sign-in and accounts"], ["account", "Account"],
] as const;

function ActivityTab() {
  const [area, setArea] = useState("");
  const [outcome, setOutcome] = useState("");
  const [actor, setActor] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [page, setPage] = useState<ActivityPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setActorFilter(actor.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [actor]);
  const load = useCallback(async (append = false, cursor?: ActivityPage["nextCursor"]) => {
    setLoading(true);
    setError(null);
    try {
      const next = await api().admin.activity.query({
        limit: 50,
        area: area ? area as ActivityRow["area"] : undefined,
        outcome: outcome ? outcome as "ok" | "denied" | "error" : undefined,
        actor: actorFilter || undefined,
        before: append ? cursor?.before : undefined,
        beforeId: append ? cursor?.beforeId : undefined,
      });
      setPage((current) => append && current ? { ...next, rows: [...current.rows, ...next.rows] } : next);
    } catch (cause) {
      const message = errMsg(cause);
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [area, outcome, actorFilter]);
  useEffect(() => { setPage(null); void load(); }, [load]);
  const rows = page?.rows ?? [];
  const areaLabel = (value: string) => ACTIVITY_AREAS.find(([key]) => key === value)?.[1] ?? value;
  return (
    <div className="grid gap-4 text-sm">
      <div className="flex flex-wrap gap-2">
        <SimpleSelect aria-label="Filter admin activity by area" className="w-52" value={area} onValueChange={setArea} options={ACTIVITY_AREAS.map(([value, label]) => ({ value, label }))} />
        <SimpleSelect aria-label="Filter admin activity by result" className="w-40" value={outcome} onValueChange={setOutcome} options={[{ value: "", label: "Any result" }, { value: "ok", label: "Succeeded" }, { value: "denied", label: "Denied" }, { value: "error", label: "Failed" }]} />
        <Input className="w-56" aria-label="Filter admin activity by account" placeholder="Account email" value={actor} onChange={(event) => setActor(event.target.value)} />
      </div>
      {error && <div className="flex items-center gap-2 text-destructive"><span>{error}</span><Button size="sm" variant="outline" onClick={() => void load()}>Retry</Button></div>}
      {!page && loading && <p className="text-muted-foreground">Loading activity…</p>}
      {page && rows.length === 0 && <p className="text-muted-foreground">No activity matches these filters yet.</p>}
      {rows.length > 0 && <div className={surface.table}>
        <Table>
          <TableHeader className={surface.thead}><TableRow><TableHead>When</TableHead><TableHead>Area</TableHead><TableHead>Activity</TableHead><TableHead>Account</TableHead><TableHead>Target</TableHead><TableHead>Result</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((row: ActivityRow) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">{new Date(row.createdAt).toLocaleString()}</TableCell>
                <TableCell><Badge variant="outline">{areaLabel(row.area)}</Badge></TableCell>
                <TableCell><span className="font-medium">{row.action.replace(/[:_]/g, " · ")}</span><span className="ms-2 text-muted-foreground">via {row.channel}</span></TableCell>
                <TableCell>{row.userEmail ?? "—"}</TableCell>
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

// ---------- Sign-ups ----------

const POLICIES = [
  { id: "open", title: "Open", text: "Anyone who can reach this server can create an account." },
  { id: "invite-only", title: "Invite-only", text: "Only email addresses with a pending workspace invitation can sign up. Existing accounts are unaffected." },
  { id: "closed", title: "Closed", text: "No new accounts. Existing accounts keep working; admins can still re-open sign-ups." },
] as const;

function SignupsTab() {
  const [policy, setPolicy] = useState<Overview["signupPolicy"] | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { api().admin.overview.query().then((o) => setPolicy(o.signupPolicy)).catch((e) => toast.error(errMsg(e))); }, []);
  if (!policy) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const changePolicy = async (value: string) => {
    const selected = POLICIES.find((candidate) => candidate.id === value);
    if (!selected) return;
    setSaving(true);
    try {
      const r = await api().admin.settings.setSignupPolicy.mutate({ policy: selected.id });
      setPolicy(r.signupPolicy);
      toast.success(`Sign-ups: ${selected.title.toLowerCase()}`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <fieldset className="max-w-2xl text-sm" disabled={saving}>
      <legend className="mb-2 text-muted-foreground">Who can create an account on this server</legend>
      <RadioGroup value={policy} disabled={saving} onValueChange={changePolicy} className="gap-2">
        {POLICIES.map((p) => (
          <label key={p.id} className={`flex cursor-pointer gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/50 ${policy === p.id ? "border-primary ring-1 ring-primary" : ""}`}>
            <RadioGroupItem value={p.id} />
            <span><span className="font-medium">{p.title}</span><br /><span className="text-muted-foreground">{p.text}</span></span>
          </label>
        ))}
      </RadioGroup>
    </fieldset>
  );
}
