"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, CloudIcon, CloudLoadingIcon, CloudUploadIcon, Copy01Icon, Delete02Icon, Download01Icon, HardDriveIcon, LayoutGridIcon, ListIcon, MoreHorizontalIcon, PencilIcon, Presentation01Icon, Refresh01Icon, Search01Icon, SparklesIcon, Upload01Icon } from "@hugeicons/core-free-icons";
import { TEMPLATES } from "@Kavero/catalog-engine";
import { hasUnsyncedChanges, type CatalogSummary } from "@Kavero/local-storage";
import { Badge } from "@Kavero/ui/components/badge";
import { Button } from "@Kavero/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@Kavero/ui/components/dropdown-menu";
import { Input } from "@Kavero/ui/components/input";
import { SimpleSelect } from "@Kavero/ui/components/simple-select";
import { Skeleton } from "@Kavero/ui/components/skeleton";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { surface } from "@/components/surface";
import { authClient } from "@/lib/auth-client";
import { confirmAction } from "@/components/confirm-dialog";
import { TooltipHint } from "@Kavero/ui/components/tooltip";

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
import { TemplatePreview, type TemplateLayout } from "./template-preview";

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
  const [initialBrief, setInitialBrief] = useState("");
  const [initialTemplateId, setInitialTemplateId] = useState("minimal");
  const [showAllTemplates, setShowAllTemplates] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  // Deep link from the landing page: /dashboard?generate=1&brief=… opens "Generate with AI" with the prompt filled in.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("templates") === "all") setShowAllTemplates(true);
    if (params.get("generate") === "1") {
      setInitialBrief(params.get("brief")?.slice(0, 2000) ?? "");
      setGenerating(true);
    }
    if (params.get("new") === "1") {
      const requestedTemplate = params.get("template");
      if (requestedTemplate === "blank" || (requestedTemplate && TEMPLATES.some((template) => template.id === requestedTemplate))) setInitialTemplateId(requestedTemplate);
      setCreating(true);
    }
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
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string; role: string; isPersonal: boolean }[]>([]);
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

  function startFrom(templateId: string) {
    setInitialTemplateId(templateId);
    setCreating(true);
  }

  function closeCreateDialog() {
    setCreating(false);
    if (new URLSearchParams(window.location.search).has("new")) router.replace("/dashboard");
  }

  const popularTemplates = ["minimal", "dark-luxury", "studio", "tech"]
    .map((id) => TEMPLATES.find((template) => template.id === id))
    .filter((template) => template !== undefined);
  const galleryTemplates = showAllTemplates ? TEMPLATES : popularTemplates;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-12 sm:px-6">
      <section aria-labelledby="start-title" className="-mx-4 mb-8 border-b bg-muted/30 px-4 py-7 sm:-mx-6 sm:px-6 sm:py-8">
        <div className="mx-auto w-full max-w-7xl">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Start a new presentation</p>
              <h1 id="start-title" className="mt-1 text-2xl font-semibold tracking-tight">What would you like to create?</h1>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowAllTemplates((value) => !value)} aria-expanded={showAllTemplates}>
              {showAllTemplates ? "Show featured" : "Browse all templates"}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <button type="button" onClick={() => startFrom("blank")} className="group grid min-w-0 gap-2 text-start">
              <TemplatePreview theme={{ colors: { background: "#ffffff", text: "#171717", primary: "#171717", accent: "#f3f4f6" }, fonts: { heading: "Inter", body: "Inter" } }} layout="blank" title="Blank presentation" className="w-full transition-shadow group-hover:shadow-md" />
              <span className="truncate text-sm font-medium">Blank presentation</span>
            </button>
            {galleryTemplates.map((template) => (
              <button key={template.id} type="button" onClick={() => startFrom(template.id)} className="group grid min-w-0 gap-2 text-start">
                <TemplatePreview theme={template.theme} layout={template.layout as TemplateLayout} title={template.name} className="w-full transition-shadow group-hover:shadow-md" />
                <span className="truncate text-sm font-medium">{template.name}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Recent presentations</h2>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <HugeiconsIcon icon={HardDriveIcon} className="size-3.5" />
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
            <HugeiconsIcon icon={Upload01Icon} /> Import
          </Button>
          <Button variant="outline" size="lg" onClick={() => setGenerating(true)}>
            <HugeiconsIcon icon={SparklesIcon} /> Generate with AI
          </Button>
          <Button size="lg" onClick={() => setCreating(true)}>
            <HugeiconsIcon icon={Add01Icon} /> New catalog
          </Button>
        </div>
      </div>

      {catalogs && catalogs.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <HugeiconsIcon icon={Search01Icon} className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search catalogs" className="pl-7" aria-label="Search catalogs" />
          </div>
          <SimpleSelect
            className="w-36"
            value={sort}
            onValueChange={setSort}
            aria-label="Sort catalogs"
            options={[{ value: "updated", label: "Last edited" }, { value: "created", label: "Newest" }, { value: "title", label: "Name" }]}
          />
          <div role="group" aria-label="Presentation view" className="flex rounded-md border p-0.5">
            <Button variant={viewMode === "grid" ? "secondary" : "ghost"} size="icon-xs" aria-label="Grid view" aria-pressed={viewMode === "grid"} title="Grid view" onClick={() => setViewMode("grid")}><HugeiconsIcon icon={LayoutGridIcon} /></Button>
            <Button variant={viewMode === "list" ? "secondary" : "ghost"} size="icon-xs" aria-label="List view" aria-pressed={viewMode === "list"} title="List view" onClick={() => setViewMode("list")}><HugeiconsIcon icon={ListIcon} /></Button>
          </div>
        </div>
      )}

      {error && <p className={`mb-4 text-sm text-destructive ${surface.danger}`}>Could not open local storage: {error}</p>}

      {!catalogs && !error && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="aspect-video rounded-xl" />)}
        </div>
      )}

      {catalogs?.length === 0 && !cloudOnlyCount && (
        <div className={`flex flex-col items-center gap-3 px-6 py-16 text-center ${surface.empty}`}>
          <h2 className="text-lg font-medium">No catalogs yet</h2>
          <p className="max-w-sm text-sm text-muted-foreground">Start from a template or a blank page. Everything is saved in your browser — no account needed.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button size="lg" onClick={() => setCreating(true)}><HugeiconsIcon icon={Add01Icon} /> Create your first catalog</Button>
            <Button size="lg" variant="outline" onClick={() => void addExampleCatalogs().then((n) => toast.success(`Added ${n} example presentations`), (e: Error) => toast.error(e.message))}>
              <HugeiconsIcon icon={Presentation01Icon} /> Add example presentations
            </Button>
          </div>
        </div>
      )}

      {catalogs && catalogs.length > 0 && visible.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">No catalogs match “{query}”.</p>
      )}

      <div className={viewMode === "grid" ? "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "grid grid-cols-1 gap-2"}>
        {visible.map((c) => <CatalogCard key={c.id} catalog={c} userId={session?.user.id ?? null} cloudConflict={conflicts.has(c.id)} workspaces={workspaces} cloud={c.cloud ? cloudInfo.get(c.cloud.id) : undefined} viewMode={viewMode} />)}
      </div>

      {session && catalogs && (
        <CloudOnlyList key={catalogs.map((c) => c.id + c.location).join()} userId={session.user.id} localDocumentIds={new Set(catalogs.map((c) => c.id))} onCount={setCloudOnlyCount} />
      )}

      {generating && <AiGenerateDialog initialBrief={initialBrief} onClose={() => { setGenerating(false); setInitialBrief(""); }} />}

      <NewCatalogDialog
        open={creating}
        onClose={closeCreateDialog}
        initialTemplateId={initialTemplateId}
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

function CatalogCard({ catalog: c, userId, cloudConflict = false, workspaces = [], cloud, viewMode = "grid" }: {
  catalog: CatalogSummary;
  userId: string | null;
  cloudConflict?: boolean;
  workspaces?: { id: string; name: string; role: string; isPersonal: boolean }[];
  cloud?: { workspaceName: string | null; role: string };
  viewMode?: "grid" | "list";
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
      toast.success(r.status === "unchanged" ? "Already up to date" : c.cloud ? "Synced to cloud" : workspace ? `Saved to ${workspace.name}` : "Saved to Personal workspace");
    });
    setSyncing(false);
  }

  const status = !c.cloud
    ? { icon: <HugeiconsIcon icon={HardDriveIcon} className="size-2.5" />, label: "Local", title: "Only in this browser" }
    : !userId
      ? { icon: <HugeiconsIcon icon={CloudLoadingIcon} className="size-2.5" />, label: "Sign in to sync", title: "Linked to a cloud catalog. Sign in to check for changes and sync." }
    : linkedElsewhere
      ? { icon: <HugeiconsIcon icon={CloudLoadingIcon} className="size-2.5" />, label: "Other account", title: "Linked to a different account" }
      : cloudConflict
        ? { icon: <HugeiconsIcon icon={CloudLoadingIcon} className="size-2.5 text-destructive" />, label: "Conflict", title: "Changed here and in the cloud. Use Sync now to choose a version." }
      : hasUnsyncedChanges(c)
        ? { icon: <HugeiconsIcon icon={CloudUploadIcon} className="size-2.5" />, label: "Changed", title: "Has edits not in the cloud yet" }
        : { icon: <HugeiconsIcon icon={CloudIcon} className="size-2.5" />, label: "Synced", title: "Matches your cloud copy" };

  return (
    <div className={`group relative flex overflow-hidden border bg-card transition-shadow hover:shadow-md ${viewMode === "grid" ? "flex-col rounded-xl" : "min-h-24 flex-row items-center rounded-lg"}`}>
      <Link href={`/editor/${c.id}`} className={`block shrink-0 overflow-hidden bg-muted p-3 ${viewMode === "grid" ? "aspect-video w-full" : "h-24 w-40 sm:w-52"}`} aria-label={`Open ${c.title}`}>
        {c.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.thumbnail} alt="" className="mx-auto h-full w-auto max-w-full object-contain shadow-sm" />
        ) : (
          <div className="h-full w-full bg-background" />
        )}
      </Link>
      <div className={`flex min-w-0 flex-1 items-start gap-2 p-3 ${viewMode === "list" ? "items-center" : ""}`}>
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
            <TooltipHint content={status.title}><Badge variant="outline" className="h-4 px-1.5 text-[10px] font-normal tracking-wide uppercase">
              {syncing ? <HugeiconsIcon icon={Refresh01Icon} className="animate-spin" /> : status.icon} {status.label}
            </Badge></TooltipHint>
            {cloud?.workspaceName && <TooltipHint content={`Workspace · your role: ${cloud.role}`}><span tabIndex={0} className="truncate">{cloud.workspaceName}{cloud.role === "viewer" ? " (view only)" : ""} ·</span></TooltipHint>}
            {c.slideCount} slide{c.slideCount === 1 ? "" : "s"} · {timeAgo(c.updatedAt)}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${c.title}`} />}>
            <HugeiconsIcon icon={MoreHorizontalIcon} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-card">
            <DropdownMenuItem onClick={() => setRenaming(true)}><HugeiconsIcon icon={PencilIcon} /> Rename</DropdownMenuItem>
            <DropdownMenuItem onClick={() => act(() => duplicateLocalCatalog(c.id), "Catalog duplicated")}><HugeiconsIcon icon={Copy01Icon} /> Duplicate</DropdownMenuItem>
            <DropdownMenuItem onClick={() => act(() => downloadProjectFile(c.id, c.title))}><HugeiconsIcon icon={Download01Icon} /> Export .kavero file</DropdownMenuItem>
            {userId && !linkedElsewhere && (
              <>
                <DropdownMenuSeparator />
                {c.cloud ? (
                  <DropdownMenuItem onClick={() => sync()}><HugeiconsIcon icon={Refresh01Icon} /> Sync now</DropdownMenuItem>
                ) : (
                  <>
                    <DropdownMenuItem onClick={() => sync()}><HugeiconsIcon icon={CloudUploadIcon} /> Save to Personal workspace</DropdownMenuItem>
                    {workspaces.filter((w) => !w.isPersonal && w.role !== "viewer").map((w) => (
                      <DropdownMenuItem key={w.id} onClick={() => sync(w)}><HugeiconsIcon icon={CloudUploadIcon} /> Save to {w.name}</DropdownMenuItem>
                    ))}
                  </>
                )}
                {c.cloud && (
                  <DropdownMenuItem
                    onClick={async () => {
                      if (await confirmAction({ title: `Remove the cloud copy of “${c.title}”?`, description: "The copy in this browser stays. Other devices will no longer see it.", confirmLabel: "Remove cloud copy", destructive: true })) {
                        act(() => deleteCloudCopy(c.id), "Cloud copy removed");
                      }
                    }}
                  >
                    <HugeiconsIcon icon={CloudLoadingIcon} /> Remove cloud copy
                  </DropdownMenuItem>
                )}
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={async () => {
                if (await confirmAction({ title: `Delete “${c.title}” from this browser?`, description: `This removes it and its images here and cannot be undone.${c.cloud ? " Your cloud copy is kept." : ""}`, confirmLabel: "Delete catalog", destructive: true })) {
                  act(() => deleteLocalCatalog(c.id), "Catalog deleted");
                }
              }}
            >
              <HugeiconsIcon icon={Delete02Icon} /> Delete
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
