"use client";

import { Button } from "@Kavero/ui/components/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@Kavero/ui/components/card";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { KaveroLogo } from "@/components/kavero-logo";
import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";
import { useLocalMode } from "@/lib/desktop";

export default function LoginPage() {
  const [showSignIn, setShowSignIn] = useState(true);
  const router = useRouter();
  const localMode = useLocalMode();

  // The desktop app's local account is signed in automatically.
  useEffect(() => {
    if (localMode) router.replace("/dashboard");
  }, [localMode, router]);
  if (localMode) return null;

  return (
    <main className="grid min-h-[calc(100svh-3.5rem)] place-items-center bg-muted/20 px-4 py-10">
      <div className="grid w-full max-w-md gap-5">
        <Link href="/" className="mx-auto inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
          <KaveroLogo /> Kavero
        </Link>

        <Card className="gap-0 overflow-hidden rounded-2xl py-0 shadow-sm">
          <CardHeader className="gap-2 border-b px-6 py-6 sm:px-8">
            <CardTitle className="text-xl tracking-tight">{showSignIn ? "Welcome back" : "Create your account"}</CardTitle>
            <CardDescription>
              {showSignIn ? "Sign in to sync your catalogs and work with your team." : "Save your work across devices and share it with your team."}
            </CardDescription>
          </CardHeader>

          <CardContent className="px-6 py-6 sm:px-8">
            {showSignIn ? <SignInForm /> : <SignUpForm />}
          </CardContent>

          <CardFooter className="flex flex-col gap-3 border-t px-6 py-4 text-center sm:px-8">
            <p className="text-sm text-muted-foreground">
              {showSignIn ? "New to Kavero?" : "Already have an account?"}
              <Button variant="link" className="h-auto px-1.5 py-0 font-medium" onClick={() => setShowSignIn((value) => !value)}>
                {showSignIn ? "Create an account" : "Sign in"}
              </Button>
            </p>
            <Link href="/dashboard" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
              Continue without an account
            </Link>
          </CardFooter>
        </Card>

        <p className="text-center text-xs text-muted-foreground">Your local catalogs stay in this browser until you choose to sync them.</p>
      </div>
    </main>
  );
}
