"use client";

import { Button } from "@Kavero/ui/components/button";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";

import { SHORTCUTS, kbd } from "./editor-actions";

/** Every editor shortcut, grouped. Opened with "?" or the keyboard button. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  const groups = [...new Set(SHORTCUTS.map((s) => s.group))];
  return (
    <dialog ref={ref} onClose={onClose} className="m-auto w-[min(760px,calc(100vw-32px))] overflow-hidden rounded-xl border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50">
      <div className="flex items-center justify-between border-b px-5 py-3">
        <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close"><X /></Button>
      </div>
      <div className="grid max-h-[75vh] gap-6 overflow-y-auto p-5 text-xs sm:grid-cols-2">
        {groups.map((g) => (
          <section key={g}>
            <h3 className="mb-2 font-semibold text-muted-foreground">{g}</h3>
            <dl className="grid gap-1.5">
              {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                <div key={s.keys + s.label} className="flex items-center justify-between gap-4">
                  <dt>{s.label}</dt>
                  <dd><kbd className="rounded border bg-muted px-1.5 py-0.5 font-sans text-[11px] whitespace-nowrap">{kbd(s.keys)}</kbd></dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </dialog>
  );
}
