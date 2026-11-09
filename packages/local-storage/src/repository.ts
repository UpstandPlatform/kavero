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
  /** Files the cloud copy still lacks (a previous upload failed); sent on the next push. */
  pendingAssetIds?: string[];
}

/** True when the local copy has edits (or files) the cloud doesn't have yet. */
export function hasUnsyncedChanges(s: CatalogSummary) {
  return !!s.cloud && (s.syncedRevision !== s.revision || !!s.cloud.pendingAssetIds?.length);
}

/** Identifies one stored version of a document; changes on every save. */
export interface DocVersion {
  revision: number;
  updatedAt: number;
}

export const versionOf = (s: Pick<CatalogSummary, "revision" | "updatedAt">): DocVersion => ({ revision: s.revision, updatedAt: s.updatedAt });

/** A compare-and-swap save found a different version stored than the caller expected. */
export class StaleWriteError extends Error {
  constructor(public readonly catalogId: string) {
    super("This catalog was changed in another tab or synced from the cloud.");
  }
}

export interface SaveOptions extends Partial<Pick<CatalogSummary, "thumbnail">> {
  /** Only write if the stored version is still this one (throws StaleWriteError otherwise). */
  expect?: DocVersion;
}

export function assertExpected(id: string, stored: CatalogSummary | null | undefined, expect: DocVersion | undefined) {
  if (!expect) return;
  if (!stored || stored.revision !== expect.revision || stored.updatedAt !== expect.updatedAt) throw new StaleWriteError(id);
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
  getSummary(id: string): Promise<CatalogSummary | null>;
  /** Document and summary read together, so the version matches the document. */
  getWithSummary(id: string): Promise<{ document: CatalogDocument; summary: CatalogSummary } | null>;
  /** Validates before writing; throws on an invalid document. */
  save(doc: CatalogDocument, options?: SaveOptions): Promise<CatalogSummary>;
  delete(id: string): Promise<void>;
  /** Update (or clear, with null) the cloud link without touching the document. */
  setCloudLink(id: string, link: CloudLink | null, syncedRevision?: number): Promise<void>;
  putAsset(asset: StoredAsset): Promise<void>;
  getAsset(id: string): Promise<StoredAsset | null>;
  listAssets(catalogId: string): Promise<StoredAsset[]>;
}

export function summarize(doc: CatalogDocument, prev: CatalogSummary | null, now = Date.now()): CatalogSummary {
  // Strictly increasing per catalog, so two saves within one millisecond still get distinct versions.
  if (prev && now <= prev.updatedAt) now = prev.updatedAt + 1;
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
  async getSummary(id: string) {
    const s = this.summaries.get(id);
    return s ? structuredClone(s) : null;
  }
  async getWithSummary(id: string) {
    const document = await this.get(id);
    const summary = await this.getSummary(id);
    return document && summary ? { document, summary } : null;
  }
  async save(doc: CatalogDocument, { expect, ...extra }: SaveOptions = {}) {
    const valid = assertValid(doc);
    assertExpected(doc.id, this.summaries.get(doc.id), expect);
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
