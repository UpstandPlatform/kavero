"use client";

import { hasUnsyncedChanges } from "@Kavero/local-storage";
import { useEffect, useRef, useState } from "react";

import { SyncConflictError, pushCatalog } from "@/modules/catalog/cloud-sync";
import { localCatalogs, onCatalogsChanged } from "@/modules/catalog/local-catalogs";

import type { SaveStatus } from "./use-catalog-editor";

export type CloudStatus = "none" | "pending" | "syncing" | "synced" | "conflict" | "offline" | "error";

const DELAY_MS = 3000;

/**
 * Keeps an already-linked catalog in sync while editing. Catalogs that were
 * never saved to the cloud stay local; that first upload is always explicit.
 */
export function useCloudAutoSync(catalogId: string, userId: string | null, saveStatus: SaveStatus): CloudStatus {
  const [status, setStatus] = useState<CloudStatus>("none");
  // Bumped to push without a new local save (newly linked, back online).
  const [kick, setKick] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  });

  // Follow the link status, including a first upload (e.g. Publish) or a conflict resolved elsewhere.
  useEffect(() => {
    if (!userId) return setStatus("none");
    let cancelled = false;
    const derive = () =>
      void localCatalogs().getSummary(catalogId).then((s) => {
        if (cancelled) return;
        const linked = !!s?.cloud && s.cloud.userId === userId;
        const unsynced = !!s && hasUnsyncedChanges(s);
        const cur = statusRef.current;
        if (!linked) return setStatus("none");
        // Leave in-flight states alone; the running push reports its own result.
        if (cur !== "none" && cur !== "conflict" && cur !== "error") return;
        if (!unsynced) return setStatus("synced");
        if (cur === "none") {
          setStatus("pending");
          setKick((k) => k + 1);
        }
      }, () => undefined);
    derive();
    const off = onCatalogsChanged(derive);
    return () => {
      cancelled = true;
      off();
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
    // status is read, not reacted to: re-run only when a local save lands or a push is kicked
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveStatus, catalogId, userId, kick]);

  // Retry when the connection comes back.
  useEffect(() => {
    const online = () => {
      const s = statusRef.current;
      if (s !== "offline" && s !== "pending" && s !== "error") return;
      setStatus("pending");
      setKick((k) => k + 1);
    };
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
