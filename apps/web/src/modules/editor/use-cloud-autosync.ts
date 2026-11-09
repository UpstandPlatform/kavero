"use client";

import { useEffect, useRef, useState } from "react";

import { SyncConflictError, pushCatalog } from "@/modules/catalog/cloud-sync";
import { localCatalogs } from "@/modules/catalog/local-catalogs";

import type { SaveStatus } from "./use-catalog-editor";

export type CloudStatus = "none" | "pending" | "syncing" | "synced" | "conflict" | "offline" | "error";

const DELAY_MS = 3000;

/**
 * Keeps an already-linked catalog in sync while editing. Catalogs that were
 * never saved to the cloud stay local; that first upload is always explicit.
 */
export function useCloudAutoSync(catalogId: string, userId: string | null, saveStatus: SaveStatus): CloudStatus {
  const [status, setStatus] = useState<CloudStatus>("none");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!userId) return setStatus("none");
    let cancelled = false;
    localCatalogs().list().then((list) => {
      const s = list.find((x) => x.id === catalogId);
      if (cancelled) return;
      setStatus(s?.cloud && s.cloud.userId === userId ? (s.syncedRevision === s.revision ? "synced" : "pending") : "none");
    });
    return () => {
      cancelled = true;
    };
  }, [catalogId, userId]);

  useEffect(() => {
    if (!userId || saveStatus !== "saved" || status === "none" || status === "conflict") return;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (!navigator.onLine) return setStatus("offline");
      setStatus("syncing");
      try {
        await pushCatalog(catalogId, userId);
        setStatus("synced");
      } catch (e) {
        setStatus(e instanceof SyncConflictError ? "conflict" : "error");
      }
    }, DELAY_MS);
    return () => clearTimeout(timer.current);
    // status is read, not reacted to: re-run only when a local save lands
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveStatus, catalogId, userId]);

  // Retry when the connection comes back.
  useEffect(() => {
    const online = () => setStatus((s) => (s === "offline" ? "pending" : s));
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, []);

  return status;
}

export const CLOUD_LABEL: Record<CloudStatus, string | null> = {
  none: null,
  pending: "Cloud: changes pending",
  syncing: "Cloud: syncing…",
  synced: "Cloud: synced",
  conflict: "Cloud: conflict — resolve on the dashboard",
  offline: "Cloud: offline, will retry",
  error: "Cloud: sync failed",
};
