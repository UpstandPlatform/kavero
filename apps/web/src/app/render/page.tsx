import type { Metadata } from "next";

import { RenderHost } from "./render-host";

export const metadata: Metadata = { title: "Kavero render", robots: { index: false } };

/** Headless frame renderer used by video export. Not linked from the UI. */
export default function RenderPage() {
  return <RenderHost />;
}
