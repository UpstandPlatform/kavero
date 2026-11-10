"use client";

import { Button } from "@Kavero/ui/components/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@Kavero/ui/components/hover-card";
import { cn } from "@Kavero/ui/lib/utils";
import type { ReactNode } from "react";

export interface RailTool {
  id: string;
  icon: ReactNode;
  label: string;
  /** One or two sentences: what it does and when to use it. */
  description: string;
  shortcut?: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}

/** One icon button of the vertical tool rail; hovering it explains what it does. */
export function RailButton({ tool }: { tool: RailTool }) {
  return (
    <HoverCard>
      <HoverCardTrigger
        delay={250}
        closeDelay={80}
        render={
          <Button
            variant={tool.active ? "secondary" : "ghost"}
            size="icon"
            aria-label={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
            aria-pressed={tool.active}
            disabled={tool.disabled}
            onClick={tool.onClick}
            className={cn("size-9", tool.active && "text-foreground")}
          />
        }
      >
        {tool.icon}
      </HoverCardTrigger>
      <HoverCardContent side="right" align="start" sideOffset={8} className="w-60">
        <p className="flex items-center justify-between gap-2 font-medium">
          {tool.label}
          {tool.shortcut && <kbd className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{tool.shortcut}</kbd>}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{tool.description}</p>
      </HoverCardContent>
    </HoverCard>
  );
}

/** Vertical rail on the left edge of the editor: groups of tools separated by dividers, extras at the bottom. */
export function ToolRail({ groups, bottom }: { groups: RailTool[][]; bottom?: ReactNode }) {
  return (
    <nav aria-label="Insert and tools" className="flex w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r bg-background py-2">
      {groups.map((group, i) => (
        <div key={i} className={cn("flex flex-col items-center gap-1", i > 0 && "mt-1 border-t pt-2")}>
          {group.map((t) => <RailButton key={t.id} tool={t} />)}
        </div>
      ))}
      {bottom && <div className="mt-auto flex flex-col items-center gap-1 border-t pt-2">{bottom}</div>}
    </nav>
  );
}
