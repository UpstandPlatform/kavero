import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import { S3Storage } from "./s3-storage";

/** Where binary assets live. Swap in an S3-compatible driver for hosted deployments. */
export interface ObjectStorage {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

/** Local folder storage; the default for local and single-server installs. */
export class FileSystemStorage implements ObjectStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string) {
    if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes("..")) throw new Error("Invalid storage key");
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error("Invalid storage key");
    return p;
  }

  async put(key: string, data: Uint8Array) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  }

  async get(key: string) {
    try {
      return new Uint8Array(await readFile(this.path(key)));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
}

export type StorageSettings = Record<string, string | number | boolean | null>;

/** Builds the driver for the `storage` settings section (Admin → System → Media storage, or the S3_* environment variables). */
export function createStorage(settings: StorageSettings): ObjectStorage {
  const driver = String(settings.driver ?? "filesystem");
  if (driver === "s3") {
    const bucket = typeof settings.bucket === "string" ? settings.bucket.trim() : "";
    if (!bucket) throw new Error("S3 storage needs a bucket (Admin → System → Media storage, or S3_BUCKET)");
    const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
    return new S3Storage({
      bucket,
      region: text(settings.region),
      endpoint: text(settings.endpoint),
      accessKeyId: text(settings.accessKeyId),
      secretAccessKey: typeof settings.secretAccessKey === "string" && settings.secretAccessKey ? settings.secretAccessKey : undefined,
      forcePathStyle: settings.forcePathStyle === true,
    });
  }
  if (driver !== "filesystem") throw new Error(`Unknown storage driver "${driver}" (expected filesystem or s3)`);
  // The folder is deployment-level (a mounted volume), so it stays an environment variable.
  return new FileSystemStorage(process.env.KAVERO_STORAGE_DIR || join(process.cwd(), ".storage"));
}

const cache = globalThis as unknown as { __kaveroStorage?: { signature: string; storage: ObjectStorage } };

/**
 * The configured object storage. Rebuilt automatically when an admin changes the
 * storage settings (on this or another server instance).
 */
export async function objectStorage(): Promise<ObjectStorage> {
  const { runtimeConfig } = await import("@/platform");
  const settings = await runtimeConfig.values("storage");
  const signature = JSON.stringify(settings);
  if (cache.__kaveroStorage?.signature !== signature) cache.__kaveroStorage = { signature, storage: createStorage(settings) };
  return cache.__kaveroStorage.storage;
}

/** Writes, reads and deletes a small probe file with the current settings (Admin → System → Test). */
export async function testObjectStorage(): Promise<{ ok: boolean; driver: string; message?: string }> {
  const { runtimeConfig } = await import("@/platform");
  const settings = await runtimeConfig.values("storage");
  const driver = String(settings.driver ?? "filesystem");
  const key = `health/probe-${crypto.randomUUID()}`;
  try {
    const storage = createStorage(settings);
    await storage.put(key, new Uint8Array([1]));
    const read = await storage.get(key);
    await storage.delete(key);
    if (read?.length !== 1 || read[0] !== 1) return { ok: false, driver, message: "The file read back didn't match what was written." };
    return { ok: true, driver };
  } catch (error) {
    // Driver errors (bucket not found, access denied) are useful to admins and don't contain the secret key.
    return { ok: false, driver, message: error instanceof Error ? error.message.slice(0, 300) : "Storage check failed" };
  }
}
