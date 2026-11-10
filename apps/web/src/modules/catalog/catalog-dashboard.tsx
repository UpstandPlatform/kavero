"use client";

import { hasUnsyncedChanges, type CatalogSummary } from "@Kavero/local-storage";
import { Button } from "@Kavero/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@Kavero/ui/components/dropdown-menu";
import { Input } from "@Kavero/ui/components/input";
import { Skeleton } from "@Kavero/ui/components/skeleton";
import { Sparkles, Cloud, CloudOff, CloudUpload, Copy, Download, HardDrive, RefreshCw, MoreHorizontal, Pencil, Plus, Search, Trash2, Upload, Presentation } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

import {
  addExampleCatalogs,
  createLocalCatalog,
  deleteLocalCatalog,
  downloadProjectFile,
  duplicateLocalCatalog,
  importLocalProject,
  renameLocalCatalog,
  seedExampleCatalogs,
  useLocalCatalogs,
} from "./local-catalogs";
import { SyncConflictError, deleteCloudCopy, listCloudCatalogs, listWorkspaces, pushCatalog, refreshFromCloud } from "./cloud-sync";
import { CloudOnlyList, ConflictDialog } from "./cloud-ui";
import { AiGenerateDialog } from "./ai-generate-dialog";
import { NewCatalogDialog } from "./new-catalog-dialog";

type Sort = "updated" | "created" | "title";

function timeAgo(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const units: [number, string][] = [[60, "minute"], [3600, "hour"], [86400, "day"], [604800, "week"]];
  let label = "";
  for (const [secs, name] of units) if (s >= secs) label = `${Math.floor(s / secs)} ${name}${Math.floor(s / secs) === 1 ? "" : "s"} ago`;
  return s > 2_592_000 ? new Date(ts).toLocaleDateString() : label;
}

export function CatalogDashboard() {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const { catalogs, error } = useLocalCatalogs();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("updated");
  const [creating, setCreating] = useState(false);
  const [generating, setGenerating] = useState(false);
  // Deep link from the landing page: /dashboard?generate=1 opens "Generate with AI".
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("generate") === "1") setGenerating(true);
    if (params.get("new") === "1") setCreating(true);
    // The app header's "New catalog" / "Generate" buttons while already on this page.
    const onAction = (e: Event) => ((e as CustomEvent).detail === "new" ? setCreating(true) : setGenerating(true));
    window.addEventListener("kavero:dashboard", onAction);
    return () => window.removeEventListener("kavero:dashboard", onAction);
  }, []);
  // Example presentations appear on a fresh dashboard (once per browser).
  const catalogsLoaded = catalogs !== null;
  useEffect(() => {
    if (catalogsLoaded) void seedExampleCatalogs().catch(() => undefined);
  }, [catalogsLoaded]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [conflicts, setConflicts] = useState<Set<string>>(new Set());
  const [cloudOnlyCount, setCloudOnlyCount] = useState(0);
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string; role: string }[]>([]);
  const [cloudInfo, setCloudInfo] = useState<Map<string, { workspaceName: string | null; role: string }>>(new Map());

  useEffect(() => {
    if (!session) return;
    void listWorkspaces().then(setWorkspaces, () => undefined);
    void listCloudCatalogs().then((list) => setCloudInfo(new Map(list.map((c) => [c.id, { workspaceName: c.workspaceName, role: c.role }]))), () => undefined);
  }, [session, catalogs?.length]);
  const refreshed = useRef(false);

  // Pull catalogs that changed in the cloud (another device, or an AI agent via MCP).
  useEffect(() => {
    const userId = session?.user.id;
    if (!userId || !catalogs || refreshed.current) return;
    refreshed.current = true;
    const linked = catalogs.filter((c) => c.cloud?.userId === userId);
    if (!linked.length) return;
    void listCloudCatalogs().then(async (cloud) => {
      const rev = new Map(cloud.map((c) => [c.id, c.revision]));
      const found = new Set<string>();
      let pulled = 0;
      for (const c of linked) {
        const r = await refreshFromCloud(c.id, userId, rev.get(c.cloud!.id)).catch(() => "offline" as const);
        if (r === "pulled") pulled++;
        if (r === "conflict") found.add(c.id);
      }
      setConflicts(found);
      if (pulled) toast.success(`Updated ${pulled} catalog${pulled === 1 ? "" : "s"} from the cloud`);
    }, () => undefined);
  }, [session, catalogs]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (catalogs ?? []).filter((c) => !q || c.title.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q));
    return [...list].sort((a, b) =>
      sort === "title" ? a.title.localeCompare(b.title) : sort === "created" ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt,
    );
  }, [catalogs, query, sort]);

  async function onImport(file: File | undefined) {
    if (!file) return;
    try {
      const { document, warnings } = await importLocalProject(file);
      toast.success(`Imported "${document.metadata.title}"`, warnings.length ? { description: `${warnings.length} warning(s): ${warnings[0]}` } : undefined);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your catalogs</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <HardDrive className="size-3.5" />
            Saved in this browser.{" "}
            {session ? "Catalogs you save to the cloud stay in sync across your devices." : (
              <>
                <Link href="/login" className="underline underline-offset-2">Sign in</Link> later to sync across devices.
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <input ref={fileInput} type="file" accept=".kavero,application/json" className="hidden" onChange={(e) => onImport(e.target.files?.[0])} />
          <Button variant="outline" size="lg" onClick={() => fileInput.current?.click()}>
            <Upload /> Import
          </Button>
          <Button variant="outline" size="lg" onClick={() => setGenerating(true)}>
            <Sparkles /> Generate with AI
          </Button>
          <Button size="lg" onClick={() => setCreating(true)}>
            <Plus /> New catalog
          </Button>
        </div>
      </div>

      {catalogs && catalogs.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search catalogs" className="pl-7" aria-label="Search catalogs" />
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            aria-label="Sort catalogs"
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-xs"
          >
            <option value="updated">Last edited</option>
            <option value="created">Newest</option>
            <option value="title">Name</option>
          </select>
        </div>
      )}

      {error && <p className="border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">Could not open local storage: {error}</p>}

      {!catalogs && !error && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="aspect-[4/3]" />)}
        </div>
      )}

      {catalogs?.length === 0 && !cloudOnlyCount && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
          <h2 className="text-lg font-medium">No catalogs yet</h2>
          <p className="max-w-sm text-sm text-muted-foreground">Start from a template or a blank page. Everything is saved in your browser — no account needed.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button size="lg" onClick={() => setCreating(true)}><Plus /> Create your first catalog</Button>
            <Button size="lg" variant="outline" onClick={() => void addExampleCatalogs().then((n) => toast.success(`Added ${n} example presentations`), (e: Error) => toast.error(e.message))}>
              <Presentation /> Add example presentations
            </Button>
          </div>
        </div>
      )}

      {catalogs && catalogs.length > 0 && visible.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">No catalogs match “{query}”.</p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((c) => <CatalogCard key={c.id} catalog={c} userId={session?.user.id ?? null} cloudConflict={conflicts.has(c.id)} workspaces={workspaces} cloud={c.cloud ? cloudInfo.get(c.cloud.id) : undefined} />)}
      </div>

      {session && catalogs && (
        <CloudOnlyList key={catalogs.map((c) => c.id + c.location).join()} userId={session.user.id} localDocumentIds={new Set(catalogs.map((c) => c.id))} onCount={setCloudOnlyCount} />
      )}

      {generating && <AiGenerateDialog onClose={() => setGenerating(false)} />}

      <NewCatalogDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={async (v) => {
          try {
            const doc = await createLocalCatalog(v);
            setCreating(false);
            router.push(`/editor/${doc.id}`);
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      />
    </div>
  );
}

function CatalogCard({ catalog: c, userId, cloudConflict = false, workspaces = [], cloud }: {
  catalog: CatalogSummary;
  userId: string | null;
  cloudConflict?: boolean;
  workspaces?: { id: string; name: string; role: string }[];
  cloud?: { workspaceName: string | null; role: string };
}) {
  const [renaming, setRenaming] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const linkedElsewhere = !!c.cloud && !!userId && c.cloud.userId !== userId;

  async function act(fn: () => Promise<unknown>, done?: string) {
    try {
      await fn();
      if (done) toast.success(done);
    } catch (e) {
      if (e instanceof SyncConflictError) setConflict(true);
      else toast.error((e as Error).message);
    }
  }

  async function sync(workspace?: { id: string; name: string }) {
    if (!userId) return;
    setSyncing(true);
    await act(async () => {
      const r = await pushCatalog(c.id, userId, { workspaceId: workspace?.id });
      toast.success(r.status === "unchanged" ? "Already up to date" : c.cloud ? "Synced to cloud" : workspace ? `Saved to ${workspace.name}` : "Saved to your cloud");
    });
    setSyncing(false);
  }

  const status = !c.cloud
    ? { icon: <HardDrive className="size-2.5" />, label: "Local", title: "Only in this browser" }
    : !userId
      ? { icon: <CloudOff className="size-2.5" />, label: "Sign in to sync", title: "Linked to a cloud catalog. Sign in to check for changes and sync." }
    : linkedElsewhere
      ? { icon: <CloudOff className="size-2.5" />, label: "Other account", title: "Linked to a different account" }
      : cloudConflict
        ? { icon: <CloudOff className="size-2.5 text-destructive" />, label: "Conflict", title: "Changed here and in the cloud. Use Sync now to choose a version." }
      : hasUnsyncedChanges(c)
        ? { icon: <CloudUpload className="size-2.5" />, label: "Changed", title: "Has edits not in the cloud yet" }
        : { icon: <Cloud className="size-2.5" />, label: "Synced", title: "Matches your cloud copy" };

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md">
      <Link href={`/editor/${c.id}`} className="block aspect-[4/3] overflow-hidden bg-muted p-4" aria-label={`Open ${c.title}`}>
        {c.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.thumbnail} alt="" className="mx-auto h-full w-auto max-w-full object-contain shadow-sm" />
        ) : (
          <div className="h-full w-full bg-background" />
        )}
      </Link>
      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const title = String(new FormData(e.currentTarget).get("title")).trim();
                setRenaming(false);
                if (title && title !== c.title) act(() => renameLocalCatalog(c.id, title));
              }}
            >
              <Input name="title" defaultValue={c.title} autoFocus onBlur={(e) => e.currentTarget.form?.requestSubmit()} aria-label="Catalog name" />
            </form>
          ) : (
            <Link href={`/editor/${c.id}`} className="block truncate text-sm font-medium hover:underline">{c.title}</Link>
          )}
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span title={status.title} className="inline-flex items-center gap-1 border px-1 py-px text-[10px] uppercase tracking-wide">
              {syncing ? <RefreshCw className="size-2.5 animate-spin" /> : status.icon} {status.label}
            </span>
            {cloud?.workspaceName && <span className="truncate" title={`Workspace · your role: ${cloud.role}`}>{cloud.workspaceName}{cloud.role === "viewer" ? " (view only)" : ""} ·</span>}
            {c.slideCount} slide{c.slideCount === 1 ? "" : "s"} · {timeAgo(c.updatedAt)}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${c.title}`} />}>
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-card">
            <DropdownMenuItem onClick={() => setRenaming(true)}><Pencil /> Rename</DropdownMenuItem>
            <DropdownMenuItem onClick={() => act(() => duplicateLocalCatalog(c.id), "Catalog duplicated")}><Copy /> Duplicate</DropdownMenuItem>
            <DropdownMenuItem onClick={() => act(() => downloadProjectFile(c.id, c.title))}><Download /> Export .kavero file</DropdownMenuItem>
            {userId && !linkedElsewhere && (
              <>
                <DropdownMenuSeparator />
                {c.cloud ? (
                  <DropdownMenuItem onClick={() => sync()}><RefreshCw /> Sync now</DropdownMenuItem>
                ) : (
                  <>
                    <DropdownMenuItem onClick={() => sync()}><CloudUpload /> Save to my cloud</DropdownMenuItem>
                    {workspaces.filter((w) => w.role !== "viewer").map((w) => (
                      <DropdownMenuItem key={w.id} onClick={() => sync(w)}><CloudUpload /> Save to {w.name}</DropdownMenuItem>
                    ))}
                  </>
                )}
                {c.cloud && (
                  <DropdownMenuItem
                    onClick={() => {
                      if (confirm(`Remove the cloud copy of "${c.title}"? The copy in this browser stays. Other devices will no longer see it.`)) {
                        act(() => deleteCloudCopy(c.id), "Cloud copy removed");
                      }
                    }}
                  >
                    <CloudOff /> Remove cloud copy
                  </DropdownMenuItem>
                )}
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                if (confirm(`Delete "${c.title}" from this browser? This removes it and its images here and cannot be undone.${c.cloud ? " Your cloud copy is kept." : ""}`)) {
                  act(() => deleteLocalCatalog(c.id), "Catalog deleted");
                }
              }}
            >
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {conflict && userId && c.cloud && (
        <ConflictDialog localId={c.id} cloudId={c.cloud.id} title={c.title} userId={userId} onClose={() => setConflict(false)} />
      )}
    </div>
  );
}
