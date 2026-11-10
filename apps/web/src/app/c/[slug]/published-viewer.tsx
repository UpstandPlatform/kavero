"use client";

import type { CatalogDocument } from "@Kavero/catalog-engine";
import { CatalogFonts, Presentation } from "@Kavero/renderer";

import { builtInExtensionRenderers } from "@/modules/editor/extensions/built-in-renderers";

/** Client side of the published site: the lightweight player, no editor code. */
export function PublishedViewer({ doc, slug, ownerNote }: { doc: CatalogDocument; slug: string; ownerNote?: string }) {
  const resolve = (id: string) => `/c/${encodeURIComponent(slug)}/assets/${encodeURIComponent(id)}`;
  return (
    <main style={{ position: "fixed", inset: 0, background: "#000" }}>
      <h1 style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{doc.metadata.title}</h1>
      <CatalogFonts doc={doc} resolveAsset={resolve} />
      <Presentation doc={doc} resolveAsset={resolve} extensionRenderers={builtInExtensionRenderers} />
      {ownerNote && (
        <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", padding: "4px 10px", borderRadius: 6, background: "rgba(0,0,0,.7)", color: "#fff", font: "12px system-ui" }}>
          {ownerNote}
        </div>
      )}
    </main>
  );
}
