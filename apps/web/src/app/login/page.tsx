"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";
import { useLocalMode } from "@/lib/desktop";

export default function LoginPage() {
  const [showSignIn, setShowSignIn] = useState(false);
  const router = useRouter();
  const localMode = useLocalMode();
  // The desktop app's local account is signed in automatically.
  useEffect(() => {
    if (localMode) router.replace("/dashboard");
  }, [localMode, router]);
  if (localMode) return null;

  return showSignIn ? (
    <SignInForm onSwitchToSignUp={() => setShowSignIn(false)} />
  ) : (
    <SignUpForm onSwitchToSignIn={() => setShowSignIn(true)} />
  );
}
