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

let storage: ObjectStorage | null = null;

/** Which driver `objectStorage()` uses, from `STORAGE_DRIVER` (filesystem | s3). */
export function storageDriver(): "filesystem" | "s3" {
  const driver = (process.env.STORAGE_DRIVER || "filesystem").toLowerCase();
  if (driver !== "filesystem" && driver !== "s3") throw new Error(`Unknown STORAGE_DRIVER "${driver}" (expected filesystem or s3)`);
  return driver;
}

function createStorage(): ObjectStorage {
  if (storageDriver() === "s3") {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new Error("STORAGE_DRIVER=s3 requires S3_BUCKET");
    return new S3Storage({
      bucket,
      region: process.env.S3_REGION,
      endpoint: process.env.S3_ENDPOINT,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: /^(1|true|yes)$/i.test(process.env.S3_FORCE_PATH_STYLE ?? ""),
    });
  }
  return new FileSystemStorage(process.env.KAVERO_STORAGE_DIR || join(process.cwd(), ".storage"));
}

export function objectStorage(): ObjectStorage {
  storage ??= createStorage();
  return storage;
}
