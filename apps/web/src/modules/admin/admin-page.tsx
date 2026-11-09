"use client";

import { Button } from "@Kavero/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@Kavero/ui/components/dropdown-menu";
import { Input } from "@Kavero/ui/components/input";
import {
  Ban, ExternalLink, Globe, LayoutDashboard, Loader2, LogOut, MoreHorizontal, ScrollText, Search, Settings2, Shield, ShieldOff, Trash2, UserCheck, Users,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { makeTRPCClient } from "@/utils/trpc";

let client: ReturnType<typeof makeTRPCClient> | null = null;
const api = () => (client ??= makeTRPCClient());

type Api = ReturnType<typeof api>;
type Overview = Awaited<ReturnType<Api["admin"]["overview"]["query"]>>;
type UserRow = Awaited<ReturnType<Api["admin"]["users"]["list"]["query"]>>["users"][number];
type SiteRow = Awaited<ReturnType<Api["admin"]["sites"]["list"]["query"]>>["sites"][number];
type ActivityRow = Awaited<ReturnType<Api["admin"]["activity"]["query"]>>[number];
type Tab = "overview" | "users" | "sites" | "activity" | "settings";
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <LayoutDashboard /> },
  { id: "users", label: "Users", icon: <Users /> },
  { id: "sites", label: "Published sites", icon: <Globe /> },
  { id: "activity", label: "Activity", icon: <ScrollText /> },
  { id: "settings", label: "Sign-ups", icon: <Settings2 /> },
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
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 className="mb-1 flex items-center gap-2 text-2xl font-semibold tracking-tight"><Shield className="size-6" /> Admin</h1>
      <p className="mb-6 text-sm text-muted-foreground">Manage accounts, sign-ups and published sites on this Kavero server.</p>
      <div className="mb-6 flex flex-wrap gap-1 border-b" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => { setTab(t.id); history.replaceState(null, "", `#${t.id}`); }}
            className="-mb-px inline-flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground aria-selected:border-foreground aria-selected:text-foreground [&_svg]:size-4"
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>
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
    ? <button type="button" onClick={onClick} className="rounded-xl border p-4 text-start transition-colors hover:bg-muted/50">{body}</button>
    : <div className="rounded-xl border p-4">{body}</div>;
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
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="ps-8" placeholder="Search by name or email" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search users" />
        </div>
        <span className="text-xs text-muted-foreground">{total} account{total === 1 ? "" : "s"}</span>
      </div>

      {suspending && <SuspendForm user={suspending} onClose={() => setSuspending(null)} onDone={() => { setSuspending(null); void load(); }} />}

      {!rows ? <p className="text-muted-foreground">Loading…</p> : !rows.length ? <p className="text-muted-foreground">No accounts match.</p> : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[640px] text-start">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
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
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${u.role === "admin" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                      {u.role === "admin" && <Shield className="size-3" />} {u.role === "admin" ? "Admin" : "User"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums">{u.catalogs}</td>
                  <td className="px-3 py-2 text-muted-foreground">{fmtDate(u.createdAt)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{ago(u.lastSeenAt)}</td>
                  <td className="px-3 py-2">
                    {busy === u.id ? <Loader2 className="size-4 animate-spin" /> : (
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${u.email}`} />}><MoreHorizontal /></DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-52">
                          {u.role === "admin"
                            ? <DropdownMenuItem disabled={u.isYou} onClick={() => act(u, "Admin removed", () => api().admin.users.setRole.mutate({ userId: u.id, role: "user" }))}><ShieldOff /> Remove admin</DropdownMenuItem>
                            : <DropdownMenuItem disabled={u.banned} onClick={() => act(u, `${u.name} is now an admin`, () => api().admin.users.setRole.mutate({ userId: u.id, role: "admin" }))}><Shield /> Make admin</DropdownMenuItem>}
                          {u.banned
                            ? <DropdownMenuItem onClick={() => act(u, "Suspension lifted", () => api().admin.users.unban.mutate({ userId: u.id }))}><UserCheck /> Lift suspension</DropdownMenuItem>
                            : <DropdownMenuItem disabled={u.isYou || u.role === "admin"} onClick={() => setSuspending(u)}><Ban /> Suspend…</DropdownMenuItem>}
                          <DropdownMenuItem
                            disabled={u.isYou}
                            onClick={() => act(u, "Signed out everywhere", () => api().admin.users.revokeSessions.mutate({ userId: u.id }))}
                          >
                            <LogOut /> Sign out everywhere
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={u.isYou}
                            onClick={() => {
                              if (prompt(`Delete ${u.email} and all of their cloud catalogs and published sites? This can't be undone.\n\nType the email address to confirm:`)?.trim().toLowerCase() !== u.email.toLowerCase()) return;
                              void act(u, "Account deleted", () => api().admin.users.remove.mutate({ userId: u.id }));
                            }}
                          >
                            <Trash2 /> Delete account…
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
    </div>
  );
}

function SuspendForm({ user, onClose, onDone }: { user: UserRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="grid gap-3 rounded-xl border border-destructive/40 p-4"
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
      <p className="text-xs text-muted-foreground">They are signed out, can&apos;t sign in, their API tokens stop working and their published sites go offline until the suspension is lifted.</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
        <label className="grid gap-1 text-xs">Reason (shown to admins)<Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Optional" /></label>
        <label className="grid gap-1 text-xs">For
          <select className="h-8 rounded-lg border border-input bg-transparent px-2 text-xs" value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="">Until lifted</option>
            <option value="1">1 day</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
          </select>
        </label>
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="destructive" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Suspend</Button>
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
        <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="ps-8" placeholder="Search by title, address or owner" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search sites" />
      </div>
      {!rows ? <p className="text-muted-foreground">Loading…</p> : !rows.length ? <p className="text-muted-foreground">No published sites.</p> : (
        <ul className="divide-y rounded-xl border">
          {rows.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium" dir="auto">{s.title || s.slug}</p>
                <p className="text-xs text-muted-foreground">/c/{s.slug} · {s.visibility} · v{s.version} · {s.views.toLocaleString()} views · {s.ownerEmail} · updated {ago(s.updatedAt)}</p>
              </div>
              {s.visibility !== "private" && (
                <a href={`/c/${s.slug}`} target="_blank" rel="noreferrer"><Button variant="ghost" size="sm"><ExternalLink /> Open</Button></a>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  if (!confirm(`Take "${s.title || s.slug}" offline? The owner keeps the catalog and can publish again.`)) return;
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

const FILTERS = [["", "Everything"], ["admin:", "Admin actions"], ["mcp:", "MCP / AI agents"]] as const;

function ActivityTab() {
  const [filter, setFilter] = useState("");
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  useEffect(() => {
    setRows(null);
    api().admin.activity.query({ limit: 100, action: filter || undefined }).then(setRows).catch((e) => toast.error(errMsg(e)));
  }, [filter]);
  return (
    <div className="grid gap-4 text-sm">
      <div className="flex gap-1">
        {FILTERS.map(([v, label]) => (
          <Button key={v} size="sm" variant={filter === v ? "secondary" : "ghost"} onClick={() => setFilter(v)}>{label}</Button>
        ))}
      </div>
      {!rows ? <p className="text-muted-foreground">Loading…</p> : !rows.length ? <p className="text-muted-foreground">Nothing recorded yet.</p> : (
        <ul className="divide-y rounded-xl border font-mono text-xs">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap gap-x-3 gap-y-0.5 px-3 py-2">
              <span className="text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</span>
              <span className={r.outcome === "ok" ? "" : "text-destructive"}>{r.action}</span>
              <span className="text-muted-foreground">{r.userEmail ?? "—"}</span>
              {r.target && <span className="truncate text-muted-foreground">→ {r.target}</span>}
              {r.outcome !== "ok" && <span className="text-destructive">{r.outcome}</span>}
            </li>
          ))}
        </ul>
      )}
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
  return (
    <fieldset className="grid max-w-2xl gap-2 text-sm" disabled={saving}>
      <legend className="mb-2 text-muted-foreground">Who can create an account on this server</legend>
      {POLICIES.map((p) => (
        <label key={p.id} className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${policy === p.id ? "border-foreground" : ""}`}>
          <input
            type="radio"
            name="signup-policy"
            className="mt-1"
            checked={policy === p.id}
            onChange={async () => {
              setSaving(true);
              try {
                const r = await api().admin.settings.setSignupPolicy.mutate({ policy: p.id });
                setPolicy(r.signupPolicy);
                toast.success(`Sign-ups: ${p.title.toLowerCase()}`);
              } catch (e) {
                toast.error(errMsg(e));
              } finally {
                setSaving(false);
              }
            }}
          />
          <span><span className="font-medium">{p.title}</span><br /><span className="text-muted-foreground">{p.text}</span></span>
        </label>
      ))}
    </fieldset>
  );
}
