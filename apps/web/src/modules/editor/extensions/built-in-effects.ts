import type { ExtensionEffectRegistry } from "@Kavero/renderer";
import { auroraFill, prismEffect } from "./shader-studio";

/** Trusted built-in effect renderers used by editors, previews, and published output. */
export const builtInExtensionEffects: ExtensionEffectRegistry = Object.freeze({
  "com.kavero.aurora-fill/aurora-fill": auroraFill.render,
  "com.kavero.prism-glow/prism-glow": prismEffect.render,
});
