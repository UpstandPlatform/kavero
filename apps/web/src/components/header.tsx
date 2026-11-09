"use client";
import { Button } from "@Kavero/ui/components/button";
import { cn } from "@Kavero/ui/lib/utils";
import { LayoutGrid, Menu, Plus, Settings, Sparkles, X } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";

import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

/** The Kavero mark: two stacked slides. */
export function KaveroLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-6", className)} aria-hidden>
      <rect x="2" y="6" width="15" height="12" rx="3" className="fill-primary/30" />
      <rect x="7" y="3" width="15" height="12" rx="3" className="fill-primary" />
      <path d="M12 6.5v5M12 9l3.2-2.5M12 9l3.2 2.5" className="stroke-primary-foreground" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </svg>
  );
}

const LINKS = [
  { to: "/dashboard", label: "Catalogs", icon: LayoutGrid },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export default function Header() {
  const pathname = usePathname();
  const { data: session } = authClient.useSession();
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

  /** On the dashboard the buttons open its dialogs directly; elsewhere they deep-link. */
  const dashboardAction = (action: "new" | "generate") => (e: React.MouseEvent) => {
    if (pathname !== "/dashboard") return;
    e.preventDefault();
    window.dispatchEvent(new CustomEvent("kavero:dashboard", { detail: action }));
  };
  const active = (to: string) => pathname === to || pathname.startsWith(`${to}/`);
  const navLink = (to: Route, label: string, Icon: typeof LayoutGrid, mobile = false) => (
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
      <Icon className="size-4" /> {label}
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
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden items-center gap-2 md:flex">
            <Link href="/dashboard?generate=1" onClick={dashboardAction("generate")}>
              <Button variant="outline" size="sm"><Sparkles /> Generate</Button>
            </Link>
            <Link href="/dashboard?new=1" onClick={dashboardAction("new")}>
              <Button size="sm"><Plus /> New catalog</Button>
            </Link>
          </div>
          <ModeToggle />
          <UserMenu />
          <Button variant="ghost" size="icon" className="sm:hidden" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? <X /> : <Menu />}
          </Button>
        </div>
      </div>

      {open && (
        <nav className="grid gap-1 border-t px-4 py-3 sm:hidden" aria-label="Main">
          {navLink("/", "Home", Sparkles, true)}
          {LINKS.map((l) => navLink(l.to, l.label, l.icon, true))}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Link href="/dashboard?generate=1" onClick={dashboardAction("generate")}><Button variant="outline" className="w-full"><Sparkles /> Generate</Button></Link>
            <Link href="/dashboard?new=1" onClick={dashboardAction("new")}><Button className="w-full"><Plus /> New catalog</Button></Link>
          </div>
          {!session && <p className="mt-2 text-xs text-muted-foreground">Catalogs are saved on this device. Sign in to sync them and publish.</p>}
        </nav>
      )}
    </header>
  );
}
