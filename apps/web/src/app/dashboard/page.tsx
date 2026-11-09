import type { Metadata } from "next";

import { CatalogDashboard } from "@/modules/catalog/catalog-dashboard";

export const metadata: Metadata = { title: "Catalogs · Kavero" };

// Local-first: no sign-in needed. Catalogs live in IndexedDB on this device.
export default function DashboardPage() {
  return <CatalogDashboard />;
}
