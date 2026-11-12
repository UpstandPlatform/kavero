"use client";

import { useEffect, useState } from "react";

export interface PublicConfig {
  edition: "desktop" | "self-hosted" | "cloud";
  media: { openverseEnabled: boolean; giphyApiKey: string };
}

/** Build-time values, used until (or if) the server's runtime settings load. */
const FALLBACK: PublicConfig = {
  edition: "self-hosted",
  media: {
    openverseEnabled: process.env.NEXT_PUBLIC_OPENVERSE_ENABLED?.trim().toLowerCase() === "true",
    giphyApiKey: process.env.NEXT_PUBLIC_GIPHY_API_KEY?.trim() ?? "",
  },
};

let pending: Promise<PublicConfig> | null = null;
let loaded: PublicConfig | null = null;

/** Runtime settings from Admin → System that the browser needs (fetched once per page load). */
export function loadPublicConfig(): Promise<PublicConfig> {
  pending ??= fetch("/api/public-config", { credentials: "omit" })
    .then((r) => (r.ok ? (r.json() as Promise<PublicConfig>) : FALLBACK))
    .catch(() => FALLBACK)
    .then((c) => (loaded = c));
  return pending;
}

export function usePublicConfig(): PublicConfig {
  const [config, setConfig] = useState<PublicConfig>(loaded ?? FALLBACK);
  useEffect(() => {
    let live = true;
    void loadPublicConfig().then((c) => live && setConfig(c));
    return () => {
      live = false;
    };
  }, []);
  return config;
}
