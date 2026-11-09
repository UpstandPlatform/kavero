"use client";

import {
  IndexedDbCatalogRepository,
  KAVERO_FILE_EXTENSION,
  exportProjectFile,
  importProjectFile,
  type CatalogRepository,
  type CatalogSummary,
  type DocVersion,
  versionOf,
} from "@Kavero/local-storage";
import { createFromTemplate, createCatalog, duplicateCatalogWithAssets, safeFileName, type CreateCatalogInput } from "@Kavero/catalog-engine";
import { useCallback, useEffect, useState } from "react";
import type { CatalogDocument } from "@Kavero/catalog-engine";
import { slideThumbnail } from "./thumbnail";

let repo: CatalogRepository | null = null;

/** One IndexedDB connection per tab. */
export function localCatalogs(): CatalogRepository {
  repo ??= new IndexedDbCatalogRepository();
  return repo;
}

// Lets every list on the page refresh after a change, including in other tabs.
const CHANNEL = "kavero-catalogs";
const listeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;
export function notifyCatalogsChanged() {
  for (const l of listeners) l();
  channel?.postMessage("changed");
}
/** Subscribe to catalog changes made in this tab or any other. */
export function onCatalogsChanged(l: () => void) {
  if (!channel && typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = () => listeners.forEach((fn) => fn());
  }
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Save with a fresh dashboard thumbnail. `expect` makes it a compare-and-swap (see CatalogRepository.save). */
export async function saveLocalCatalog(doc: CatalogDocument, opts: { expect?: DocVersion } = {}) {
  const summary = await localCatalogs().save(doc, { thumbnail: slideThumbnail(doc), expect: opts.expect });
  notifyCatalogsChanged();
  return summary;
}

export function useLocalCatalogs() {
  const [catalogs, setCatalogs] = useState<CatalogSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    localCatalogs()
      .list()
      .then((list) => {
        setCatalogs(list);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    refresh();
    return onCatalogsChanged(refresh);
  }, [refresh]);

  return { catalogs, error, refresh };
}

export async function createLocalCatalog(input: CreateCatalogInput & { templateId?: string }) {
  const doc = input.templateId && input.templateId !== "blank" ? createFromTemplate(input.templateId, input) : createCatalog(input);
  await saveLocalCatalog(doc);
  return doc;
}

export async function renameLocalCatalog(id: string, title: string) {
  const entry = await localCatalogs().getWithSummary(id);
  if (!entry) throw new Error("Catalog not found");
  const { document: doc, summary } = entry;
  doc.metadata.title = title.trim();
  doc.revision += 1;
  // Compare-and-swap, so a rename never overwrites an editor's save that landed in between.
  await saveLocalCatalog(doc, { expect: versionOf(summary) });
}

export async function duplicateLocalCatalog(id: string) {
  const r = localCatalogs();
  const doc = await r.get(id);
  if (!doc) throw new Error("Catalog not found");
  const { document: copy, assetIdMap } = duplicateCatalogWithAssets(doc);
  await r.save(copy, { thumbnail: slideThumbnail(copy) });
  for (const asset of await r.listAssets(id)) {
    await r.putAsset({ ...asset, id: assetIdMap.get(asset.id) ?? asset.id, catalogId: copy.id });
  }
  notifyCatalogsChanged();
  return copy;
}

export async function deleteLocalCatalog(id: string) {
  await localCatalogs().delete(id);
  notifyCatalogsChanged();
}

export async function downloadProjectFile(id: string, title: string) {
  const blob = await exportProjectFile(localCatalogs(), id);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = safeFileName(title, KAVERO_FILE_EXTENSION);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importLocalProject(file: File) {
  const result = await importProjectFile(localCatalogs(), file);
  await saveLocalCatalog(result.document);
  return result;
}
