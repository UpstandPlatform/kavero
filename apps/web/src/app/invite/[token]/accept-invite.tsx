"use client";

import { Button } from "@Kavero/ui/components/button";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { makeTRPCClient } from "@/utils/trpc";

type Preview = { email: string; role: string; workspaceName: string } | null;

export function AcceptInvite({ token }: { token: string }) {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [preview, setPreview] = useState<Preview | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => void makeTRPCClient().workspace.previewInvite.query({ token }).then(setPreview, () => setPreview(null)), [token]);

  if (preview === undefined || isPending) return <p className="p-8 text-sm text-muted-foreground">Loading invitation…</p>;
  if (preview === null) return <div className="mx-auto max-w-md p-8 text-sm">This invitation is invalid, already used or expired. Ask for a new link.</div>;
  const wrongUser = session && session.user.email.toLowerCase() !== preview.email;

  return (
    <div className="mx-auto grid max-w-md gap-4 p-8 text-sm">
      <h1 className="text-xl font-semibold">Join “{preview.workspaceName}”</h1>
      <p>You’ve been invited as <b>{preview.role}</b> ({preview.email}).</p>
      {!session ? (
        <><p className="text-muted-foreground">Sign in or create an account with {preview.email}, then open this link again.</p><Link href="/login"><Button>Sign in</Button></Link></>
      ) : wrongUser ? (
        <p className="text-destructive">You’re signed in as {session.user.email}. Sign in with {preview.email} to accept.</p>
      ) : (
        <Button disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            await makeTRPCClient().workspace.acceptInvite.mutate({ token });
            toast.success(`You joined ${preview.workspaceName}`);
            router.push("/dashboard");
          } catch (e) {
            toast.error((e as Error).message);
            setBusy(false);
          }
        }}>Accept invitation</Button>
      )}
    </div>
  );
}
