import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle02Icon, Layout01Icon, Presentation01Icon, SparklesIcon } from "@hugeicons/core-free-icons";
import { Avatar, AvatarFallback } from "@Kavero/ui/components/avatar";
import { Badge } from "@Kavero/ui/components/badge";
import { Button } from "@Kavero/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@Kavero/ui/components/card";
import { Input } from "@Kavero/ui/components/input";
import { Separator } from "@Kavero/ui/components/separator";
import { TEMPLATES } from "@Kavero/catalog-engine";

import { TemplatePreview } from "@/modules/catalog/template-preview";

const featured = TEMPLATES.find((template) => template.id === "dark-luxury") ?? TEMPLATES[0]!;

/** Product-facing preview composed from the same controls and cards used by the editor. */
export function HomePreview() {
  return (
    <div className="relative mx-auto w-full max-w-5xl" aria-label="Kavero catalog editor preview" role="img">
      <div className="overflow-hidden rounded-2xl border bg-card shadow-xl shadow-foreground/5">
        <header className="flex min-h-12 flex-wrap items-center gap-2 border-b bg-background px-3 py-2 sm:px-4">
          <div className="flex items-center gap-1" aria-hidden="true">
            <span className="size-2 rounded-full bg-muted-foreground/25" />
            <span className="size-2 rounded-full bg-muted-foreground/25" />
            <span className="size-2 rounded-full bg-muted-foreground/25" />
          </div>
          <Input aria-label="Catalog title" readOnly value="Autumn collection" className="h-8 min-w-36 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0" />
          <Badge variant="secondary" className="gap-1"><HugeiconsIcon icon={CheckmarkCircle02Icon} /> Saved</Badge>
          <Button variant="outline" size="sm"><HugeiconsIcon icon={SparklesIcon} data-icon="inline-start" /> Generate</Button>
          <Button size="sm"><HugeiconsIcon icon={Presentation01Icon} data-icon="inline-start" /> Present</Button>
          <Avatar className="size-8 bg-primary/10 text-xs font-semibold text-primary"><AvatarFallback className="bg-primary/10 text-primary">M</AvatarFallback></Avatar>
        </header>

        <div className="grid min-h-80 grid-cols-[68px_minmax(0,1fr)] sm:grid-cols-[92px_minmax(0,1fr)_220px]">
          <aside className="grid content-start gap-3 border-e bg-muted/20 p-2 sm:p-3">
            <div className="flex items-center justify-between gap-1"><span className="text-[10px] font-medium text-muted-foreground">Slides</span><Button variant="ghost" size="icon-xs" aria-label="Add slide">+</Button></div>
            {[0, 1, 2].map((slide, index) => (
              <div key={slide} className="grid gap-1">
                <span className="text-[10px] font-medium text-muted-foreground">0{slide + 1}</span>
                <TemplatePreview theme={featured.theme} layout={featured.layout} title={featured.name} className={index === 0 ? "rounded-md ring-2 ring-primary" : "rounded-md opacity-70"} />
              </div>
            ))}
            <Button variant="outline" size="sm" className="border-dashed text-muted-foreground">+ New slide</Button>
          </aside>

          <main className="grid min-w-0 content-center gap-3 bg-muted/35 p-3 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
              <span>Slide 1 of 4</span>
              <span className="flex items-center gap-1"><Button variant="ghost" size="icon-xs" aria-label="Undo">↶</Button><Button variant="ghost" size="icon-xs" aria-label="Redo">↷</Button><Badge variant="outline">100%</Badge></span>
            </div>
            <div className="mx-auto w-full max-w-3xl rounded-lg border bg-background p-2 shadow-lg sm:p-3">
              <div className="relative aspect-video overflow-hidden rounded-sm" style={{ backgroundColor: featured.theme.colors.background }}>
                <div className="absolute inset-y-0 start-0 flex w-[58%] flex-col justify-between p-[7%]" style={{ color: featured.theme.colors.text }}>
                  <Badge variant="outline" className="w-fit border-0 px-0 text-[clamp(6px,0.75vw,9px)]" style={{ color: featured.theme.colors.primary }}>AUTUMN · 2027</Badge>
                  <div className="grid gap-[5%]">
                    <span className="text-[clamp(12px,2.2vw,28px)] font-semibold leading-[1.02]">A quieter kind<br />of luxury.</span>
                    <span className="max-w-48 text-[clamp(7px,0.9vw,11px)] leading-relaxed opacity-70">Thoughtful materials and considered silhouettes for the season.</span>
                  </div>
                  <span className="text-[clamp(6px,0.75vw,9px)] font-medium tracking-wide opacity-70">THE NEW LEATHER COLLECTION</span>
                </div>
                <div className="absolute inset-y-0 end-0 w-[42%] overflow-hidden" style={{ backgroundColor: featured.theme.colors.accent }}>
                  <div className="absolute inset-y-[12%] start-[22%] w-[58%] rounded-[45%] border-[clamp(5px,1vw,12px)]" style={{ borderColor: featured.theme.colors.primary, backgroundColor: featured.theme.colors.background }} />
                  <div className="absolute end-[11%] bottom-[8%] size-[34%] rounded-full opacity-80" style={{ backgroundColor: featured.theme.colors.primary }} />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-center gap-2"><Button variant="outline" size="sm">‹ Previous</Button><Button variant="outline" size="sm">Next ›</Button></div>
          </main>

          <aside className="hidden border-s bg-background p-3 sm:grid sm:content-start sm:gap-3">
            <Card size="sm" className="gap-3 rounded-2xl shadow-none">
              <CardHeader className="gap-0.5 px-3 pb-0">
                <CardTitle className="text-xs">Design</CardTitle>
                <CardDescription className="text-[10px]">Selected slide</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 px-3 text-[10px]">
                <label className="grid gap-1">Layout<Button variant="outline" size="sm" className="justify-start font-normal"><HugeiconsIcon icon={Layout01Icon} /> Editorial cover</Button></label>
                <Separator />
                <span className="font-medium">Theme colors</span>
                <div className="flex gap-2">
                  {["background", "text", "primary", "accent"].map((key) => (
                    <span key={key} className="size-5 rounded-full border" style={{ backgroundColor: featured.theme.colors[key as keyof typeof featured.theme.colors] }} />
                  ))}
                </div>
                <label className="grid gap-1">Heading font<Input readOnly value={featured.theme.fonts.heading} className="h-8 text-[10px]" /></label>
              </CardContent>
            </Card>
            <Button variant="outline" size="sm">Slide settings</Button>
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
