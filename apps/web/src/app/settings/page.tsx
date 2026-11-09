import type { Metadata } from "next";

import { SettingsPage } from "@/modules/settings/settings-page";

export const metadata: Metadata = { title: "Settings · Kavero" };

export default function Page() {
  return <SettingsPage />;
}
