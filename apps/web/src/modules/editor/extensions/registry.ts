import { parseCatalogDocument } from "@Kavero/catalog-engine";
import { ExtensionHost } from "@Kavero/extensions";
import { productsExtension } from "./products";
import { auroraFillExtension, prismGlowExtension } from "./shader-studio";
import { slideInsightsExtension } from "./slide-insights";
import { connectedToolsExtension } from "./connected-tools";
import { lucideIconsExtension } from "./lucide-icons";
import { validateEditorExtensionContribution, type EditorExtensionContext, type EditorExtensionContribution, type EditorExtensionHooks } from "./types";
import { builtInExtensionRenderers } from "./built-in-renderers";
import { builtInExtensionEffects } from "./built-in-effects";

/** Bundled extensions are explicitly registered here; downloaded code is never evaluated by this registry. */
export function createEditorExtensionHost(options: {
  /** Capabilities the signed-in user confirmed for this catalog; see `effectiveGrants`. */
  confirmedGrants?: (extensionId: string) => readonly string[] | undefined;
} = {}) {
  const host = new ExtensionHost<EditorExtensionContext, EditorExtensionContribution, import("@Kavero/extensions").ExtensionEvents, EditorExtensionHooks>({
    onError: (error, source) => console.error(`[extension:${source}]`, error),
    validateContribution: validateEditorExtensionContribution,
    hookCapabilities: { "catalog.export.prepare": ["catalog.read", "catalog.write"] },
    confirmedGrants: options.confirmedGrants,
    hookTimeoutMs: 15_000,
    // A handler that breaks the payload is skipped instead of failing the whole export.
    validateHook: (hook, value) => hook !== "catalog.export.prepare" || isExportPreparation(value),
  });
  host.register(productsExtension);
  host.register(slideInsightsExtension);
  host.register(auroraFillExtension);
  host.register(prismGlowExtension);
  host.register(connectedToolsExtension);
  host.register(lucideIconsExtension);
  return host;
}

function isExportPreparation(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const { document, format } = value as { document?: unknown; format?: unknown };
  return typeof format === "string" && parseCatalogDocument(document).ok;
}

/** Trusted renderers are also loaded for server exports and published documents. */
export { builtInExtensionRenderers };
export { builtInExtensionEffects };
