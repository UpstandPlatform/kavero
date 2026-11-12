import { EXTENSION_CAPABILITIES, type ExtensionCapability, type ExtensionManifest } from "./manifest";

/** The per-catalog installation record stored in the (shared, editable) catalog document. */
export interface InstalledExtension {
  version: string;
  enabled: boolean;
  grantedCapabilities?: readonly string[];
}

export interface EffectiveGrants {
  /** Capabilities the extension may use right now: requested by the document and confirmed by this user. */
  granted: ExtensionCapability[];
  /** Capabilities the document grants but this user has not confirmed on this device. */
  unconfirmed: ExtensionCapability[];
  /** Manifest capabilities that are not effectively granted. */
  missing: ExtensionCapability[];
  /** True when every capability the manifest requires is effectively granted. */
  complete: boolean;
}

const KNOWN = new Set<string>(EXTENSION_CAPABILITIES);

/**
 * The single source of truth for what an extension may do.
 *
 * Catalog documents are shared and writable by every editor, importer and sync client, so a
 * capability listed in `document.extensions[id].grantedCapabilities` is only a *request*.
 * It becomes effective once the current user has confirmed it (`confirmed`, stored per user and
 * catalog outside the document). Verified first-party bundles marked `defaultEnabled` are trusted
 * by the host itself and count as confirmed for their manifest capabilities.
 *
 * Pass `confirmed: undefined` only where no per-user consent exists (for example server tooling);
 * the document grants are then taken at face value.
 */
export function effectiveGrants(
  manifest: Pick<ExtensionManifest, "capabilities" | "defaultEnabled">,
  record: InstalledExtension | null | undefined,
  confirmed: readonly string[] | null | undefined,
): EffectiveGrants {
  const required = manifest.capabilities.filter((capability) => KNOWN.has(capability));
  const trusted = manifest.defaultEnabled === true;
  const requested = record
    ? new Set((record.grantedCapabilities ?? []).filter((capability) => KNOWN.has(capability)))
    : new Set<string>(trusted ? required : []);
  const approved = trusted || confirmed === undefined || confirmed === null
    ? (trusted || !record ? new Set<string>(required) : requested)
    : new Set(confirmed);
  const granted = required.filter((capability) => requested.has(capability) && approved.has(capability));
  const unconfirmed = required.filter((capability) => requested.has(capability) && !approved.has(capability));
  const missing = required.filter((capability) => !granted.includes(capability));
  return { granted, unconfirmed, missing, complete: missing.length === 0 };
}

/** Synchronous key/value storage (localStorage-like). */
export interface GrantStorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ExtensionConsentRecord {
  /** Capabilities this user confirmed for the extension in this catalog. */
  capabilities: string[];
  /** Connected services (MCP connection ids) this user allowed the extension to call. */
  connections: string[];
}

export interface GrantConfirmationStore {
  get(extensionId: string): ExtensionConsentRecord | undefined;
  confirm(extensionId: string, capabilities: readonly string[]): void;
  allowConnection(extensionId: string, connectionId: string): void;
  revoke(extensionId: string): void;
}

const MAX_CONNECTIONS = 64;

/**
 * Per user + catalog record of the capabilities the user actually approved. It lives outside the
 * catalog document (browser storage) so another collaborator, an import or a sync cannot grant
 * access on this user's behalf. Without usable browser storage (server rendering, private mode,
 * blocked storage) it falls back to memory for the current session, which fails closed on reload.
 */
export function createGrantConfirmationStore(scope: { userId: string | null | undefined; catalogId: string }, backend?: GrantStorageBackend | null): GrantConfirmationStore {
  const key = `kavero:extension-consent:v1:${scope.userId ?? "local"}:${scope.catalogId}`;
  let memory: Record<string, ExtensionConsentRecord> | null = null;
  const read = (): Record<string, ExtensionConsentRecord> => {
    if (memory) return memory;
    let parsed: unknown;
    try { parsed = JSON.parse(backend?.getItem(key) ?? "{}"); } catch { parsed = {}; }
    const records: Record<string, ExtensionConsentRecord> = {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (!value || typeof value !== "object") continue;
        const entry = value as { capabilities?: unknown; connections?: unknown };
        records[id] = {
          capabilities: Array.isArray(entry.capabilities) ? entry.capabilities.filter((item): item is string => typeof item === "string" && KNOWN.has(item)) : [],
          connections: Array.isArray(entry.connections) ? entry.connections.filter((item): item is string => typeof item === "string").slice(0, MAX_CONNECTIONS) : [],
        };
      }
    }
    memory = records;
    return records;
  };
  const write = (records: Record<string, ExtensionConsentRecord>) => {
    memory = records;
    try { backend?.setItem(key, JSON.stringify(records)); } catch { /* quota or blocked storage: keep the in-memory copy */ }
  };
  return {
    get: (extensionId) => {
      const record = read()[extensionId];
      return record ? { capabilities: [...record.capabilities], connections: [...record.connections] } : undefined;
    },
    confirm: (extensionId, capabilities) => {
      const records = { ...read() };
      const current = records[extensionId] ?? { capabilities: [], connections: [] };
      records[extensionId] = { ...current, capabilities: [...new Set([...current.capabilities, ...capabilities.filter((item) => KNOWN.has(item))])] };
      write(records);
    },
    allowConnection: (extensionId, connectionId) => {
      const records = { ...read() };
      const current = records[extensionId] ?? { capabilities: [], connections: [] };
      if (current.connections.includes(connectionId)) return;
      records[extensionId] = { ...current, connections: [...current.connections, connectionId].slice(-MAX_CONNECTIONS) };
      write(records);
    },
    revoke: (extensionId) => {
      const records = { ...read() };
      delete records[extensionId];
      write(records);
    },
  };
}
