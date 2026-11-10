/**
 * Player for single-file HTML exports. Bundled by scripts/build-player.ts into
 * public/kavero-player.js and inlined into the exported page, which also carries
 * the catalog and its assets as JSON. No network or server needed.
 */
import type { CatalogDocument } from "@Kavero/catalog-engine";
import { CatalogFonts, Presentation } from "@Kavero/renderer";
import { createRoot } from "react-dom/client";

import { builtInExtensionRenderers } from "../modules/editor/extensions/built-in-renderers";

interface ExportData {
  doc: CatalogDocument;
  assets: Record<string, string>;
}

const source = document.getElementById("kavero-data");
const root = document.getElementById("kavero");
if (source?.textContent && root) {
  const { doc, assets } = JSON.parse(source.textContent) as ExportData;
  const resolveAsset = (id: string) => assets[id];
  createRoot(root).render(
    <>
      <CatalogFonts doc={doc} resolveAsset={resolveAsset} />
      <Presentation doc={doc} resolveAsset={resolveAsset} extensionRenderers={builtInExtensionRenderers} />
    </>,
  );
}
