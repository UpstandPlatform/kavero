"use client";

import { duplicateCatalogWithAssets } from "@Kavero/catalog-engine";
import { TRPCClientError } from "@trpc/client";

import { makeTRPCClient } from "@/utils/trpc";

import { localCatalogs, notifyCatalogsChanged, saveLocalCatalog } from "./local-catalogs";

let client: ReturnType<typeof makeTRPCClient> | null = null;
const api = () => (client ??= makeTRPCClient());

export class SyncConflictError extends Error {
  constructor(public readonly catalogId: string, public readonly serverRevision?: number) {
    super("The cloud copy was changed somewhere else since your last sync.");
  }
}

export type PushResult = { status: "synced"; revision: number; uploaded: number } | { status: "unchanged" };

/**
 * Push a local catalog to the signed-in user's cloud.
 * First push creates the cloud copy; later pushes send the cloud revision they
 * are based on, and the server refuses with a conflict if it moved on.
 */
export async function pushCatalog(localId: string, userId: string, opts: { force?: boolean; workspaceId?: string | null } = {}): Promise<PushResult> {
  const repo = localCatalogs();
  const doc = await repo.get(localId);
  if (!doc) throw new Error("Catalog not found");
  const summary = (await repo.list()).find((s) => s.id === localId);
  const link = summary?.cloud;
  if (link && link.userId !== userId) {
    throw new Error("This catalog is linked to a different account. Duplicate it to save a copy to this account.");
  }
  if (link && !opts.force && summary?.syncedRevision === doc.revision) return { status: "unchanged" };

  let baseRevision = link?.revision;
  if (opts.force && link) {
    // "Keep mine": overwrite the cloud copy, based on whatever it has now.
    baseRevision = (await api().catalog.get.query({ id: link.id })).revision;
  }

  let res;
  try {
    res = await api().catalog.save.mutate({ document: doc, baseRevision, thumbnail: summary?.thumbnail, workspaceId: link ? undefined : opts.workspaceId });
  } catch (e) {
    if (e instanceof TRPCClientError && e.data?.code === "CONFLICT") throw new SyncConflictError(localId);
    if (e instanceof TRPCClientError && e.data?.code === "FORBIDDEN") throw new Error(`${e.message}. Your changes are kept in this browser.`);
    if (e instanceof TRPCClientError && e.data?.code === "NOT_FOUND" && link) {
      // The cloud copy was deleted: unlink so the next push creates a fresh one.
      await repo.setCloudLink(localId, null);
      notifyCatalogsChanged();
      throw new Error("The cloud copy was deleted. Save to cloud again to re-upload it.");
    }
    throw e;
  }

  // Upload only the files the server is missing.
  for (const assetId of res.missingAssetIds) {
    const stored = await repo.getAsset(assetId);
    const meta = doc.assets.find((a) => a.id === assetId);
    if (!stored || !meta) continue;
    const put = await fetch(`/api/catalogs/${res.id}/assets/${encodeURIComponent(assetId)}`, {
      method: "PUT",
      headers: { "Content-Type": meta.mimeType },
      body: stored.blob,
      credentials: "include",
    });
    if (!put.ok) throw new Error(`Uploading ${meta.name} failed: ${(await put.json().catch(() => null))?.error ?? put.status}`);
  }

  await repo.setCloudLink(localId, { id: res.id, revision: res.revision, userId, syncedAt: Date.now() }, doc.revision);
  notifyCatalogsChanged();
  return { status: "synced", revision: res.revision, uploaded: res.missingAssetIds.length };
}

/** Download a cloud catalog into this browser, replacing the local copy if there is one. */
export async function pullCatalog(cloudId: string, userId: string): Promise<string> {
  const repo = localCatalogs();
  const { id, revision, document } = await api().catalog.get.query({ id: cloudId });
  for (const a of document.assets) {
    const res = await fetch(`/api/catalogs/${id}/assets/${encodeURIComponent(a.id)}`, { credentials: "include" });
    if (!res.ok) continue; // missing files show as placeholders; the document is still usable
    const blob = await res.blob();
    await repo.putAsset({ id: a.id, catalogId: document.id, blob: new Blob([blob], { type: a.mimeType }), hash: a.hash ?? "" });
  }
  await saveLocalCatalog(document);
  await repo.setCloudLink(document.id, { id, revision, userId, syncedAt: Date.now() }, document.revision);
  notifyCatalogsChanged();
  return document.id;
}

/** "Keep both": move local edits into a new, unlinked local catalog, then pull the cloud version. */
export async function keepBoth(localId: string, userId: string): Promise<string> {
  const repo = localCatalogs();
  const doc = await repo.get(localId);
  const summary = (await repo.list()).find((s) => s.id === localId);
  if (!doc || !summary?.cloud) throw new Error("Catalog not found");
  const { document: copy, assetIdMap } = duplicateCatalogWithAssets(doc, `${doc.metadata.title} (my version)`);
  await saveLocalCatalog(copy);
  for (const asset of await repo.listAssets(localId)) {
    await repo.putAsset({ ...asset, id: assetIdMap.get(asset.id) ?? asset.id, catalogId: copy.id });
  }
  await pullCatalog(summary.cloud.id, userId);
  return copy.id;
}

export async function deleteCloudCopy(localId: string) {
  const repo = localCatalogs();
  const summary = (await repo.list()).find((s) => s.id === localId);
  if (!summary?.cloud) return;
  await api().catalog.delete.mutate({ id: summary.cloud.id });
  await repo.setCloudLink(localId, null);
  notifyCatalogsChanged();
}

export async function listCloudCatalogs() {
  return api().catalog.list.query();
}

export type RefreshResult = "pulled" | "current" | "conflict" | "unlinked" | "offline";

/**
 * Bring a linked local catalog up to date when the cloud copy moved ahead
 * (e.g. an AI agent edited it over MCP). Only pulls when there are no local
 * edits waiting; otherwise reports a conflict for the user to resolve.
 */
export async function refreshFromCloud(localId: string, userId: string, cloudRevision?: number): Promise<RefreshResult> {
  const summary = (await localCatalogs().list()).find((s) => s.id === localId);
  const link = summary?.cloud;
  if (!summary || !link || link.userId !== userId) return "unlinked";
  let latest = cloudRevision;
  if (latest === undefined) {
    try {
      latest = (await api().catalog.list.query()).find((c) => c.id === link.id)?.revision;
    } catch {
      return "offline";
    }
  }
  if (latest === undefined || latest <= link.revision) return "current";
  if (summary.syncedRevision !== summary.revision) return "conflict";
  await pullCatalog(link.id, userId);
  return "pulled";
}

export async function listWorkspaces() {
  return api().workspace.list.query();
}
