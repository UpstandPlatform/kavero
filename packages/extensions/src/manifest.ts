import { z } from "zod";

export const EXTENSION_API_VERSION = "1.0.0";

/** Capabilities are explicit so the host can show and grant only needed access. */
export const EXTENSION_CAPABILITIES = [
  "catalog.read",
  "catalog.write",
  "catalog.storage",
  "editor.ui",
  "editor.render",
  "assets.read",
  "assets.write",
  "network.fetch",
  "ai.invoke",
  "integrations.call",
  "extension.messaging",
] as const;

export type ExtensionCapability = (typeof EXTENSION_CAPABILITIES)[number];

export const EXTENSION_TYPES = ["plugin", "widget", "shader-effect", "shader-fill", "integration"] as const;
export type ExtensionType = (typeof EXTENSION_TYPES)[number];

const httpsUrl = z.string().url().refine((value) => value.startsWith("https://"), "Use an HTTPS URL.");
export const extensionIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;
export const extensionManifestSchema = z.object({
  id: z.string().min(3).max(128).regex(extensionIdPattern),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  version: z.string().max(80).regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  apiVersion: z.string().max(80).regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  publisher: z.object({
    id: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/),
    name: z.string().trim().min(1).max(100),
    url: httpsUrl.optional(),
  }).strict(),
  capabilities: z.array(z.enum(EXTENSION_CAPABILITIES)).max(EXTENSION_CAPABILITIES.length).refine((values) => new Set(values).size === values.length),
  types: z.array(z.enum(EXTENSION_TYPES)).min(1).max(EXTENSION_TYPES.length).refine((values) => new Set(values).size === values.length).default(["plugin"]),
  hooks: z.array(z.string().trim().min(1).max(80).regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/)).max(32).refine((values) => new Set(values).size === values.length).optional(),
  defaultEnabled: z.boolean().optional(),
  categories: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  homepage: httpsUrl.optional(),
  repository: httpsUrl.optional(),
  license: z.string().trim().min(1).max(64).optional(),
}).strict();

export interface ExtensionManifest {
  /** Reverse-domain publisher id, e.g. `com.kavero.products`. */
  id: string;
  name: string;
  description: string;
  version: string;
  apiVersion: string;
  publisher: { id: string; name: string; url?: string };
  /** Capabilities requested by the plugin. The host must grant each one. */
  capabilities: readonly ExtensionCapability[];
  /** Store surfaces and editor APIs this extension contributes. Defaults to a traditional plugin. */
  types?: readonly ExtensionType[];
  /** Host hooks this extension may register. Each hook can also require host-configured capabilities. */
  hooks?: readonly string[];
  /** Verified first-party bundles may be installed by default. */
  defaultEnabled?: boolean;
  /** Stable categories help store search and discovery. */
  categories?: readonly string[];
  homepage?: string;
  repository?: string;
  license?: string;
}

export class ExtensionManifestError extends Error {
  override name = "ExtensionManifestError";
}

export function validateExtensionManifest(manifest: ExtensionManifest, hostApiVersion = EXTENSION_API_VERSION): void {
  const result = extensionManifestSchema.safeParse(manifest);
  if (!result.success) throw new ExtensionManifestError(`Invalid extension manifest: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  if (major(manifest.apiVersion) !== major(hostApiVersion)) {
    throw new ExtensionManifestError(`Extension "${manifest.id}" targets host API ${manifest.apiVersion}; this host supports ${hostApiVersion}.`);
  }
}

function major(version: string) {
  return Number.parseInt(version.split(".")[0] ?? "", 10);
}
