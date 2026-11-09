import { parseCatalogDocument, type CatalogDocument } from "@Kavero/catalog-engine";

/** Lightweight listing info so the dashboard never loads full documents. */
export interface CatalogSummary {
  id: string;
  title: string;
  description?: string;
  slideCount: number;
  width: number;
  height: number;
  createdAt: number;
  updatedAt: number;
  revision: number;
  /** "synced" once the catalog has a cloud copy. */
  location: "local" | "synced";
  /** Local revision that was last pushed to (or pulled from) the cloud; null if never synced. */
  syncedRevision: number | null;
  /** Link to the cloud copy, when there is one. */
  cloud?: CloudLink;
  /** Thumbnail data URL, if one has been rendered. */
  thumbnail?: string;
}

export interface CloudLink {
  /** Server catalog row id. */
  id: string;
  /** Server revision this copy is based on; sent as baseRevision when saving. */
  revision: number;
  /** Account that owns the cloud copy, so another sign-in never syncs it by mistake. */
  userId: string;
  syncedAt: number;
}

/** True when the local copy has edits the cloud doesn't have yet. */
export function hasUnsyncedChanges(s: CatalogSummary) {
  return !!s.cloud && s.syncedRevision !== s.revision;
}

export interface StoredAsset {
  id: string; // matches CatalogAsset.id
  catalogId: string;
  blob: Blob;
  hash: string;
}

export interface CatalogRepository {
  list(): Promise<CatalogSummary[]>;
  get(id: string): Promise<CatalogDocument | null>;
  /** Validates before writing; throws on an invalid document. */
  save(doc: CatalogDocument, extra?: Partial<Pick<CatalogSummary, "thumbnail">>): Promise<CatalogSummary>;
  delete(id: string): Promise<void>;
  /** Update (or clear, with null) the cloud link without touching the document. */
  setCloudLink(id: string, link: CloudLink | null, syncedRevision?: number): Promise<void>;
  putAsset(asset: StoredAsset): Promise<void>;
  getAsset(id: string): Promise<StoredAsset | null>;
  listAssets(catalogId: string): Promise<StoredAsset[]>;
}

export function summarize(doc: CatalogDocument, prev: CatalogSummary | null, now = Date.now()): CatalogSummary {
  return {
    id: doc.id,
    title: doc.metadata.title,
    description: doc.metadata.description,
    slideCount: doc.slides.length,
    width: doc.settings.width,
    height: doc.settings.height,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    revision: doc.revision,
    location: prev?.location ?? "local",
    syncedRevision: prev?.syncedRevision ?? null,
    cloud: prev?.cloud,
    thumbnail: prev?.thumbnail,
  };
}

export function applyCloudLink(s: CatalogSummary, link: CloudLink | null, syncedRevision?: number): CatalogSummary {
  if (!link) {
    const { cloud: _c, ...rest } = s;
    return { ...rest, location: "local", syncedRevision: null };
  }
  return { ...s, cloud: link, location: "synced", syncedRevision: syncedRevision ?? s.syncedRevision };
}

export function assertValid(doc: CatalogDocument): CatalogDocument {
  const res = parseCatalogDocument(doc);
  if (!res.ok) throw new Error(`Invalid catalog: ${res.issues.map((i) => `${i.path} ${i.message}`).join("; ")}`);
  return res.document;
}

/** In-memory repository for tests and server-side use. */
export class MemoryCatalogRepository implements CatalogRepository {
  private docs = new Map<string, CatalogDocument>();
  private summaries = new Map<string, CatalogSummary>();
  private assets = new Map<string, StoredAsset>();

  async list() {
    return [...this.summaries.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async get(id: string) {
    const d = this.docs.get(id);
    return d ? structuredClone(d) : null;
  }
  async save(doc: CatalogDocument, extra: Partial<Pick<CatalogSummary, "thumbnail">> = {}) {
    const valid = assertValid(doc);
    const summary = { ...summarize(valid, this.summaries.get(doc.id) ?? null), ...extra };
    this.docs.set(doc.id, structuredClone(valid));
    this.summaries.set(doc.id, summary);
    return summary;
  }
  async delete(id: string) {
    this.docs.delete(id);
    this.summaries.delete(id);
    for (const [k, a] of this.assets) if (a.catalogId === id) this.assets.delete(k);
  }
  async setCloudLink(id: string, link: CloudLink | null, syncedRevision?: number) {
    const s = this.summaries.get(id);
    if (!s) throw new Error("Catalog not found");
    this.summaries.set(id, applyCloudLink(s, link, syncedRevision));
  }
  async putAsset(asset: StoredAsset) {
    this.assets.set(asset.id, asset);
  }
  async getAsset(id: string) {
    return this.assets.get(id) ?? null;
  }
  async listAssets(catalogId: string) {
    return [...this.assets.values()].filter((a) => a.catalogId === catalogId);
  }
}
