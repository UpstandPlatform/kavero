"use client";

import { PAGE_PRESETS, TEMPLATES, type CatalogDocument, type PagePreset } from "@Kavero/catalog-engine";
import { Button } from "@Kavero/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@Kavero/ui/components/dialog";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@Kavero/ui/components/field";
import { Input } from "@Kavero/ui/components/input";
import { RadioGroup, RadioGroupItem } from "@Kavero/ui/components/radio-group";
import { SimpleSelect } from "@Kavero/ui/components/simple-select";
import { Spinner } from "@Kavero/ui/components/spinner";
import { Textarea } from "@Kavero/ui/components/textarea";
import { useEffect, useState } from "react";

import { TemplatePreview, type TemplateLayout } from "./template-preview";

const PRESET_LABELS: Record<PagePreset, string> = {
  "16:9": "Widescreen 16:9",
  "4:3": "Standard 4:3",
  "a4-portrait": "A4 portrait",
  "a4-landscape": "A4 landscape",
  "letter-portrait": "US Letter portrait",
  square: "Square",
};

const BLANK_THEME: CatalogDocument["theme"] = {
  colors: {
    background: "#ffffff",
    text: "#171717",
    muted: "#737373",
    primary: "#171717",
    "on-primary": "#ffffff",
    accent: "#f3f4f6",
  },
  fonts: { heading: "Inter", body: "Inter" },
};

const STARTS: { id: string; name: string; description: string; layout: TemplateLayout; theme: CatalogDocument["theme"] }[] = [
  { id: "blank", name: "Blank", description: "A clean canvas to shape your way.", layout: "blank", theme: BLANK_THEME },
  ...TEMPLATES.map((template) => ({ ...template, layout: template.layout as TemplateLayout })),
];

export interface NewCatalogValues {
  title: string;
  description?: string;
  page: PagePreset;
  templateId: string;
}

export function NewCatalogDialog({
  open,
  onClose,
  onCreate,
  initialTemplateId = "minimal",
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (values: NewCatalogValues) => Promise<void>;
  initialTemplateId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [templateId, setTemplateId] = useState(initialTemplateId);

  useEffect(() => {
    if (open) setTemplateId(initialTemplateId);
  }, [open, initialTemplateId]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await onCreate({
        title: String(form.get("title")).trim() || "Untitled catalog",
        description: String(form.get("description") ?? "").trim() || undefined,
        page: form.get("page") as PagePreset,
        templateId,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && !busy && onClose()}>
      <DialogContent className="flex h-[min(780px,calc(100dvh-1rem))] max-h-[calc(100dvh-1rem)] w-[min(960px,calc(100vw-1rem))] max-w-none flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:h-[min(780px,calc(100dvh-2rem))] sm:max-h-[calc(100dvh-2rem)] sm:max-w-none">
        <DialogHeader className="shrink-0 border-b px-5 py-4 pe-14 sm:px-6">
          <DialogTitle className="text-base">New catalog</DialogTitle>
          <DialogDescription>Give it a name, choose a format, and start with a look that fits.</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[300px_minmax(0,1fr)] lg:overflow-hidden">
            <section aria-label="Catalog details" className="flex flex-col gap-5 border-b p-4 sm:p-6 lg:overflow-y-auto lg:border-b-0 lg:border-e">
              <FieldGroup className="gap-4">
                <Field>
                  <FieldLabel htmlFor="catalog-title">Title</FieldLabel>
                  <Input id="catalog-title" name="title" placeholder="Summer collection 2027" autoFocus required maxLength={160} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="catalog-description">Description <span className="font-normal text-muted-foreground">· optional</span></FieldLabel>
                  <Textarea id="catalog-description" name="description" rows={3} maxLength={1000} placeholder="A short note to help you remember what this catalog is for." />
                </Field>
              </FieldGroup>

              <FieldSet className="gap-3">
                <FieldLegend variant="label">Format</FieldLegend>
                <FieldGroup className="gap-3">
                  <Field>
                    <FieldLabel htmlFor="catalog-page">Page size</FieldLabel>
                    <SimpleSelect id="catalog-page" name="page" defaultValue="16:9" options={(Object.keys(PAGE_PRESETS) as PagePreset[]).map((preset) => ({ value: preset, label: PRESET_LABELS[preset] }))} />
                  </Field>
                </FieldGroup>
              </FieldSet>

              <p className="text-xs leading-relaxed text-muted-foreground">You can change the format and other catalog details later.</p>
            </section>

            <section aria-label="Choose a starting design" className="min-h-0 p-4 sm:p-6 lg:overflow-y-auto">
              <FieldSet className="gap-3">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <FieldLegend variant="label" className="mb-1">Start with a design</FieldLegend>
                    <p className="text-xs text-muted-foreground">Choose a starting point. Every slide stays editable.</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{STARTS.length} designs</span>
                </div>
                <RadioGroup
                  value={templateId}
                  onValueChange={(value) => setTemplateId(String(value))}
                  aria-label="Starting design"
                  className="grid grid-cols-2 gap-3 xl:grid-cols-3"
                >
                  {STARTS.map((design) => (
                    <label
                      key={design.id}
                      htmlFor={`start-${design.id}`}
                      className="group relative flex min-w-0 cursor-pointer flex-col gap-2 rounded-xl border bg-card p-2 text-start transition-colors hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:ring-2 has-[:checked]:ring-primary/15"
                    >
                      <RadioGroupItem id={`start-${design.id}`} value={design.id} aria-label={design.name} className="absolute top-3 end-3 z-10 bg-background/90" />
                      <TemplatePreview theme={design.theme} layout={design.layout} title={design.name} />
                      <span className="block truncate text-xs font-medium">{design.name}</span>
                      <span className="line-clamp-2 min-h-8 text-[11px] leading-snug text-muted-foreground">{design.description}</span>
                    </label>
                  ))}
                </RadioGroup>
              </FieldSet>
            </section>
          </div>

          <DialogFooter className="shrink-0 flex-row items-center justify-between gap-3 border-t px-4 py-3 sm:px-6">
            <p className="hidden text-xs text-muted-foreground sm:block">Your catalog is saved in this browser automatically.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy}>
                {busy && <Spinner data-icon="inline-start" />}
                {busy ? "Creating…" : "Create catalog"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
