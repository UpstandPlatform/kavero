"use client";

import {
  IndexedDbCatalogRepository,
  KAVERO_FILE_EXTENSION,
  exportProjectFile,
  importProjectFile,
  type CatalogRepository,
  type CatalogSummary,
} from "@Kavero/local-storage";
import { createFromTemplate, createCatalog, duplicateCatalogWithAssets, type CreateCatalogInput } from "@Kavero/catalog-engine";
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
function notify() {
  for (const l of listeners) l();
  channel?.postMessage("changed");
}
function onChange(l: () => void) {
  if (!channel && typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = () => listeners.forEach((fn) => fn());
  }
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Save with a fresh dashboard thumbnail. */
export async function saveLocalCatalog(doc: CatalogDocument) {
  const summary = await localCatalogs().save(doc, { thumbnail: slideThumbnail(doc) });
  notify();
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
    return onChange(refresh);
  }, [refresh]);

  return { catalogs, error, refresh };
}

export async function createLocalCatalog(input: CreateCatalogInput & { templateId?: string }) {
  const doc = input.templateId && input.templateId !== "blank" ? createFromTemplate(input.templateId, input) : createCatalog(input);
  await saveLocalCatalog(doc);
  return doc;
}

export async function renameLocalCatalog(id: string, title: string) {
  const doc = await localCatalogs().get(id);
  if (!doc) throw new Error("Catalog not found");
  doc.metadata.title = title.trim();
  doc.revision += 1;
  await saveLocalCatalog(doc);
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
  notify();
  return copy;
}

export async function deleteLocalCatalog(id: string) {
  await localCatalogs().delete(id);
  notify();
}

export async function downloadProjectFile(id: string, title: string) {
  const blob = await exportProjectFile(localCatalogs(), id);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "catalog"}${KAVERO_FILE_EXTENSION}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importLocalProject(file: File) {
  const result = await importProjectFile(localCatalogs(), file);
  await saveLocalCatalog(result.document);
  return result;
}
