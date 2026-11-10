import { expect, test } from "bun:test";

import {
  ExtensionHost,
  type ExtensionDefinition,
  type ExtensionEvents,
  type ExtensionRuntimeServices,
  type JsonValue,
} from "./index";
import type { ExtensionCapability, ExtensionManifest } from "./manifest";

type TestHooks = {
  "catalog.export.prepare": { documentId: string };
};

function manifest(capabilities: ExtensionCapability[], extra: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return {
    id: "com.example.test",
    name: "Test extension",
    description: "Exercise the extension host boundary.",
    version: "1.0.0",
    apiVersion: "1.0.0",
    publisher: { id: "example", name: "Example" },
    capabilities,
    ...extra,
  };
}

function installation(grantedCapabilities: ExtensionCapability[]) {
  return { version: "1.0.0", enabled: true, grantedCapabilities };
}

function createStorage() {
  const data = new Map<string, JsonValue>();
  const settings = new Map<string, JsonValue>();
  const createArea = (values: Map<string, JsonValue>) => ({
    get: <T extends JsonValue>(key: string) => values.get(key) as T | undefined,
    set: (key: string, value: JsonValue) => { values.set(key, value); },
    delete: (key: string) => { values.delete(key); },
  });
  return { data, settings, storage: { data: createArea(data), settings: createArea(settings) } };
}

test("missing catalog extension state does not crash extension contribution", () => {
  const host = new ExtensionHost<object, string>();
  const extension: ExtensionDefinition<object, string> = {
    manifest: manifest(["editor.ui"], { defaultEnabled: true }),
    contribute: () => "ready",
  };
  host.register(extension);

  expect(host.isEnabled(extension.manifest.id, undefined)).toBe(true);
  expect(host.contribute({}, undefined).map((item) => item.contribution)).toEqual(["ready"]);
});

test("extension storage returns copies and closes when the extension deactivates", async () => {
  const host = new ExtensionHost<object, void, ExtensionEvents, TestHooks>();
  const fixture = createStorage();
  fixture.data.set("profile", { nested: ["original"] });
  let runtime: ExtensionRuntimeServices<ExtensionEvents, TestHooks> | undefined;
  const extension: ExtensionDefinition<object, void, ExtensionEvents, TestHooks> = {
    manifest: manifest(["catalog.storage"]),
    activate: ({ services }) => { runtime = services; },
  };
  host.register(extension);

  const cleanup = await host.activate(extension.manifest.id, {}, { storage: fixture.storage }, installation(["catalog.storage"]));
  const api = runtime!;
  const read = api.storage.data.get<{ nested: string[] }>("profile")!;
  read.nested[0] = "mutated read";
  expect(fixture.data.get("profile")).toEqual({ nested: ["original"] });

  const write = { nested: ["new value"] };
  api.storage.data.set("profile", write);
  write.nested[0] = "mutated input";
  expect(fixture.data.get("profile")).toEqual({ nested: ["new value"] });

  await cleanup();
  expect(api.hasCapability("catalog.storage")).toBe(false);
  expect(() => api.storage.data.get("profile")).toThrow("no longer active");
});

test("cross-extension messaging requires its declared capability", async () => {
  const host = new ExtensionHost<object, void, ExtensionEvents, TestHooks>();
  const extension: ExtensionDefinition<object, void, ExtensionEvents, TestHooks> = {
    manifest: manifest([]),
    activate: ({ services }) => services.events.publish("update", { value: 1 }),
  };
  host.register(extension);

  await expect(host.activate(extension.manifest.id, {}, { storage: createStorage().storage }, installation([])))
    .rejects.toThrow('"extension.messaging"');
});

test("extensions can register only declared hooks with their configured capabilities", async () => {
  const host = new ExtensionHost<object, void, ExtensionEvents, TestHooks>({
    hookCapabilities: { "catalog.export.prepare": ["catalog.read", "catalog.write"] },
  });
  const extension: ExtensionDefinition<object, void, ExtensionEvents, TestHooks> = {
    manifest: manifest(["catalog.read"], { hooks: ["catalog.export.prepare"] }),
    activate: ({ services }) => services.hooks.register("catalog.export.prepare", (event) => event),
  };
  host.register(extension);

  await expect(host.activate(extension.manifest.id, {}, { storage: createStorage().storage }, installation(["catalog.read"])))
    .rejects.toThrow('"catalog.write"');
});
