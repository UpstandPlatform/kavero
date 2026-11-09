import type { CatalogDocument } from "@Kavero/catalog-engine";
import { applyCloudLink, assertValid, summarize, type CatalogRepository, type CatalogSummary, type CloudLink, type StoredAsset } from "./repository";

const DB_NAME = "kavero";
const DB_VERSION = 1;
const DOCS = "documents";
const SUMMARIES = "summaries";
const ASSETS = "assets";

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
  });
}

/**
 * Browser persistence. Documents and summaries are separate stores so the
 * dashboard lists catalogs without loading every slide. Assets are Blobs,
 * never inlined into the document JSON.
 */
export class IndexedDbCatalogRepository implements CatalogRepository {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly dbName = DB_NAME, private readonly factory: IDBFactory = globalThis.indexedDB) {}

  private db(): Promise<IDBDatabase> {
    if (!this.factory) return Promise.reject(new Error("IndexedDB is not available in this environment"));
    this.dbPromise ??= new Promise((resolve, reject) => {
      const open = this.factory.open(this.dbName, DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains(DOCS)) db.createObjectStore(DOCS, { keyPath: "id" });
        if (!db.objectStoreNames.contains(SUMMARIES)) db.createObjectStore(SUMMARIES, { keyPath: "id" }).createIndex("updatedAt", "updatedAt");
        if (!db.objectStoreNames.contains(ASSETS)) db.createObjectStore(ASSETS, { keyPath: "id" }).createIndex("catalogId", "catalogId");
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error("Kavero storage is blocked by another open tab. Close other tabs and retry."));
    });
    return this.dbPromise;
  }

  async list(): Promise<CatalogSummary[]> {
    const db = await this.db();
    const all = await req(db.transaction(SUMMARIES).objectStore(SUMMARIES).getAll() as IDBRequest<CatalogSummary[]>);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<CatalogDocument | null> {
    const db = await this.db();
    return ((await req(db.transaction(DOCS).objectStore(DOCS).get(id))) as CatalogDocument | undefined) ?? null;
  }

  async save(doc: CatalogDocument, extra: Partial<Pick<CatalogSummary, "thumbnail">> = {}): Promise<CatalogSummary> {
    const valid = assertValid(doc);
    const db = await this.db();
    const tx = db.transaction([DOCS, SUMMARIES], "readwrite");
    const summaries = tx.objectStore(SUMMARIES);
    const prev = ((await req(summaries.get(doc.id))) as CatalogSummary | undefined) ?? null;
    const summary = { ...summarize(valid, prev), ...extra };
    tx.objectStore(DOCS).put(valid);
    summaries.put(summary);
    await done(tx);
    return summary;
  }

  async delete(id: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction([DOCS, SUMMARIES, ASSETS], "readwrite");
    tx.objectStore(DOCS).delete(id);
    tx.objectStore(SUMMARIES).delete(id);
    const keys = await req(tx.objectStore(ASSETS).index("catalogId").getAllKeys(id));
    for (const k of keys) tx.objectStore(ASSETS).delete(k);
    await done(tx);
  }

  async setCloudLink(id: string, link: CloudLink | null, syncedRevision?: number): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(SUMMARIES, "readwrite");
    const store = tx.objectStore(SUMMARIES);
    const prev = (await req(store.get(id))) as CatalogSummary | undefined;
    if (!prev) throw new Error("Catalog not found");
    store.put(applyCloudLink(prev, link, syncedRevision));
    await done(tx);
  }

  async putAsset(asset: StoredAsset): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(ASSETS, "readwrite");
    tx.objectStore(ASSETS).put(asset);
    await done(tx);
  }

  async getAsset(id: string): Promise<StoredAsset | null> {
    const db = await this.db();
    return ((await req(db.transaction(ASSETS).objectStore(ASSETS).get(id))) as StoredAsset | undefined) ?? null;
  }

  async listAssets(catalogId: string): Promise<StoredAsset[]> {
    const db = await this.db();
    return (await req(db.transaction(ASSETS).objectStore(ASSETS).index("catalogId").getAll(catalogId))) as StoredAsset[];
  }
}
