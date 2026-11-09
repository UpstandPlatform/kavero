import type { MetadataRoute } from "next";

import { PublicationService } from "@Kavero/api/services/publication-service";

import { ENV } from "@/env";
import { db } from "@/services";

// Query public catalogs per request; never prerender at build (the DB may be unreachable then).
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = ENV.BETTER_AUTH_URL.replace(/\/+$/, "");
  const entries: MetadataRoute.Sitemap = [{ url: `${base}/`, changeFrequency: "weekly", priority: 1 }];
  try {
    const rows = await new PublicationService(db).listPublic();
    for (const row of rows) {
      entries.push({ url: `${base}/c/${encodeURIComponent(row.slug)}`, lastModified: row.updatedAt, changeFrequency: "weekly", priority: 0.7 });
    }
  } catch (e) {
    console.error("sitemap: could not list public catalogs", e);
  }
  return entries;
}
