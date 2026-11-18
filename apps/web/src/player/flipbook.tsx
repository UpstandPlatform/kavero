/**
 * Player for the standalone flipbook export. Bundled by scripts/build-player.ts
 * into public/kavero-flipbook.js and shipped inside the exported .zip with the
 * catalog data and assets. No network or server needed.
 */
import type { CatalogDocument } from "@Kavero/catalog-engine";
import { CatalogFonts, Flipbook } from "@Kavero/renderer";
import { createRoot } from "react-dom/client";

import { builtInExtensionRenderers } from "../modules/editor/extensions/built-in-renderers";
import { builtInExtensionEffects } from "../modules/editor/extensions/built-in-effects";

interface ExportData {
  doc: CatalogDocument;
  /** assetId → relative path inside the zip (e.g. "./assets/ast_x.png"). */
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
      <Flipbook doc={doc} resolveAsset={resolveAsset} extensionRenderers={builtInExtensionRenderers} extensionEffects={builtInExtensionEffects} />
    </>,
  );
}
