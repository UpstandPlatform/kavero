"use client";

import { Button } from "@Kavero/ui/components/button";
import { CloudDownload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { keepBoth, listCloudCatalogs, pullCatalog, pushCatalog } from "./cloud-sync";

type CloudList = Awaited<ReturnType<typeof listCloudCatalogs>>;

/** Asks how to resolve a sync conflict. Nothing is overwritten without a choice. */
export function ConflictDialog({ localId, cloudId, title, userId, onClose }: { localId: string; cloudId: string; title: string; userId: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => ref.current?.showModal(), []);

  async function choose(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} onClose={onClose} className="m-auto w-[min(460px,calc(100vw-32px))] border bg-background p-0 text-foreground backdrop:bg-black/50">
      <div className="grid gap-3 p-5">
        <h2 className="text-sm font-semibold">“{title}” changed in two places</h2>
        <p className="text-xs text-muted-foreground">
          The cloud copy was saved from another device or tab after this browser last synced. Choose which version to keep.
        </p>
        <div className="grid gap-2">
          <Button disabled={busy} onClick={() => choose(() => keepBoth(localId, userId), "Kept both versions")}>Keep both (recommended)</Button>
          <Button variant="outline" disabled={busy} onClick={() => choose(() => pushCatalog(localId, userId, { force: true }), "Cloud copy replaced with this browser’s version")}>
            Keep this browser’s version
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => choose(() => pullCatalog(cloudId, userId), "Replaced with the cloud version")}>
            Use the cloud version
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onClose}>Decide later</Button>
        </div>
      </div>
    </dialog>
  );
}

/** Cloud catalogs that aren't in this browser yet. */
export function CloudOnlyList({ userId, localDocumentIds }: { userId: string; localDocumentIds: Set<string> }) {
  const [items, setItems] = useState<CloudList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listCloudCatalogs().then(setItems, (e: Error) => setError(e.message));
  }, []);
  useEffect(refresh, [refresh]);

  const cloudOnly = (items ?? []).filter((c) => !localDocumentIds.has(c.documentId));
  if (error) return <p className="mt-8 text-xs text-destructive">Couldn’t load cloud catalogs: {error}</p>;
  if (!cloudOnly.length) return null;

  return (
    <section className="mt-10">
      <h2 className="mb-3 text-sm font-semibold">In your cloud, not in this browser</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cloudOnly.map((c) => (
          <div key={c.id} className="flex flex-col border border-dashed bg-card">
            <div className="aspect-[4/3] overflow-hidden bg-muted p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {c.thumbnail && <img src={c.thumbnail} alt="" className="mx-auto h-full w-auto object-contain opacity-80" />}
            </div>
            <div className="flex items-center gap-2 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{c.title}</p>
                <p className="text-xs text-muted-foreground">{c.slideCount} slides · cloud revision {c.revision}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={busy === c.id}
                onClick={async () => {
                  setBusy(c.id);
                  try {
                    await pullCatalog(c.id, userId);
                    toast.success(`Downloaded “${c.title}”`);
                    refresh();
                  } catch (e) {
                    toast.error((e as Error).message);
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                <CloudDownload /> {busy === c.id ? "Downloading…" : "Download"}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
