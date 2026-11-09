import { Button } from "@Kavero/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@Kavero/ui/components/dropdown-menu";
import { Skeleton } from "@Kavero/ui/components/skeleton";
import { Bot, KeyRound, LayoutGrid, LogOut, Plug, Shield, Users } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]?.toUpperCase()).join("") || "?";
}

export default function UserMenu() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, isPending } = authClient.useSession();

  if (isPending) return <Skeleton className="size-8 rounded-full" />;

  if (!session) {
    return (
      <Link href="/login">
        <Button variant="outline" size="sm">Sign in</Button>
      </Link>
    );
  }

  // Router navigation doesn't fire "hashchange", so switch Settings tabs via the hash directly.
  const go = (href: Route) => () => {
    const [path, hash] = href.split("#");
    if (hash && path === pathname) window.location.hash = hash;
    else router.push(href);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<button type="button" aria-label="Account menu" className="flex size-8 items-center justify-center overflow-hidden rounded-full bg-primary text-xs font-semibold text-primary-foreground outline-none ring-offset-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-ring" />}
      >
        {session.user.image ? <img src={session.user.image} alt="" className="size-full object-cover" /> : initials(session.user.name)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="grid">
            <span className="truncate font-medium text-foreground">{session.user.name}</span>
            <span className="truncate font-normal">{session.user.email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={go("/dashboard" as Route)}><LayoutGrid /> Catalogs</DropdownMenuItem>
          <DropdownMenuItem onClick={go("/settings#workspaces" as Route)}><Users /> Workspaces</DropdownMenuItem>
          <DropdownMenuItem onClick={go("/settings#ai" as Route)}><Bot /> AI model</DropdownMenuItem>
          <DropdownMenuItem onClick={go("/settings#tokens" as Route)}><KeyRound /> API tokens &amp; MCP</DropdownMenuItem>
          <DropdownMenuItem onClick={go("/settings#connections" as Route)}><Plug /> Product sources</DropdownMenuItem>
          {session.user.role === "admin" && <DropdownMenuItem onClick={go("/admin" as Route)}><Shield /> Admin</DropdownMenuItem>}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => authClient.signOut({ fetchOptions: { onSuccess: () => router.push("/") } })}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
