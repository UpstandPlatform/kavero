import type { Metadata } from "next";

import { AdminPage } from "@/modules/admin/admin-page";

export const metadata: Metadata = { title: "Admin · Kavero", robots: { index: false } };

export default function Page() {
  return <AdminPage />;
}
