import { HugeiconsIcon } from "@hugeicons/react";
import { BotIcon, Key02Icon, LayoutGridIcon, Logout01Icon, Plug01Icon, Refresh01Icon, Shield01Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { Button } from "@Kavero/ui/components/button";
import { Avatar, AvatarFallback, AvatarImage } from "@Kavero/ui/components/avatar";
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
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";
import { useDesktop } from "@/lib/desktop";

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]?.toUpperCase()).join("") || "?";
}

export default function UserMenu() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, isPending } = authClient.useSession();
  // Desktop local mode signs in automatically: no sign-in or sign-out.
  const desktop = useDesktop();
  const localMode = desktop?.localMode === true;

  if (isPending || (localMode && !session)) return <Skeleton className="size-8 rounded-full" />;

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
        render={<button type="button" aria-label="Account menu" className="rounded-full outline-none ring-offset-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-ring" />}
      >
        <Avatar className="size-8 bg-primary text-xs font-semibold text-primary-foreground">
          {session.user.image && <AvatarImage src={session.user.image} alt="" loading="eager" />}
          <AvatarFallback className="bg-primary text-primary-foreground">{initials(session.user.name)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center gap-3">
            <Avatar className="size-9">
              {session.user.image && <AvatarImage src={session.user.image} alt="" loading="eager" />}
              <AvatarFallback>{initials(session.user.name)}</AvatarFallback>
            </Avatar>
            <span className="grid min-w-0 flex-1">
              <span className="truncate font-medium text-foreground">{session.user.name}</span>
              <span className="truncate font-normal">{localMode ? "Local account on this computer" : session.user.email}</span>
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={go("/dashboard" as Route)}><HugeiconsIcon icon={LayoutGridIcon} /> Catalogs</DropdownMenuItem>
          <DropdownMenuItem onClick={go("/settings#workspaces" as Route)}><HugeiconsIcon icon={UserGroupIcon} /> Workspaces</DropdownMenuItem>
          <DropdownMenuItem onClick={go("/settings#ai" as Route)}><HugeiconsIcon icon={BotIcon} /> AI model</DropdownMenuItem>
          <DropdownMenuItem onClick={go("/settings#api-keys" as Route)}><HugeiconsIcon icon={Key02Icon} /> API keys &amp; MCP</DropdownMenuItem>
          <DropdownMenuItem onClick={go("/settings#connections" as Route)}><HugeiconsIcon icon={Plug01Icon} /> Product sources</DropdownMenuItem>
          {session.user.role === "admin" && <DropdownMenuItem onClick={go("/admin" as Route)}><HugeiconsIcon icon={Shield01Icon} /> Admin</DropdownMenuItem>}
          {desktop?.updates && <DropdownMenuItem onClick={() => void desktop.updates!.check()}><HugeiconsIcon icon={Refresh01Icon} /> Check for updates</DropdownMenuItem>}
        </DropdownMenuGroup>
        {!localMode && (<>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => authClient.signOut({ fetchOptions: { onSuccess: () => router.push("/") } })}
        >
          <HugeiconsIcon icon={Logout01Icon} /> Sign out
        </DropdownMenuItem>
        </>)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
