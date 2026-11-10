import { ExtensionEventBus, type ExtensionEvents } from "./events";
import { ExtensionHookRegistry } from "./hooks";
import {
  EXTENSION_API_VERSION,
  EXTENSION_CAPABILITIES,
  extensionManifestSchema,
  validateExtensionManifest,
  type ExtensionCapability,
  type ExtensionManifest,
} from "./manifest";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type ExtensionCleanup = () => void | Promise<void>;

export interface ExtensionEventAccess<Events extends object> {
  on<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): () => void;
  once<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): () => void;
  publish(topic: string, payload: JsonValue): void;
  subscribe<T extends JsonValue = JsonValue>(extensionId: string, topic: string, listener: (payload: T) => void): () => void;
}

export interface ExtensionHookAccess<Hooks extends Record<string, unknown> = Record<string, unknown>> {
  /** Register a handler for a host-defined hook. The registration is removed when the extension is deactivated. */
  register<K extends keyof Hooks>(name: K, handler: (payload: Hooks[K]) => Hooks[K] | void | Promise<Hooks[K] | void>, priority?: number): () => void;
}

export interface ExtensionStorage {
  data: ExtensionStorageArea;
  settings: ExtensionStorageArea;
}

export interface ExtensionStorageArea {
  get<T extends JsonValue = JsonValue>(key: string): T | undefined;
  set(key: string, value: JsonValue): void | Promise<void>;
  delete(key: string): void | Promise<void>;
}

export interface ExtensionRuntimeServices<Events extends object = ExtensionEvents, Hooks extends Record<string, unknown> = Record<string, unknown>> {
  events: ExtensionEventAccess<Events>;
  hooks: ExtensionHookAccess<Hooks>;
  storage: ExtensionStorage;
  hasCapability(capability: ExtensionCapability): boolean;
  requireCapability(capability: ExtensionCapability): void;
}

export interface ExtensionActivationContext<Context = unknown, Events extends object = ExtensionEvents, Hooks extends Record<string, unknown> = Record<string, unknown>> {
  context: Context;
  services: ExtensionRuntimeServices<Events, Hooks>;
}

export interface ExtensionDefinition<Context = unknown, Contribution = unknown, Events extends object = ExtensionEvents, Hooks extends Record<string, unknown> = Record<string, unknown>> {
  manifest: ExtensionManifest;
  contribute?: (context: Context) => Contribution;
  /** Pure, synchronous migrations keyed by their source extension version. */
  migrations?: Record<string, { toVersion: string; migrate: (state: ExtensionMigrationState) => ExtensionMigrationState }>;
  activate?: (context: ExtensionActivationContext<Context, Events, Hooks>) => void | ExtensionCleanup | Promise<void | ExtensionCleanup>;
}

export interface ExtensionMigrationState {
  settings: Record<string, JsonValue>;
  data: Record<string, JsonValue>;
}

export interface InstalledExtension {
  version: string;
  enabled: boolean;
  grantedCapabilities?: readonly string[];
}

export interface ContributedExtension<Context, Contribution, Events extends object = ExtensionEvents, Hooks extends Record<string, unknown> = Record<string, unknown>> {
  definition: ExtensionDefinition<Context, Contribution, Events, Hooks>;
  contribution: Contribution;
}

export class ExtensionHost<Context = unknown, Contribution = unknown, Events extends object = ExtensionEvents, Hooks extends Record<string, unknown> = Record<string, unknown>> {
  readonly events: ExtensionEventBus<Events>;
  readonly hooks: ExtensionHookRegistry<Hooks>;
  private readonly definitions = new Map<string, ExtensionDefinition<Context, Contribution, Events, Hooks>>();
  private readonly activations = new Map<string, ExtensionCleanup>();
  private readonly contributionFailures = new Set<string>();
  private readonly reportError: (error: unknown, source: string) => void;
  private readonly extensionListeners = new Map<string, Set<(payload: JsonValue) => void>>();
  private readonly validateContribution?: (manifest: ExtensionManifest, contribution: Contribution) => void;
  private readonly hookCapabilities: Partial<Record<keyof Hooks, readonly ExtensionCapability[]>>;

  constructor(options: {
    apiVersion?: string;
    onError?: (error: unknown, source: string) => void;
    validateContribution?: (manifest: ExtensionManifest, contribution: Contribution) => void;
    hookCapabilities?: Partial<Record<keyof Hooks, readonly ExtensionCapability[]>>;
  } = {}) {
    this.reportError = (error, source) => {
      try { options.onError?.(error, source); } catch { /* diagnostics must not break the editor */ }
    };
    this.events = new ExtensionEventBus((error, event) => this.reportError(error, `event:${String(event)}`));
    this.hooks = new ExtensionHookRegistry<Hooks>();
    this.validateContribution = options.validateContribution;
    this.hookCapabilities = options.hookCapabilities ?? {};
    this.apiVersion = options.apiVersion ?? EXTENSION_API_VERSION;
  }

  private readonly apiVersion: string;

  register(definition: ExtensionDefinition<Context, Contribution, Events, Hooks>): () => Promise<void> {
    const manifest = extensionManifestSchema.parse(definition.manifest);
    validateExtensionManifest(manifest, this.apiVersion);
    if (this.definitions.has(manifest.id)) throw new Error(`Extension "${manifest.id}" is already registered.`);
    const frozenManifest = Object.freeze({
      ...manifest,
      publisher: Object.freeze({ ...manifest.publisher }),
      capabilities: Object.freeze([...manifest.capabilities]),
      types: Object.freeze([...manifest.types]),
      categories: manifest.categories ? Object.freeze([...manifest.categories]) : undefined,
    });
    const migrations = definition.migrations ? Object.freeze({ ...definition.migrations }) : undefined;
    for (const [fromVersion, migration] of Object.entries(migrations ?? {})) {
      if (!isSemver(fromVersion) || !isSemver(migration.toVersion) || compareSemver(fromVersion, migration.toVersion) >= 0) {
        throw new Error(`Extension "${manifest.id}" has an invalid migration from ${fromVersion}.`);
      }
    }
    this.definitions.set(manifest.id, { ...definition, manifest: frozenManifest, migrations });
    return async () => {
      await this.deactivate(manifest.id);
      this.definitions.delete(manifest.id);
      this.contributionFailures.delete(manifest.id);
    };
  }

  get(id: string) {
    return this.definitions.get(id);
  }

  list() {
    return [...this.definitions.values()].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  }

  isEnabled(id: string, installed: Record<string, InstalledExtension> | null | undefined = {}): boolean {
    const definition = this.definitions.get(id);
    if (!definition) return false;
    const record = installed?.[id];
    if (!record) return definition.manifest.defaultEnabled === true;
    if (record.version !== definition.manifest.version || !record.enabled) return false;
    const grants = record.grantedCapabilities ?? [];
    return definition.manifest.capabilities.every((capability) => grants.includes(capability));
  }

  canMigrate(id: string, storedVersion: string): boolean {
    const definition = this.definitions.get(id);
    if (!definition || !isSemver(storedVersion)) return false;
    const targetVersion = definition.manifest.version;
    let version = storedVersion;
    for (let i = 0; i < 32 && version !== targetVersion; i += 1) {
      const migration = definition.migrations?.[version];
      if (!migration || compareSemver(migration.toVersion, version) <= 0 || compareSemver(migration.toVersion, targetVersion) > 0) return false;
      version = migration.toVersion;
    }
    return version === targetVersion;
  }

  migrateState(id: string, stored: ExtensionInstalledState): ExtensionInstalledState {
    const definition = this.definitions.get(id);
    if (!definition) throw new Error(`Extension "${id}" is not registered by this host.`);
    if (!this.canMigrate(id, stored.version)) throw new Error(`No safe upgrade path is registered for extension "${id}" version ${stored.version}.`);
    let state: ExtensionInstalledState = structuredClone(stored);
    for (let i = 0; i < 32 && state.version !== definition.manifest.version; i += 1) {
      const migration = definition.migrations?.[state.version];
      if (!migration) throw new Error(`Missing extension migration from ${state.version}.`);
      const migrated = migration.migrate({ settings: structuredClone(state.settings), data: structuredClone(state.data) });
      if (!isJsonMap(migrated.settings) || !isJsonMap(migrated.data)) throw new Error(`Extension "${id}" migration produced invalid stored data.`);
      state = { ...state, version: migration.toVersion, settings: structuredClone(migrated.settings), data: structuredClone(migrated.data) };
    }
    return state;
  }

  contribute<ContributionContext = Context>(
    context: ContributionContext,
    installed: Record<string, InstalledExtension> | null | undefined = {},
    scopeContext?: (definition: ExtensionDefinition<Context, Contribution, Events, Hooks>, context: ContributionContext) => Context,
  ): ContributedExtension<Context, Contribution, Events, Hooks>[] {
    const contributions: ContributedExtension<Context, Contribution, Events, Hooks>[] = [];
    for (const definition of this.list()) {
      if (!this.isEnabled(definition.manifest.id, installed)
        || !(definition.manifest.capabilities.includes("editor.ui") || definition.manifest.capabilities.includes("editor.render"))
        || !definition.contribute) continue;
      try {
        const extensionContext = scopeContext ? scopeContext(definition, context) : context as unknown as Context;
        const contribution = definition.contribute(extensionContext);
        this.validateContribution?.(definition.manifest, contribution);
        this.contributionFailures.delete(definition.manifest.id);
        contributions.push({ definition, contribution });
      } catch (error) {
        if (!this.contributionFailures.has(definition.manifest.id)) {
          this.reportError(error, `contribute:${definition.manifest.id}`);
          this.contributionFailures.add(definition.manifest.id);
        }
      }
    }
    return contributions;
  }

  async activate(
    id: string,
    context: Context,
    services: Omit<ExtensionRuntimeServices<Events, Hooks>, "events" | "hooks" | "hasCapability" | "requireCapability">,
    installation?: InstalledExtension,
    onError: (error: unknown, extensionId: string) => void = (error, extensionId) => this.reportError(error, `activate:${extensionId}`),
  ): Promise<ExtensionCleanup> {
    const definition = this.definitions.get(id);
    if (!definition) throw new Error(`Extension "${id}" is not registered by this host.`);
    if (this.activations.has(id)) throw new Error(`Extension "${id}" is already active.`);
    if (installation ? !this.isEnabled(id, { [id]: installation }) : definition.manifest.defaultEnabled !== true) {
      throw new Error(`Extension "${id}" is not installed and enabled for this catalog.`);
    }
    const rawGrants = installation?.grantedCapabilities ?? definition.manifest.capabilities;
    if (rawGrants.some((capability) => !EXTENSION_CAPABILITIES.includes(capability as ExtensionCapability))) {
      throw new Error(`Extension "${id}" received an unknown capability grant.`);
    }
    const grantedCapabilities = definition.manifest.capabilities.filter((capability) => rawGrants.includes(capability));
    const missing = definition.manifest.capabilities.filter((capability) => !grantedCapabilities.includes(capability));
    if (missing.length) throw new Error(`Grant required capabilities before activating "${id}": ${missing.join(", ")}.`);
    const granted = new Set(grantedCapabilities);
    let active = true;
    const lifetimeCleanups: (() => void)[] = [];
    const track = (dispose: () => void) => {
      if (active) lifetimeCleanups.push(dispose);
      else dispose();
      return () => {
        const index = lifetimeCleanups.indexOf(dispose);
        if (index >= 0) lifetimeCleanups.splice(index, 1);
        dispose();
      };
    };
    const events: ExtensionEventAccess<Events> = {
      on: (event, listener) => {
        if (requiresCatalogRead(event) && !hasCapability("catalog.read")) throw new Error(`Extension "${id}" needs "catalog.read" to subscribe to ${String(event)}.`);
        return track(this.events.on(event, (payload) => listener(structuredClone(payload))));
      },
      once: (event, listener) => {
        if (requiresCatalogRead(event) && !hasCapability("catalog.read")) throw new Error(`Extension "${id}" needs "catalog.read" to subscribe to ${String(event)}.`);
        return track(this.events.once(event, (payload) => listener(structuredClone(payload))));
      },
      publish: (topic, payload) => {
        if (!active) throw new Error(`Extension "${id}" is no longer active.`);
        requireCapability("extension.messaging");
        assertExtensionTopic(topic);
        if (!isJsonValue(payload)) throw new Error(`Extension "${id}" published a non-JSON event payload.`);
        const listeners = this.extensionListeners.get(`${id}:${topic}`);
        for (const listener of [...(listeners ?? [])]) {
          try { listener(structuredClone(payload)); } catch (error) { this.reportError(error, `topic:${id}:${topic}`); }
        }
      },
      subscribe: (publisherId, topic, listener) => {
        if (!active) throw new Error(`Extension "${id}" is no longer active.`);
        requireCapability("extension.messaging");
        if (!this.definitions.has(publisherId)) throw new Error(`Extension "${publisherId}" is not registered by this host.`);
        assertExtensionTopic(topic);
        const key = `${publisherId}:${topic}`;
        let listeners = this.extensionListeners.get(key);
        if (!listeners) this.extensionListeners.set(key, (listeners = new Set()));
        const typedListener = listener as (payload: JsonValue) => void;
        listeners.add(typedListener);
        return track(() => {
          listeners?.delete(typedListener);
          if (!listeners?.size) this.extensionListeners.delete(key);
        });
      },
    };
    const hooks: ExtensionHookAccess<Hooks> = {
      register: <K extends keyof Hooks>(name: K, handler: (payload: Hooks[K]) => Hooks[K] | void | Promise<Hooks[K] | void>, priority?: number) => {
        if (!definition.manifest.hooks?.includes(String(name))) {
          throw new Error(`Extension "${id}" did not declare the "${String(name)}" hook.`);
        }
        for (const capability of this.hookCapabilities[name] ?? []) requireCapability(capability);
        return track(this.hooks.register(name, id, handler, priority));
      },
    };
    const hasCapability = (capability: ExtensionCapability) => active && granted.has(capability);
    const requireCapability = (capability: ExtensionCapability) => {
      if (!active) throw new Error(`Extension "${id}" is no longer active.`);
      if (!granted.has(capability)) throw new Error(`Extension "${id}" does not have the "${capability}" capability.`);
    };
    const wrapStorageArea = (area: keyof ExtensionStorage): ExtensionStorageArea => ({
      get: <T extends JsonValue = JsonValue>(key: string) => {
        if (!active) throw new Error(`Extension "${id}" is no longer active.`);
        assertStorageAccess(id, key, hasCapability);
        const value = services.storage[area].get<T>(key);
        return value === undefined ? undefined : structuredClone(value);
      },
      set: (key: string, value: JsonValue) => {
        if (!active) throw new Error(`Extension "${id}" is no longer active.`);
        assertStorageAccess(id, key, hasCapability);
        return services.storage[area].set(key, structuredClone(value));
      },
      delete: (key: string) => {
        if (!active) throw new Error(`Extension "${id}" is no longer active.`);
        assertStorageAccess(id, key, hasCapability);
        return services.storage[area].delete(key);
      },
    });
    const api: ExtensionRuntimeServices<Events, Hooks> = {
      ...services,
      events,
      hooks,
      storage: { data: wrapStorageArea("data"), settings: wrapStorageArea("settings") },
      hasCapability,
      requireCapability,
    };
    let returned: void | ExtensionCleanup;
    const cleanup: ExtensionCleanup = async () => {
      if (!active) return;
      active = false;
      if (this.activations.get(id) === cleanup) this.activations.delete(id);
      this.hooks.removeExtension(id);
      for (const dispose of lifetimeCleanups.splice(0)) {
        try { dispose(); } catch (error) { this.reportError(error, `cleanup:${id}`); }
      }
      try { await returned?.(); } catch (error) { this.reportError(error, `cleanup:${id}`); }
    };
    this.activations.set(id, cleanup);
    try {
      returned = await definition.activate?.({ context, services: api });
      if (!active) await returned?.();
    } catch (error) {
      if (this.activations.get(id) === cleanup) this.activations.delete(id);
      this.hooks.removeExtension(id);
      for (const dispose of lifetimeCleanups.splice(0)) {
        try { dispose(); } catch (cleanupError) { this.reportError(cleanupError, `cleanup:${id}`); }
      }
      active = false;
      try { onError(error, id); } catch (reportError) { this.reportError(reportError, `error-handler:${id}`); }
      throw error;
    }
    return cleanup;
  }

  async deactivate(id: string) {
    await this.activations.get(id)?.();
  }

  async deactivateAll() {
    await Promise.all([...this.activations.keys()].map((id) => this.deactivate(id)));
  }

  /** Host-owned hook execution. Extension code can register handlers but cannot invoke hooks or forge host events. */
  runHook<K extends keyof Hooks>(name: K, initial: Hooks[K]): Promise<Hooks[K]> {
    return this.hooks.run(name, initial);
  }
}

function assertStorageAccess(
  extensionId: string,
  key: string,
  hasCapability: (capability: ExtensionCapability) => boolean,
) {
  if (!hasCapability("catalog.storage")) throw new Error(`Extension "${extensionId}" does not have the "catalog.storage" capability.`);
  if (key.length > 128 || !key.length || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(key)
    || key.split(/[.:/]/).some((part) => !part || ["__proto__", "prototype", "constructor"].includes(part))) {
    throw new Error(`Extension "${extensionId}" used an invalid storage key.`);
  }
}

export interface ExtensionInstalledState extends InstalledExtension, ExtensionMigrationState {
  settings: Record<string, JsonValue>;
  data: Record<string, JsonValue>;
}

function isSemver(version: string) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version);
}

function compareSemver(a: string, b: string) {
  const parse = (version: string) => {
    const [core, prerelease] = version.split("-");
    return { numbers: (core ?? "").split(".").map((part) => Number.parseInt(part, 10)), prerelease: prerelease?.split(".") };
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const delta = (left.numbers[i] ?? 0) - (right.numbers[i] ?? 0);
    if (delta) return Math.sign(delta);
  }
  if (left.prerelease === undefined && right.prerelease === undefined) return 0;
  if (left.prerelease === undefined) return 1;
  if (right.prerelease === undefined) return -1;
  for (let i = 0; i < Math.max(left.prerelease.length, right.prerelease.length); i += 1) {
    const aPart = left.prerelease[i];
    const bPart = right.prerelease[i];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;
    if (aPart === bPart) continue;
    const aNumeric = /^\d+$/.test(aPart);
    const bNumeric = /^\d+$/.test(bPart);
    if (aNumeric && bNumeric) return Number(aPart) < Number(bPart) ? -1 : 1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return aPart < bPart ? -1 : 1;
  }
  return 0;
}

function requiresCatalogRead(event: PropertyKey) {
  return ["catalog.opened", "catalog.saved", "catalog.closed", "editor.command", "editor.selectionChanged", "asset.added"].includes(String(event));
}

function assertExtensionTopic(topic: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(topic)) throw new Error("Invalid extension event topic.");
}

function isJsonValue(value: unknown) {
  return isJsonMap({ value: value as JsonValue });
}

function isJsonMap(value: unknown): value is Record<string, JsonValue> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  let nodes = 0;
  let chars = 0;
  try {
    while (pending.length) {
      const entry = pending.pop()!;
      const current = entry.value;
      nodes += 1;
      if (nodes > 20_000 || entry.depth > 32) return false;
      if (current === null || typeof current === "boolean") continue;
      if (typeof current === "number") { if (!Number.isFinite(current)) return false; continue; }
      if (typeof current === "string") { chars += current.length; if (current.length > 100_000 || chars > 500_000) return false; continue; }
      if (typeof current !== "object" || seen.has(current)) return false;
      seen.add(current);
      if (Array.isArray(current)) {
        if (current.length > 10_000) return false;
        for (const item of current) pending.push({ value: item, depth: entry.depth + 1 });
      } else {
        const prototype = Object.getPrototypeOf(current);
        const keys = Reflect.ownKeys(current);
        if ((prototype !== Object.prototype && prototype !== null) || keys.length > 5_000) return false;
        for (const key of keys) {
          if (typeof key !== "string" || ["__proto__", "prototype", "constructor"].includes(key)) return false;
          const descriptor = Object.getOwnPropertyDescriptor(current, key);
          if (!descriptor || !("value" in descriptor)) return false;
          chars += key.length;
          if (chars > 500_000) return false;
          pending.push({ value: descriptor.value, depth: entry.depth + 1 });
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}
