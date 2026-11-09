import type { Metadata } from "next";

import { AcceptInvite } from "./accept-invite";

export const metadata: Metadata = { title: "Workspace invitation · Kavero", robots: { index: false } };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <AcceptInvite token={token} />;
}
