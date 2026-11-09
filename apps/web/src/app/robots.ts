import type { MetadataRoute } from "next";

import { ENV } from "@/env";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const base = ENV.BETTER_AUTH_URL.replace(/\/+$/, "");
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/editor/", "/render", "/settings", "/dashboard"] },
    sitemap: `${base}/sitemap.xml`,
  };
}
