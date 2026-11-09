"use client";

import type { CatalogDocument } from "@Kavero/catalog-engine";
import { Button } from "@Kavero/ui/components/button";
import { Check, Copy, ExternalLink, Globe, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { SyncConflictError, pushCatalog } from "@/modules/catalog/cloud-sync";
import { localCatalogs } from "@/modules/catalog/local-catalogs";
import { makeTRPCClient } from "@/utils/trpc";

type Visibility = "public" | "unlisted" | "password" | "private";
type Status = Awaited<ReturnType<ReturnType<typeof makeTRPCClient>["publication"]["status"]["query"]>>;

const VISIBILITY: { value: Visibility; label: string; hint: string }[] = [
  { value: "public", label: "Public", hint: "Anyone can find it; search engines may index it." },
  { value: "unlisted", label: "Unlisted", hint: "Anyone with the link can view it. Not indexed." },
  { value: "password", label: "Password", hint: "Visitors need the link and a password." },
  { value: "private", label: "Private", hint: "Only you, while signed in." },
];

let client: ReturnType<typeof makeTRPCClient> | null = null;
const api = () => (client ??= makeTRPCClient());

export function PublishDialog({ doc, onClose }: { doc: CatalogDocument; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { data: session, isPending } = authClient.useSession();
  const [phase, setPhase] = useState<"syncing" | "ready" | "error">("syncing");
  const [error, setError] = useState<string | null>(null);
  const [cloudId, setCloudId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [slug, setSlug] = useState("");
  const [slugState, setSlugState] = useState<{ checking: boolean; ok: boolean; reason: string | null }>({ checking: false, ok: true, reason: null });
  const [visibility, setVisibility] = useState<Visibility>("unlisted");
  const [password, setPassword] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => ref.current?.showModal(), []);

  // Make sure the cloud has the latest version, then load publication settings.
  useEffect(() => {
    if (isPending || !session) return;
    let cancelled = false;
    (async () => {
      try {
        await pushCatalog(doc.id, session.user.id);
        const summary = (await localCatalogs().list()).find((s) => s.id === doc.id);
        if (!summary?.cloud) throw new Error("Could not save this catalog to the cloud");
        const st = await api().publication.status.query({ catalogId: summary.cloud.id });
        if (cancelled) return;
        setCloudId(summary.cloud.id);
        setStatus(st);
        const p = st.publication;
        setSlug(p?.slug ?? st.suggestedSlug);
        setVisibility((p?.visibility as Visibility) ?? "unlisted");
        setSeoTitle(p?.seoTitle ?? "");
        setSeoDescription(p?.seoDescription ?? "");
        setPhase("ready");
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof SyncConflictError ? "This catalog changed in the cloud from somewhere else. Resolve the conflict on the dashboard, then publish." : (e as Error).message);
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc.id, session, isPending]);

  // Live address check.
  useEffect(() => {
    if (!cloudId || !slug) return;
    setSlugState((s) => ({ ...s, checking: true }));
    const t = setTimeout(async () => {
      try {
        const r = await api().publication.checkSlug.query({ catalogId: cloudId, slug });
        setSlugState({ checking: false, ok: r.available, reason: r.reason });
      } catch {
        setSlugState({ checking: false, ok: true, reason: null });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [slug, cloudId]);

  const pub = status?.publication;
  const url = typeof window !== "undefined" && pub ? `${window.location.origin}/c/${pub.slug}` : "";
  const hasUnpublished = !!pub && !!status && status.catalogRevision > pub.sourceRevision;
  const needsPassword = visibility === "password" && !pub?.hasPassword && password.length < 4;

  async function publish() {
    if (!cloudId) return;
    setBusy(true);
    try {
      const r = await api().publication.publish.mutate({
        catalogId: cloudId, slug, visibility,
        password: visibility === "password" && password ? password : undefined,
        seoTitle: seoTitle || undefined, seoDescription: seoDescription || undefined,
      });
      setStatus(await api().publication.status.query({ catalogId: cloudId }));
      setPassword("");
      toast.success(r.version === 1 ? "Published" : `Updated to version ${r.version}`, r.missingFiles.length ? { description: `Missing files: ${r.missingFiles.join(", ")}` } : undefined);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function unpublish() {
    if (!cloudId || !confirm("Take this catalog offline? The link will stop working.")) return;
    setBusy(true);
    try {
      await api().publication.unpublish.mutate({ catalogId: cloudId });
      setStatus(await api().publication.status.query({ catalogId: cloudId }));
      toast.success("Catalog is offline");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const input = "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring";

  return (
    <dialog ref={ref} onClose={onClose} className="m-auto w-[min(520px,calc(100vw-32px))] overflow-hidden rounded-xl border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50">
      <div className="flex items-center justify-between border-b px-5 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Globe className="size-4" /> Publish as a website</h2>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close"><X /></Button>
      </div>

      {!isPending && !session ? (
        <div className="grid gap-3 p-5 text-sm">
          <p>Publishing puts this catalog online at its own link, so you need an account.</p>
          <p className="text-xs text-muted-foreground">Your catalog stays saved in this browser while you sign in.</p>
          <Link href="/login"><Button>Sign in to publish</Button></Link>
        </div>
      ) : phase === "syncing" ? (
        <p className="flex items-center gap-2 p-5 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Saving the latest version to your cloud…</p>
      ) : phase === "error" ? (
        <p className="p-5 text-sm text-destructive">{error}</p>
      ) : (
        <div className="grid gap-4 p-5">
          {pub && (
            <div className="grid gap-2 border bg-muted/40 p-3 text-xs">
              <div className="flex items-center gap-2">
                <span className="inline-block size-2 rounded-full bg-green-500" />
                <span className="font-medium">Live · version {pub.version}</span>
                <span className="text-muted-foreground">· {pub.views} view{pub.views === 1 ? "" : "s"}</span>
                <span className="ml-auto text-muted-foreground capitalize">{pub.visibility}</span>
              </div>
              <div className="flex items-center gap-1">
                <code className="min-w-0 flex-1 truncate">{url}</code>
                <Button variant="ghost" size="icon-xs" title="Copy link" onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                  {copied ? <Check /> : <Copy />}
                </Button>
                <a href={url} target="_blank" rel="noreferrer" title="Open"><Button variant="ghost" size="icon-xs"><ExternalLink /></Button></a>
              </div>
              {status && status.daily.length > 0 && (
                <div className="grid gap-1">
                  <div className="flex h-8 items-end gap-px" role="img" aria-label={`Views over the last 30 days: ${status.daily.reduce((n, d) => n + d.views, 0)}`}>
                    {status.daily.map((d) => {
                      const max = Math.max(1, ...status.daily.map((x) => x.views));
                      return <div key={d.day} title={`${d.day}: ${d.views}`} className="flex-1 bg-foreground/60" style={{ height: `${Math.max(4, (d.views / max) * 100)}%`, opacity: d.views ? 1 : 0.2 }} />;
                    })}
                  </div>
                  <p className="text-muted-foreground">{status.daily.slice(-7).reduce((n, d) => n + d.views, 0)} views in the last 7 days · {status.daily.reduce((n, d) => n + d.views, 0)} in 30 days</p>
                </div>
              )}
              {hasUnpublished && <p className="text-amber-600 dark:text-amber-400">You have changes that aren’t published yet. Click Update to publish them.</p>}
            </div>
          )}

          <label className="grid gap-1 text-xs">
            <span className="font-medium">Address</span>
            <div className="flex items-center">
              <span className="h-8 shrink-0 border border-r-0 border-input bg-muted px-2 leading-8 text-muted-foreground">/c/</span>
              <input className={input} value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} spellCheck={false} aria-invalid={!slugState.ok} />
            </div>
            <span className={slugState.ok ? "text-muted-foreground" : "text-destructive"}>
              {slugState.checking ? "Checking…" : slugState.ok ? "Available" : slugState.reason}
            </span>
          </label>

          <fieldset className="grid gap-1.5 text-xs">
            <legend className="mb-1 font-medium">Who can see it</legend>
            {VISIBILITY.map((v) => (
              <label key={v.value} className="flex items-start gap-2">
                <input type="radio" name="visibility" checked={visibility === v.value} onChange={() => setVisibility(v.value)} className="mt-0.5" />
                <span><span className="font-medium">{v.label}</span> <span className="text-muted-foreground">— {v.hint}</span></span>
              </label>
            ))}
          </fieldset>

          {visibility === "password" && (
            <label className="grid gap-1 text-xs">
              <span className="font-medium">Password {pub?.hasPassword && <span className="font-normal text-muted-foreground">(leave empty to keep the current one)</span>}</span>
              <input type="password" className={input} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={4} />
            </label>
          )}

          <details className="text-xs">
            <summary className="cursor-pointer font-medium">Search & social preview</summary>
            <div className="mt-2 grid gap-2">
              <input className={input} placeholder={doc.metadata.title} value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} maxLength={120} aria-label="Title" />
              <textarea className={`${input} h-16 py-1`} placeholder={doc.metadata.description ?? "Short description for search results and link previews"} value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)} maxLength={300} aria-label="Description" />
              <p className="text-muted-foreground">The first slide becomes the preview image when the link is shared.</p>
            </div>
          </details>

          <div className="flex items-center justify-between gap-2 border-t pt-4">
            {pub ? <Button variant="ghost" size="sm" disabled={busy} onClick={unpublish}>Unpublish</Button> : <span />}
            <Button disabled={busy || !slugState.ok || slugState.checking || !slug || needsPassword} onClick={publish}>
              {busy ? <Loader2 className="animate-spin" /> : <Globe />} {pub ? "Update" : "Publish"}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">The website shows the version you publish. Later edits stay private until you click Update.</p>
        </div>
      )}
    </dialog>
  );
}
