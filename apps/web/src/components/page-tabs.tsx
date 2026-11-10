"use client";

import type { ReactNode } from "react";

/** Underline tab strip used by Settings and Admin. Selection state stays with the caller. */
export function PageTabs<T extends string>({ tabs, value, onChange, label }: {
  tabs: { id: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap gap-1 border-b" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className="-mb-px inline-flex h-9 items-center gap-1.5 rounded-t-lg border-b-2 border-transparent px-3 text-sm font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-selected:border-foreground aria-selected:text-foreground [&_svg]:size-4"
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Section heading with a muted description and an optional action on the right. */
export function SectionHeader({ title, description, action, as: H = "h2" }: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  as?: "h2" | "h3";
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div className="grid gap-0.5">
        <H className="text-sm font-semibold">{title}</H>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
