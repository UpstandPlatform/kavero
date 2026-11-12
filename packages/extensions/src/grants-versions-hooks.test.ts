import { expect, test } from "bun:test";

import { ExtensionHookRegistry } from "./hooks";
import { createGrantConfirmationStore, effectiveGrants, type GrantStorageBackend } from "./grants";
import { ExtensionHost } from "./host";
import type { ExtensionCapability, ExtensionManifest } from "./manifest";
import { compareSemver, isVersionCompatible } from "./versions";

function manifest(capabilities: ExtensionCapability[], extra: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return {
    id: "com.example.test",
    name: "Test extension",
    description: "Exercise grants.",
    version: "1.4.0",
    apiVersion: "1.0.0",
    publisher: { id: "example", name: "Example" },
    capabilities,
    ...extra,
  };
}

test("effective grants are the intersection of document grants and local confirmation", () => {
  const m = manifest(["catalog.read", "catalog.write"]);
  const record = { version: "1.4.0", enabled: true, grantedCapabilities: ["catalog.read", "catalog.write", "network.fetch"] };
  expect(effectiveGrants(m, record, ["catalog.read"])).toEqual({ granted: ["catalog.read"], unconfirmed: ["catalog.write"], missing: ["catalog.write"], complete: false });
  expect(effectiveGrants(m, record, ["catalog.read", "catalog.write"]).complete).toBe(true);
  // A local confirmation never widens what the document requests.
  expect(effectiveGrants(m, { ...record, grantedCapabilities: ["catalog.read"] }, ["catalog.read", "catalog.write"]).granted).toEqual(["catalog.read"]);
  // Not installed and not default-enabled: nothing.
  expect(effectiveGrants(m, undefined, ["catalog.read", "catalog.write"]).granted).toEqual([]);
  // No consent source (server tooling): document grants are used as is.
  expect(effectiveGrants(m, record, undefined).complete).toBe(true);
  // Unknown capabilities in the document are ignored.
  expect(effectiveGrants(m, { ...record, grantedCapabilities: ["root.everything"] }, ["root.everything"]).granted).toEqual([]);
});

test("trusted default-enabled bundles count as confirmed", () => {
  const m = manifest(["catalog.read"], { defaultEnabled: true });
  expect(effectiveGrants(m, undefined, []).complete).toBe(true);
  expect(effectiveGrants(m, { version: "1.4.0", enabled: true, grantedCapabilities: ["catalog.read"] }, []).complete).toBe(true);
});

test("the host activates only confirmed grants and reports pending consent", async () => {
  const confirmed = new Map<string, string[]>();
  const host = new ExtensionHost<object, void>({ confirmedGrants: (id) => confirmed.get(id) });
  const m = manifest(["catalog.read"]);
  host.register({ manifest: m, activate: () => undefined });
  const installed = { [m.id]: { version: "1.4.0", enabled: true, grantedCapabilities: ["catalog.read"] } };
  expect(host.isEnabled(m.id, installed)).toBe(false);
  expect(host.needsConsent(m.id, installed)).toBe(true);
  await expect(host.activate(m.id, {}, { storage: { data: noopArea, settings: noopArea } }, installed[m.id])).rejects.toThrow("not installed and enabled");
  confirmed.set(m.id, ["catalog.read"]);
  expect(host.isEnabled(m.id, installed)).toBe(true);
  expect(host.needsConsent(m.id, installed)).toBe(false);
  const cleanup = await host.activate(m.id, {}, { storage: { data: noopArea, settings: noopArea } }, installed[m.id]);
  await cleanup();
});

const noopArea = { get: () => undefined, set: () => undefined, delete: () => undefined };

test("grant confirmations persist per user and catalog and survive broken storage", () => {
  const values = new Map<string, string>();
  const backend: GrantStorageBackend = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); }, removeItem: (k) => { values.delete(k); } };
  const store = createGrantConfirmationStore({ userId: "u1", catalogId: "c1" }, backend);
  store.confirm("com.example.test", ["catalog.read", "made.up"]);
  store.allowConnection("com.example.test", "conn-1");
  expect(createGrantConfirmationStore({ userId: "u1", catalogId: "c1" }, backend).get("com.example.test")).toEqual({ capabilities: ["catalog.read"], connections: ["conn-1"] });
  expect(createGrantConfirmationStore({ userId: "u2", catalogId: "c1" }, backend).get("com.example.test")).toBeUndefined();
  store.revoke("com.example.test");
  expect(store.get("com.example.test")).toBeUndefined();

  const throwing: GrantStorageBackend = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => undefined };
  const fallback = createGrantConfirmationStore({ userId: null, catalogId: "c1" }, throwing);
  fallback.confirm("com.example.test", ["catalog.read"]);
  expect(fallback.get("com.example.test")?.capabilities).toEqual(["catalog.read"]);
  expect(createGrantConfirmationStore({ userId: null, catalogId: "c1" }, null).get("x.y")).toBeUndefined();
});

test("compareSemver keeps dashes inside prerelease identifiers", () => {
  expect(compareSemver("1.0.0-beta-2", "1.0.0-beta-3")).toBe(-1);
  expect(compareSemver("1.0.0-beta-2", "1.0.0-beta")).toBe(1);
  expect(compareSemver("1.0.0-rc.1", "1.0.0")).toBe(-1);
  expect(compareSemver("1.0.0-alpha.1", "1.0.0-alpha.beta")).toBe(-1);
  expect(compareSemver("1.2.0", "1.10.0")).toBe(-1);
  expect(compareSemver("2.0.0", "2.0.0")).toBe(0);
  expect(compareSemver("1.0.0-x-y", "1.0.0-x")).toBe(1);
});

test("same-major versions are compatible in both directions", () => {
  expect(isVersionCompatible("1.2.0", "1.4.0")).toBe(true);
  expect(isVersionCompatible("1.9.0", "1.4.0")).toBe(true);
  expect(isVersionCompatible("2.0.0", "1.4.0")).toBe(false);
  expect(isVersionCompatible("0.3.0", "0.3.9")).toBe(true);
  expect(isVersionCompatible("0.3.0", "0.4.0")).toBe(false);
  expect(isVersionCompatible("nope", "1.0.0")).toBe(false);
});

test("version skew within a major keeps extensions enabled; updates need no migration", () => {
  const host = new ExtensionHost<object, void>();
  const m = manifest(["catalog.read"]);
  host.register({ manifest: m, migrations: { "0.9.0": { toVersion: "1.0.0", migrate: (state) => ({ ...state, data: { migrated: true } }) } } });
  const at = (version: string) => ({ [m.id]: { version, enabled: true, grantedCapabilities: ["catalog.read"] } });
  expect(host.isEnabled(m.id, at("1.0.0"))).toBe(true);
  expect(host.isEnabled(m.id, at("1.9.0"))).toBe(true); // downgrade within the major line
  expect(host.isEnabled(m.id, at("2.0.0"))).toBe(false);
  expect(host.isEnabled(m.id, at("0.9.0"))).toBe(false);
  expect(host.canMigrate(m.id, "1.1.0")).toBe(true);
  expect(host.canMigrate(m.id, "0.9.0")).toBe(true);
  expect(host.canMigrate(m.id, "0.8.0")).toBe(false);
  expect(host.canMigrate(m.id, "1.9.0")).toBe(false);
  const base = { enabled: true, settings: {}, data: {} };
  expect(host.migrateState(m.id, { ...base, version: "1.1.0" }).version).toBe("1.4.0");
  expect(host.migrateState(m.id, { ...base, version: "0.9.0" })).toMatchObject({ version: "1.4.0", data: { migrated: true } });
});

test("hooks isolate failing, slow and invalid handlers and validate priority", async () => {
  const errors: string[] = [];
  const hooks = new ExtensionHookRegistry<{ prepare: { items: string[] } }>({
    handlerTimeoutMs: 20,
    onError: (_error, hook, extensionId) => errors.push(`${hook}:${extensionId}`),
    validate: (_hook, value) => !!value && Array.isArray((value as { items?: unknown }).items),
  });
  hooks.register("prepare", "a.throws", (payload) => { payload.items.push("partial"); throw new Error("boom"); }, 1);
  hooks.register("prepare", "b.slow", () => new Promise(() => undefined), 2);
  hooks.register("prepare", "c.invalid", () => ({ items: "nope" }) as never, 3);
  hooks.register("prepare", "d.good", (payload) => ({ items: [...payload.items, "good"] }), 4);
  hooks.register("prepare", "e.mutates", (payload) => { payload.items.push("mutated"); }, 5);
  const initial = { items: ["start"] };
  const result = await hooks.run("prepare", initial);
  expect(result.items).toEqual(["start", "good", "mutated"]);
  expect(initial.items).toEqual(["start"]);
  expect(errors).toEqual(["prepare:a.throws", "prepare:b.slow", "prepare:c.invalid"]);
  expect(() => hooks.register("prepare", "x.nan", (payload) => payload, Number.NaN)).toThrow("finite");
  expect(() => hooks.register("prepare", "x.inf", (payload) => payload, Number.POSITIVE_INFINITY)).toThrow("finite");
});
