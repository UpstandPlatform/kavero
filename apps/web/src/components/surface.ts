/**
 * Shared surface classes so every screen uses the same radius scale:
 * controls (Button, Input, NativeSelect) are rounded-lg; anything that groups content
 * (panels, lists, tables, callouts, code blocks, dialogs, empty states) is rounded-xl.
 */
export const surface = {
  /** A bordered group of fields or content (form box, info card). */
  panel: "rounded-xl border bg-card p-4",
  /** A bordered list with dividers. Rows set their own padding (p-3). */
  list: "divide-y overflow-hidden rounded-xl border bg-card",
  /** Wrapper for a <table>. */
  table: "overflow-x-auto rounded-xl border bg-card",
  /** Table head row. */
  thead: "border-b bg-muted/40 text-xs text-muted-foreground",
  /** Something the user must act on now (one-time secret, invite link). */
  warning: "rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 dark:bg-amber-500/10",
  /** Destructive area or error message. */
  danger: "rounded-xl border border-destructive/40 bg-destructive/5 p-4 dark:bg-destructive/10",
  /** Neutral, quiet info box. */
  muted: "rounded-xl border bg-muted/40 p-3",
  /** Dashed placeholder for "nothing here yet". */
  empty: "rounded-xl border border-dashed",
  /** Inline code chip inside running text. */
  code: "rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.9em]",
  /** Selectable tile (template picker, workspace list). */
  option: "rounded-lg border bg-card text-start transition-colors hover:bg-muted aria-pressed:border-primary aria-pressed:ring-1 aria-pressed:ring-primary",
} as const;
