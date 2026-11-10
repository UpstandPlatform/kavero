import { TEMPLATES } from "@Kavero/catalog-engine";

import { TemplatePreview } from "@/modules/catalog/template-preview";

const featured = TEMPLATES.find((template) => template.id === "dark-luxury") ?? TEMPLATES[0]!;

/** A lightweight, stable product preview: no client animation or remote media required. */
export function HomePreview() {
  return (
    <div className="relative mx-auto w-full max-w-2xl" aria-label="Kavero catalog editor preview" role="img">
      <div className="overflow-hidden rounded-2xl border bg-card shadow-xl shadow-foreground/5">
        <div className="flex h-11 items-center gap-3 border-b px-3 sm:px-4">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <span className="size-2 rounded-full bg-muted-foreground/25" />
            <span className="size-2 rounded-full bg-muted-foreground/25" />
            <span className="size-2 rounded-full bg-muted-foreground/25" />
          </div>
          <div className="h-5 min-w-0 flex-1 rounded-md bg-muted px-2 text-[10px] leading-5 text-muted-foreground">Autumn collection</div>
          <span className="hidden text-[10px] text-muted-foreground sm:inline">Saved</span>
          <span className="size-6 rounded-full bg-primary/15" aria-hidden="true" />
        </div>

        <div className="grid grid-cols-[62px_minmax(0,1fr)] sm:grid-cols-[82px_minmax(0,1fr)_112px]">
          <div className="grid content-start gap-3 border-e bg-muted/30 p-2 sm:p-3">
            {[0, 1, 2].map((slide, index) => (
              <div key={slide} className="grid gap-1">
                <span className="text-[9px] text-muted-foreground">0{slide + 1}</span>
                <TemplatePreview theme={featured.theme} layout={featured.layout} title={featured.name} className={index === 0 ? "ring-2 ring-primary" : "opacity-70"} />
              </div>
            ))}
            <div className="grid aspect-video place-items-center rounded-md border border-dashed text-xs text-muted-foreground">+</div>
          </div>

          <div className="grid min-h-[260px] place-items-center bg-muted/40 p-4 sm:min-h-[360px] sm:p-7">
            <div className="w-full max-w-xl rounded-md border bg-background p-[4%] shadow-md">
              <div className="grid aspect-video grid-cols-[1.15fr_0.85fr] overflow-hidden rounded-sm" style={{ backgroundColor: featured.theme.colors.background }}>
                <div className="flex flex-col justify-between p-[8%]" style={{ color: featured.theme.colors.text }}>
                  <div className="h-[3%] w-[36%] rounded-full" style={{ backgroundColor: featured.theme.colors.primary }} />
                  <div className="grid gap-[5%]">
                    <span className="text-[clamp(10px,2vw,20px)] font-semibold leading-none">A quieter kind<br />of luxury.</span>
                    <span className="text-[clamp(6px,0.8vw,9px)] opacity-70">AUTUMN · 2027</span>
                  </div>
                  <span className="text-[clamp(6px,0.75vw,8px)] opacity-70">THE NEW LEATHER COLLECTION</span>
                </div>
                <div className="relative overflow-hidden" style={{ backgroundColor: featured.theme.colors.accent }}>
                  <div className="absolute inset-y-[12%] start-[20%] w-[60%] rounded-[45%] border-[clamp(4px,1vw,12px)]" style={{ borderColor: featured.theme.colors.primary, backgroundColor: featured.theme.colors.background }} />
                  <div className="absolute end-[10%] bottom-[8%] size-[34%] rounded-full opacity-80" style={{ backgroundColor: featured.theme.colors.primary }} />
                </div>
              </div>
            </div>
          </div>

          <aside className="hidden content-start gap-3 border-s p-3 sm:grid">
            <div className="h-2 w-16 rounded-full bg-muted" />
            <div className="grid gap-1.5">
              <span className="h-1.5 w-10 rounded-full bg-muted" />
              <div className="flex gap-1.5">
                {["background", "text", "primary", "accent"].map((key) => (
                  <span key={key} className="size-4 rounded-full border bg-muted" style={{ backgroundColor: featured.theme.colors[key as keyof typeof featured.theme.colors] }} />
                ))}
              </div>
            </div>
            <div className="grid gap-2 rounded-lg border p-2">
              <span className="h-1.5 w-12 rounded-full bg-muted" />
              <span className="h-1.5 w-16 rounded-full bg-muted" />
              <span className="h-1.5 w-10 rounded-full bg-muted" />
            </div>
            <span className="mt-1 h-8 rounded-lg bg-primary/10" />
          </aside>
        </div>
      </div>
      <div className="absolute -bottom-4 end-2 rounded-xl border bg-background px-3 py-2 shadow-lg sm:end-6">
        <p className="text-xs font-medium">One design, every format</p>
        <p className="text-[10px] text-muted-foreground">PDF · PowerPoint · video · web</p>
      </div>
    </div>
  );
}
