"use client";

import { PAGE_PRESETS, TEMPLATES, type PagePreset } from "@Kavero/catalog-engine";
import { Button } from "@Kavero/ui/components/button";
import { Input } from "@Kavero/ui/components/input";
import { Label } from "@Kavero/ui/components/label";
import { Textarea } from "@Kavero/ui/components/textarea";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const PRESET_LABELS: Record<PagePreset, string> = {
  "16:9": "Widescreen 16:9",
  "4:3": "Standard 4:3",
  "a4-portrait": "A4 portrait",
  "a4-landscape": "A4 landscape",
  "letter-portrait": "US Letter portrait",
  square: "Square",
};

const STARTS = [
  { id: "blank", name: "Blank", description: "One empty cover slide.", swatch: ["#ffffff", "#111111"] },
  ...TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, swatch: [t.theme.colors.background!, t.theme.colors.primary!] })),
];

export interface NewCatalogValues {
  title: string;
  description?: string;
  page: PagePreset;
  language: string;
  currency: string;
  templateId: string;
}

export function NewCatalogDialog({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (v: NewCatalogValues) => Promise<void> }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [templateId, setTemplateId] = useState("minimal");

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await onCreate({
        title: String(f.get("title")).trim() || "Untitled catalog",
        description: String(f.get("description") ?? "").trim() || undefined,
        page: f.get("page") as PagePreset,
        language: String(f.get("language")),
        currency: String(f.get("currency")),
        templateId,
      });
    } finally {
      setBusy(false);
    }
  }

  const select = "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring";

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(640px,calc(100vw-32px))] overflow-hidden rounded-xl border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50"
    >
      <form onSubmit={submit} className="flex max-h-[85vh] flex-col">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-sm font-semibold">New catalog</h2>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>
        <div className="grid gap-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" placeholder="Summer Collection 2027" autoFocus required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" name="description" rows={2} placeholder="Optional" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="page">Page size</Label>
              <select id="page" name="page" defaultValue="16:9" className={select}>
                {(Object.keys(PAGE_PRESETS) as PagePreset[]).map((p) => (
                  <option key={p} value={p}>{PRESET_LABELS[p]}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="language">Language</Label>
              <select id="language" name="language" defaultValue="en" className={select}>
                {[["en", "English"], ["de", "German"], ["fr", "French"], ["es", "Spanish"], ["it", "Italian"], ["fa", "Persian"], ["ar", "Arabic"]].map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="currency">Currency</Label>
              <select id="currency" name="currency" defaultValue="USD" className={select}>
                {["USD", "EUR", "GBP", "CHF", "JPY", "AED", "IRR"].map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <fieldset className="grid gap-1.5">
            <legend className="mb-1.5 text-xs font-medium">Start from</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {STARTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setTemplateId(s.id)}
                  aria-pressed={templateId === s.id}
                  className="border p-2 text-left text-xs transition-colors hover:bg-muted aria-pressed:border-primary aria-pressed:ring-1 aria-pressed:ring-primary"
                >
                  <div className="mb-2 flex h-12 items-end gap-1 p-1.5" style={{ background: s.swatch[0] }}>
                    <div className="h-2 w-10" style={{ background: s.swatch[1] }} />
                  </div>
                  <div className="font-medium">{s.name}</div>
                  <div className="text-muted-foreground">{s.description}</div>
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create catalog"}</Button>
        </div>
      </form>
    </dialog>
  );
}
