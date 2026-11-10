import { cn } from "@Kavero/ui/lib/utils";

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
