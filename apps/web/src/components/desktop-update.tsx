"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Download01Icon, LinkSquare01Icon, Loading02Icon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@Kavero/ui/components/button";
import { useEffect, useState } from "react";

import { useDesktop, type UpdateStatus } from "@/lib/desktop";

/**
 * Desktop app only: tells the user when a new Kavero release is on GitHub and
 * walks them through Download → Restart to update. Hidden in browsers.
 */
export function DesktopUpdateNotice() {
  const desktop = useDesktop();
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    const updates = desktop?.updates;
    if (!updates) return;
    void updates.status().then(setStatus);
    return updates.onStatus(setStatus);
  }, [desktop]);

  const updates = desktop?.updates;
  if (!updates) return null;
  if (status.state !== "available" && status.state !== "downloading" && status.state !== "downloaded") return null;
  if (status.state === "available" && dismissed === status.version) return null;

  return (
    <div role="status" aria-live="polite" className="fixed end-4 bottom-4 z-50 w-80 rounded-xl border bg-popover p-4 text-sm text-popover-foreground shadow-lg">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {status.state === "downloaded" ? `Kavero ${status.version} is ready` : `Kavero ${status.version} is available`}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {status.state === "available" && `You have ${desktop.version}.`}
            {status.state === "downloading" && `Downloading… ${status.percent}%`}
            {status.state === "downloaded" && "Restart to finish updating. Your work is saved."}
          </p>
        </div>
        {status.state === "available" && (
          <Button variant="ghost" size="icon-sm" aria-label="Remind me later" onClick={() => setDismissed(status.version)}><HugeiconsIcon icon={Cancel01Icon} /></Button>
        )}
      </div>
      {status.state === "downloading" && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={status.percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${status.percent}%` }} />
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        {status.state === "available" && <Button size="sm" onClick={() => void updates.download()}><HugeiconsIcon icon={Download01Icon} /> Download</Button>}
        {status.state === "downloading" && <Button size="sm" disabled><HugeiconsIcon icon={Loading02Icon} className="animate-spin" /> Downloading</Button>}
        {status.state === "downloaded" && <Button size="sm" onClick={() => void updates.install()}><HugeiconsIcon icon={Refresh01Icon} /> Restart to update</Button>}
        <a href={status.releaseUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          What&apos;s new <HugeiconsIcon icon={LinkSquare01Icon} className="size-3" />
        </a>
      </div>
    </div>
  );
}
