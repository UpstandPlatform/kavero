import type { CatalogDocument } from "@Kavero/catalog-engine";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";

import { publications, resolveAccess } from "@/modules/publishing/access";

import { PasswordGate } from "./password-gate";
import { PublishedViewer } from "./published-viewer";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> };

async function access(slug: string) {
  const jar = await cookies();
  return resolveAccess(slug, await headers(), (n) => jar.get(n)?.value);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const a = await access(slug);
  if (a.kind === "missing") return { title: "Not found", robots: { index: false } };
  if (a.kind === "password") return { title: "Protected catalog", robots: { index: false, follow: false } };
  const doc = a.pub.document as CatalogDocument;
  const title = a.pub.seoTitle || doc.metadata.title;
  const description = a.pub.seoDescription || doc.metadata.description || `${doc.slides.length} pages`;
  const shareable = a.pub.visibility === "public" || a.pub.visibility === "unlisted";
  const image = shareable ? [{ url: `/c/${slug}/og?v=${a.pub.version}`, width: 1200, height: 630 }] : undefined;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return {
    metadataBase: new URL(`${proto}://${host}`),
    title,
    description,
    robots: a.pub.visibility === "public" ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { title, description, type: "website", url: `/c/${slug}`, images: image },
    twitter: { card: image ? "summary_large_image" : "summary", title, description, images: image?.map((i) => i.url) },
  };
}

/** Published catalog website. Shows the frozen snapshot, never the live draft. */
export default async function PublishedCatalogPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const a = await access(slug);
  if (a.kind === "missing") notFound();
  if (a.kind === "password") return <PasswordGate slug={slug} error={(await searchParams).error} />;
  if (!a.isOwner) void publications().countView(a.pub.id).catch(() => undefined);
  const doc = a.pub.document as CatalogDocument;
  return <PublishedViewer doc={doc} slug={slug} ownerNote={a.isOwner && a.pub.visibility === "private" ? "Private: only you can see this" : undefined} />;
}
