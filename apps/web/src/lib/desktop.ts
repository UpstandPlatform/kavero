"use client";

import { useEffect, useState } from "react";

/** State of the desktop app's updater (see apps/desktop/src/updater.ts). */
export type UpdateStatus =
  | { state: "idle" | "checking" | "not-available" }
  | { state: "available"; version: string; notes?: string; releaseUrl: string }
  | { state: "downloading"; version: string; percent: number; releaseUrl: string }
  | { state: "downloaded"; version: string; releaseUrl: string }
  | { state: "error"; message: string; releaseUrl?: string };

/** What the Electron preload exposes as `window.kaveroDesktop`. Absent in a normal browser. */
export interface KaveroDesktop {
  version: string;
  platform: string;
  /** The app's own built-in server with one automatic local account: no sign-in screens. */
  localMode: boolean;
  updates?: {
    status(): Promise<UpdateStatus>;
    onStatus(listener: (status: UpdateStatus) => void): () => void;
    check(): Promise<void>;
    download(): Promise<void>;
    install(): Promise<void>;
  };
}

export function getDesktop(): KaveroDesktop | null {
  if (typeof window === "undefined") return null;
  return (window as { kaveroDesktop?: KaveroDesktop }).kaveroDesktop ?? null;
}

/** The desktop bridge, after hydration (null in browsers and during server rendering). */
export function useDesktop(): KaveroDesktop | null {
  const [desktop, setDesktop] = useState<KaveroDesktop | null>(null);
  useEffect(() => setDesktop(getDesktop()), []);
  return desktop;
}

/** True inside the desktop app running its own local server (automatic account). */
export function useLocalMode(): boolean {
  return useDesktop()?.localMode === true;
}
