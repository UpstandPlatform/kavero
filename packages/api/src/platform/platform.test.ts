import { describe, expect, test } from "bun:test";

import { SecretBox } from "../services/secret-box";
import { Platform, UNLIMITED, detectEdition } from "./edition";
import { RuntimeConfig, type SettingsStore } from "./runtime-config";

const AUTH = "a".repeat(40);

function memoryStore() {
  const data: Record<string, Record<string, unknown>> = {};
  const store: SettingsStore & { data: typeof data; saves: number; fail?: boolean } = {
    data,
    saves: 0,
    async loadAll() {
      if (store.fail) throw new Error("db down");
      return structuredClone(data) as never;
    },
    async save(id, value) {
      store.saves++;
      data[id] = structuredClone(value) as never;
    },
  };
  return store;
}

describe("SecretBox", () => {
  test("v1 values stay readable after adding an encryption key; new values use v2", () => {
    const old = new SecretBox(AUTH);
    const v1 = old.seal("hello");
    expect(v1.startsWith("v1.")).toBe(true);
    const box = new SecretBox(AUTH, "k".repeat(40));
    expect(box.open(v1)).toBe("hello");
    expect(box.needsReseal(v1)).toBe(true);
    const v2 = box.seal("world");
    expect(v2.startsWith("v2.")).toBe(true);
    expect(box.open(v2)).toBe("world");
    // Rotating the auth secret doesn't break v2 values.
    expect(new SecretBox("b".repeat(40), "k".repeat(40)).open(v2)).toBe("world");
    expect(() => old.open(v2)).toThrow();
  });

  test("rejects short encryption keys", () => {
    expect(() => new SecretBox(AUTH, "short")).toThrow();
  });
});

describe("editions", () => {
  test("detects desktop from local mode, explicit edition wins, unknown throws", () => {
    expect(detectEdition({})).toBe("self-hosted");
    expect(detectEdition({ KAVERO_LOCAL_MODE: "1" })).toBe("desktop");
    expect(detectEdition({ KAVERO_EDITION: "cloud", KAVERO_LOCAL_MODE: "1" })).toBe("cloud");
    expect(() => detectEdition({ KAVERO_EDITION: "enterprise" })).toThrow();
  });

  test("modules only apply to their editions; entitlements default to unlimited", async () => {
    const selfHosted = new Platform("self-hosted");
    expect(selfHosted.use({ id: "billing", editions: ["cloud"], entitlements: { forUser: async () => ({ ...UNLIMITED, plan: "Free", maxCatalogs: 3 }) } })).toBe(false);
    expect(await selfHosted.entitlements.forUser("u")).toEqual(UNLIMITED);
    expect(selfHosted.features.billing).toBe(false);

    const cloud = new Platform("cloud");
    expect(cloud.use({ id: "billing", editions: ["cloud"], entitlements: { forUser: async () => ({ ...UNLIMITED, plan: "Free", maxCatalogs: 3 }) } })).toBe(true);
    expect((await cloud.entitlements.forUser("u")).maxCatalogs).toBe(3);
    expect(() => cloud.use({ id: "billing", editions: ["cloud"] })).toThrow();
  });
});

describe("RuntimeConfig", () => {
  const box = new SecretBox(AUTH, "k".repeat(40));

  test("resolves env > admin > default and locks env fields", async () => {
    const store = memoryStore();
    const cfg = new RuntimeConfig(store, box, "self-hosted", { S3_BUCKET: "from-env" }, 0);
    expect((await cfg.values("storage")).driver).toBe("filesystem");
    await cfg.update("storage", { driver: "s3", region: "eu-west-1" }, "admin1");
    const v = await cfg.values("storage");
    expect(v).toMatchObject({ driver: "s3", region: "eu-west-1", bucket: "from-env" });
    await expect(cfg.update("storage", { bucket: "x" }, "admin1")).rejects.toThrow(/S3_BUCKET/);
    const view = (await cfg.describe()).find((s) => s.id === "storage")!;
    expect(view.fields.find((f) => f.key === "bucket")).toMatchObject({ locked: true, source: "env" });
  });

  test("secrets are sealed at rest, never described, and kept when the form sends an empty string", async () => {
    const store = memoryStore();
    const cfg = new RuntimeConfig(store, box, "self-hosted", {}, 0);
    await cfg.update("storage", { secretAccessKey: "s3cr3t" }, "a");
    expect(JSON.stringify(store.data)).not.toContain("s3cr3t");
    expect((await cfg.values("storage")).secretAccessKey).toBe("s3cr3t");
    const field = (await cfg.describe()).find((s) => s.id === "storage")!.fields.find((f) => f.key === "secretAccessKey")!;
    expect(field).toMatchObject({ value: null, hasValue: true });
    await cfg.update("storage", { secretAccessKey: "" }, "a");
    expect((await cfg.values("storage")).secretAccessKey).toBe("s3cr3t");
    await cfg.update("storage", { secretAccessKey: null }, "a");
    expect((await cfg.values("storage")).secretAccessKey).toBeNull();
  });

  test("validates input", async () => {
    const cfg = new RuntimeConfig(memoryStore(), box, "self-hosted", {}, 0);
    await expect(cfg.update("storage", { driver: "ftp" }, "a")).rejects.toThrow();
    await expect(cfg.update("exports", { maxBrowsers: 0 }, "a")).rejects.toThrow();
    await expect(cfg.update("ai", { baseUrl: "file:///etc" }, "a")).rejects.toThrow();
    await expect(cfg.update("storage", { nope: 1 }, "a")).rejects.toThrow();
    await expect(cfg.update("plans", { maxCatalogs: 3 }, "a")).rejects.toThrow(/edition/);
  });

  test("unreadable secrets fall back to the default and are flagged", async () => {
    const store = memoryStore();
    await new RuntimeConfig(store, box, "self-hosted", {}, 0).update("ai", { anthropicApiKey: "sk" }, "a");
    const other = new RuntimeConfig(store, new SecretBox(AUTH, "z".repeat(40)), "self-hosted", {}, 0);
    expect((await other.values("ai")).anthropicApiKey).toBeNull();
    const f = (await other.describe()).find((s) => s.id === "ai")!.fields.find((x) => x.key === "anthropicApiKey")!;
    expect(f.unreadable).toBe(true);
  });

  test("notifies listeners about changes made elsewhere, and survives a database outage", async () => {
    const store = memoryStore();
    const a = new RuntimeConfig(store, box, "self-hosted", {}, 0);
    const b = new RuntimeConfig(store, box, "self-hosted", {}, 0);
    await b.refresh();
    const seen: string[][] = [];
    b.onChange((ids) => seen.push(ids));
    await a.update("exports", { maxBrowsers: 4 }, "a");
    expect((await b.values("exports")).maxBrowsers).toBe(4);
    expect(seen).toEqual([["exports"]]);
    store.fail = true;
    expect((await b.values("exports")).maxBrowsers).toBe(4);
  });

  test("edition defaults: desktop allows private addresses", async () => {
    const desktop = new RuntimeConfig(memoryStore(), box, "desktop", { NODE_ENV: "production" }, 0);
    expect((await desktop.values("network")).allowPrivateUrls).toBe(true);
  });
});
