"use client";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Cancel01Icon, LayoutGridIcon, Menu01Icon, Settings01Icon, Shield01Icon, SparklesIcon } from "@hugeicons/core-free-icons";
import { Button } from "@Kavero/ui/components/button";
import { cn } from "@Kavero/ui/lib/utils";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";

import { KaveroLogo } from "./kavero-logo";
import UserMenu from "./user-menu";

const LINKS = [
  { to: "/dashboard", label: "Catalogs", icon: LayoutGridIcon },
  { to: "/settings", label: "Settings", icon: Settings01Icon },
] as const;

export default function Header() {
  const pathname = usePathname();
  const { data: session } = authClient.useSession();
  const isAdmin = session?.user.role === "admin";
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // The editor, public catalogs and the render page are full-screen.
  if (pathname.startsWith("/editor/") || pathname.startsWith("/c/") || pathname === "/render") return null;

  /** On the dashboard the button opens its dialog directly; elsewhere it deep-links. */
  const dashboardAction = () => (e: React.MouseEvent) => {
    if (pathname !== "/dashboard") return;
    e.preventDefault();
    window.dispatchEvent(new CustomEvent("kavero:dashboard", { detail: "new" }));
  };
  const onDashboard = pathname === "/dashboard";
  const showCreateAction = !onDashboard && pathname !== "/login";
  const active = (to: string) => pathname === to || pathname.startsWith(`${to}/`);
  const navLink = (to: Route, label: string, Icon: typeof LayoutGridIcon, mobile = false) => (
    <Link
      key={to}
      href={to}
      aria-current={active(to) ? "page" : undefined}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg px-3 text-sm transition-colors",
        mobile ? "h-10" : "h-8",
        active(to) ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      <HugeiconsIcon icon={Icon} className="size-4" /> {label}
    </Link>
  );

  return (
    <header className={cn("sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70", scrolled ? "shadow-sm" : "border-transparent sm:border-border")}>
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4">
        <Link href="/" className="mr-2 flex items-center gap-2 font-semibold tracking-tight" aria-label="Kavero home">
          <KaveroLogo />
          <span>Kavero</span>
        </Link>

        <nav className="hidden items-center gap-1 sm:flex" aria-label="Main">
          {LINKS.map((l) => navLink(l.to, l.label, l.icon))}
          {isAdmin && navLink("/admin" as Route, "Admin", Shield01Icon)}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {/* The dashboard has its own create controls; keep this action out of the auth flow. */}
          {showCreateAction && <div className="hidden items-center gap-2 md:flex">
            <Link href="/dashboard?new=1" onClick={dashboardAction()}>
              <Button size="sm"><HugeiconsIcon icon={Add01Icon} /> New catalog</Button>
            </Link>
          </div>}
          <UserMenu />
          <Button variant="ghost" size="icon" className="sm:hidden" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? <HugeiconsIcon icon={Cancel01Icon} /> : <HugeiconsIcon icon={Menu01Icon} />}
          </Button>
        </div>
      </div>

      {open && (
        <nav className="grid gap-1 border-t px-4 py-3 sm:hidden" aria-label="Main">
          {navLink("/", "Home", SparklesIcon, true)}
          {LINKS.map((l) => navLink(l.to, l.label, l.icon, true))}
          {isAdmin && navLink("/admin" as Route, "Admin", Shield01Icon, true)}
          {showCreateAction && <div className="mt-2">
            <Link href="/dashboard?new=1" onClick={dashboardAction()}><Button className="w-full"><HugeiconsIcon icon={Add01Icon} /> New catalog</Button></Link>
          </div>}
          {!session && <p className="mt-2 text-xs text-muted-foreground">Catalogs are saved on this device. Sign in to sync them and publish.</p>}
        </nav>
      )}
    </header>
  );
}
