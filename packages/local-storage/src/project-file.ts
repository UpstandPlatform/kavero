import { duplicateCatalogWithAssets, parseCatalogDocument, type CatalogDocument } from "@Kavero/catalog-engine";
import { z } from "zod";
import type { CatalogRepository, StoredAsset } from "./repository";

/**
 * .kavero project file: a versioned JSON envelope holding the catalog and its
 * bundled assets (base64). Good for typical catalogs; a zip-based format can
 * replace this later for very large projects without changing the envelope's
 * `format`/`formatVersion` contract.
 */
export const KAVERO_FILE_FORMAT = "kavero-project";
export const KAVERO_FILE_VERSION = 1;
export const KAVERO_FILE_EXTENSION = ".kavero";
export const KAVERO_MIME = "application/vnd.kavero+json";

const fileSchema = z.object({
  format: z.literal(KAVERO_FILE_FORMAT),
  formatVersion: z.number().int().positive(),
  exportedAt: z.string(),
  catalog: z.unknown(),
  assets: z.array(z.object({ id: z.string(), mimeType: z.string(), hash: z.string(), data: z.string() })).default([]),
});

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function base64ToBlob(data: string, type: string): Blob {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export async function exportProjectFile(repo: CatalogRepository, catalogId: string): Promise<Blob> {
  const doc = await repo.get(catalogId);
  if (!doc) throw new Error("Catalog not found");
  const stored = await repo.listAssets(catalogId);
  const assets = await Promise.all(
    stored.map(async (a) => ({ id: a.id, mimeType: a.blob.type, hash: a.hash, data: await blobToBase64(a.blob) })),
  );
  const file = { format: KAVERO_FILE_FORMAT, formatVersion: KAVERO_FILE_VERSION, exportedAt: new Date().toISOString(), catalog: doc, assets };
  return new Blob([JSON.stringify(file)], { type: KAVERO_MIME });
}

export interface ImportResult {
  document: CatalogDocument;
  warnings: string[];
}

/**
 * Import a .kavero file. If a catalog with the same id already exists, the
 * import becomes a copy with fresh ids rather than overwriting local work.
 */
export async function importProjectFile(repo: CatalogRepository, input: Blob | string): Promise<ImportResult> {
  let json: unknown;
  try {
    json = JSON.parse(typeof input === "string" ? input : await input.text());
  } catch {
    throw new Error("This file is not a Kavero project.");
  }
  const parsed = fileSchema.safeParse(json);
  if (!parsed.success) throw new Error("This file is not a Kavero project.");
  if (parsed.data.formatVersion > KAVERO_FILE_VERSION) throw new Error("This project was saved by a newer version of Kavero.");

  const res = parseCatalogDocument(parsed.data.catalog);
  if (!res.ok) throw new Error(`Project is damaged: ${res.issues.slice(0, 3).map((i) => `${i.path} ${i.message}`).join("; ")}`);

  let doc = res.document;
  const existing = await repo.get(doc.id);
  // Never overwrite local work: a re-import becomes a copy with fresh ids (assets included).
  let remap = new Map<string, string>();
  if (existing) ({ document: doc, assetIdMap: remap } = duplicateCatalogWithAssets(doc, `${doc.metadata.title} (imported)`));

  await repo.save(doc);
  for (const a of parsed.data.assets) {
    const asset: StoredAsset = { id: remap.get(a.id) ?? a.id, catalogId: doc.id, hash: a.hash, blob: base64ToBlob(a.data, a.mimeType) };
    await repo.putAsset(asset);
  }
  return { document: doc, warnings: res.warnings.map((w) => `${w.path}: ${w.message}`) };
}
