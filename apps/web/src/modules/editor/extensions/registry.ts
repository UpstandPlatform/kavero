import { ExtensionHost } from "@Kavero/extensions";
import { productsExtension } from "./products";
import { auroraFillExtension, prismGlowExtension } from "./shader-studio";
import { slideInsightsExtension } from "./slide-insights";
import { connectedToolsExtension } from "./connected-tools";
import { validateEditorExtensionContribution, type EditorExtensionContext, type EditorExtensionContribution, type EditorExtensionHooks } from "./types";
import { builtInExtensionRenderers } from "./built-in-renderers";
import { builtInExtensionEffects } from "./built-in-effects";

/** Bundled extensions are explicitly registered here; downloaded code is never evaluated by this registry. */
export function createEditorExtensionHost() {
  const host = new ExtensionHost<EditorExtensionContext, EditorExtensionContribution, import("@Kavero/extensions").ExtensionEvents, EditorExtensionHooks>({
    onError: (error, source) => console.error(`[extension:${source}]`, error),
    validateContribution: validateEditorExtensionContribution,
    hookCapabilities: { "catalog.export.prepare": ["catalog.read", "catalog.write"] },
  });
  host.register(productsExtension);
  host.register(slideInsightsExtension);
  host.register(auroraFillExtension);
  host.register(prismGlowExtension);
  host.register(connectedToolsExtension);
  return host;
}

/** Trusted renderers are also loaded for server exports and published documents. */
export { builtInExtensionRenderers };
export { builtInExtensionEffects };
