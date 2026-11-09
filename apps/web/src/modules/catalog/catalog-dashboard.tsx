"use client";

import type { CatalogSummary } from "@Kavero/local-storage";
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
import { Copy, Download, HardDrive, MoreHorizontal, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

import {
  createLocalCatalog,
  deleteLocalCatalog,
  downloadProjectFile,
  duplicateLocalCatalog,
  importLocalProject,
  renameLocalCatalog,
  useLocalCatalogs,
} from "./local-catalogs";
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
  const fileInput = useRef<HTMLInputElement>(null);

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
            {session ? "Cloud sync is coming soon." : (
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
            className="h-8 border border-input bg-transparent px-2 text-xs"
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

      {catalogs?.length === 0 && (
        <div className="flex flex-col items-center gap-3 border border-dashed px-6 py-16 text-center">
          <h2 className="text-lg font-medium">No catalogs yet</h2>
          <p className="max-w-sm text-sm text-muted-foreground">Start from a template or a blank page. Everything is saved in your browser — no account needed.</p>
          <Button size="lg" onClick={() => setCreating(true)}><Plus /> Create your first catalog</Button>
        </div>
      )}

      {catalogs && catalogs.length > 0 && visible.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">No catalogs match “{query}”.</p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((c) => <CatalogCard key={c.id} catalog={c} />)}
      </div>

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

function CatalogCard({ catalog: c }: { catalog: CatalogSummary }) {
  const [renaming, setRenaming] = useState(false);

  async function act(fn: () => Promise<unknown>, done?: string) {
    try {
      await fn();
      if (done) toast.success(done);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="group relative flex flex-col border bg-card transition-shadow hover:shadow-md">
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
            <span className="inline-flex items-center gap-1 border px-1 py-px text-[10px] uppercase tracking-wide">
              <HardDrive className="size-2.5" /> {c.location === "synced" ? "Synced" : "Local"}
            </span>
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
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                if (confirm(`Delete "${c.title}"? This removes it and its images from this browser and cannot be undone.`)) {
                  act(() => deleteLocalCatalog(c.id), "Catalog deleted");
                }
              }}
            >
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
