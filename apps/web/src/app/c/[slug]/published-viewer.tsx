"use client";

import type { CatalogDocument } from "@Kavero/catalog-engine";
import { CatalogFonts, Presentation } from "@Kavero/renderer";
import { useEffect, useState } from "react";

import { builtInExtensionRenderers } from "@/modules/editor/extensions/built-in-renderers";
import { builtInExtensionEffects } from "@/modules/editor/extensions/built-in-effects";
import { loadPublicConfig } from "@/lib/public-config";
import { resolveGiphyMediaUrl } from "@/modules/media/giphy";

/** Client side of the published site: the lightweight player, no editor code. */
export function PublishedViewer({ doc, slug, ownerNote }: { doc: CatalogDocument; slug: string; ownerNote?: string }) {
  const [giphyUrls, setGiphyUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const items = doc.assets.filter((asset) => asset.attribution?.provider === "GIPHY" && asset.attribution.providerAssetId);
    if (!items.length) return;
    const controller = new AbortController();
    void loadPublicConfig()
      .then(({ media: { giphyApiKey: key } }) => (key ? Promise.all(items.map(async (asset) => [asset.id, await resolveGiphyMediaUrl(asset.attribution!.providerAssetId!, key, controller.signal)] as const)) : []))
      .then((resolved) => {
        if (!controller.signal.aborted) setGiphyUrls(Object.fromEntries(resolved.filter((entry): entry is readonly [string, string] => !!entry[1])));
      }).catch(() => undefined);
    return () => controller.abort();
  }, [doc]);
  const resolve = (id: string) => {
    const asset = doc.assets.find((candidate) => candidate.id === id);
    if (asset?.attribution?.provider === "GIPHY") return giphyUrls[id];
    if (asset && /^https:\/\//i.test(asset.uri)) return asset.uri;
    return `/c/${encodeURIComponent(slug)}/assets/${encodeURIComponent(id)}`;
  };
  return (
    <main style={{ position: "fixed", inset: 0, background: "#000" }}>
      <h1 style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{doc.metadata.title}</h1>
      <CatalogFonts doc={doc} resolveAsset={resolve} />
      <Presentation doc={doc} resolveAsset={resolve} extensionRenderers={builtInExtensionRenderers} extensionEffects={builtInExtensionEffects} />
      {ownerNote && (
        <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", padding: "4px 10px", borderRadius: 6, background: "rgba(0,0,0,.7)", color: "#fff", font: "12px system-ui" }}>
          {ownerNote}
        </div>
      )}
    </main>
  );
}
