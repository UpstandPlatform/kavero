import { HugeiconsIcon } from "@hugeicons/react";
import { BotIcon, CloudIcon, CursorPointer02Icon, FileDownloadIcon, HardDriveIcon, Layout01Icon, PackageSearchIcon, Presentation01Icon, SparklesIcon } from "@hugeicons/core-free-icons";
import { Badge } from "@Kavero/ui/components/badge";
import { Button } from "@Kavero/ui/components/button";
import type { Metadata } from "next";
import Link from "next/link";

import { LandingPrompt } from "@/modules/chat/landing-chat";
import { TEMPLATES } from "@Kavero/catalog-engine";
import { TemplatePreview } from "@/modules/catalog/template-preview";

import { HomePreview } from "./home-preview";

export const metadata: Metadata = {
  title: "Kavero — product catalogs and presentations, from data to beautiful",
  description: "Design product catalogs and presentations, then share them as PowerPoint, PDF, video or an interactive website. Start locally with no account required.",
};

const FEATURES = [
  { icon: CursorPointer02Icon, title: "A real visual editor", text: "Arrange text, images, product cards and grids on a canvas. Fine-tune every slide, then preview the complete deck." },
  { icon: Layout01Icon, title: "Ready-to-edit designs", text: "Start with a curated template or a reusable slide layout. Change the typography, colors and page format whenever you need." },
  { icon: PackageSearchIcon, title: "Your product data, in one place", text: "Add products by hand, paste a list, or connect an inventory source over MCP." },
  { icon: FileDownloadIcon, title: "Share it your way", text: "Export an editable PowerPoint, a print-ready PDF, a video, or a responsive website." },
  { icon: HardDriveIcon, title: "Private by default", text: "Work locally in your browser without an account. Sign in when you want cloud sync and workspaces." },
  { icon: BotIcon, title: "AI when it helps", text: "Generate a first draft from a brief, connect your own model, or let an agent build through MCP." },
];

const featuredTemplates = TEMPLATES.filter((template) => ["minimal", "dark-luxury", "studio"].includes(template.id));

export default function Home() {
  return (
    <main className="w-full">
      <section className="mx-auto grid w-full max-w-7xl items-center gap-8 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[0.92fr_1.08fr] lg:gap-10 lg:py-14">
        <div className="grid content-center gap-6">
          <Badge variant="outline" className="w-fit rounded-full px-3 py-1 text-xs font-normal">
            <HugeiconsIcon icon={Layout01Icon} data-icon="inline-start" /> Product catalogs · presentations · websites
          </Badge>
          <div className="grid gap-4">
            <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-5xl">
              Turn product data into a story people remember.
            </h1>
            <p className="max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Design a product catalog or presentation in one place. Refine every slide, then share it as PowerPoint, PDF, video or a website.
            </p>
          </div>

          <LandingPrompt />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <Link href="/dashboard" className="inline-flex items-center gap-2 font-medium underline-offset-4 hover:underline">
              <HugeiconsIcon icon={Presentation01Icon} /> Open your catalog workspace
            </Link>
            <span className="text-xs text-muted-foreground">No account needed to get started.</span>
          </div>
        </div>

        <HomePreview />
      </section>

      <section className="border-y bg-muted/30">
        <div className="mx-auto grid w-full max-w-7xl gap-3 px-4 py-5 sm:grid-cols-3 sm:px-6 sm:py-6">
          <Link href="/dashboard?new=1&template=blank" className="group flex items-center gap-3 rounded-xl border bg-background p-4 transition-colors hover:bg-muted/50">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-xl text-muted-foreground">+</span>
            <span className="grid gap-0.5"><span className="text-sm font-medium">Start with a blank catalog</span><span className="text-xs text-muted-foreground">Build it from the first slide up.</span></span>
          </Link>
          <Link href="/dashboard?templates=all" className="group flex items-center gap-3 rounded-xl border bg-background p-4 transition-colors hover:bg-muted/50">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><HugeiconsIcon icon={Layout01Icon} /></span>
            <span className="grid gap-0.5"><span className="text-sm font-medium">Browse the design gallery</span><span className="text-xs text-muted-foreground">Start with a template made for your work.</span></span>
          </Link>
          <Link href="/dashboard?generate=1" className="group flex items-center gap-3 rounded-xl border bg-background p-4 transition-colors hover:bg-muted/50">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><HugeiconsIcon icon={SparklesIcon} /></span>
            <span className="grid gap-0.5"><span className="text-sm font-medium">Create from a brief</span><span className="text-xs text-muted-foreground">Let Kavero shape a first draft.</span></span>
          </Link>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 sm:py-18">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-1.5">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">A strong start for any story</h2>
            <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">Choose a visual direction now. You can adjust every slide after the catalog opens.</p>
          </div>
          <Link href="/dashboard?templates=all" className="text-sm font-medium underline-offset-4 hover:underline">See all designs</Link>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {featuredTemplates.map((template) => (
            <Link key={template.id} href={`/dashboard?new=1&template=${template.id}`} className="group grid gap-3 rounded-xl border bg-card p-3 transition-shadow hover:shadow-md">
              <TemplatePreview theme={template.theme} layout={template.layout} title={template.name} className="rounded-lg transition-transform group-hover:scale-[1.01]" />
              <span className="flex items-start justify-between gap-3 px-1">
                <span className="grid min-w-0 gap-0.5">
                  <span className="truncate text-sm font-medium">{template.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{template.description}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{template.category}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="border-y bg-muted/30">
        <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 sm:py-18">
          <div className="mb-8 max-w-2xl">
            <p className="mb-2 text-sm font-medium text-primary">Made for the whole process</p>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">From first draft to final delivery.</h2>
          </div>
          <div className="grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <article key={title} className="grid content-start gap-2 bg-background p-5 sm:p-6">
                <HugeiconsIcon icon={Icon} className="size-5 text-primary" aria-hidden />
                <h3 className="font-medium">{title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-12 sm:px-6 sm:py-16 md:grid-cols-[1fr_auto] md:items-center">
        <div className="grid gap-2">
          <h2 className="text-2xl font-semibold tracking-tight">Ready to make something worth sharing?</h2>
          <p className="text-sm text-muted-foreground">Start locally, then bring in your team when you need to.</p>
        </div>
        <Link href="/dashboard"><Button size="lg">Open Kavero <HugeiconsIcon icon={Presentation01Icon} data-icon="inline-end" /></Button></Link>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-muted-foreground sm:px-6">
          <span>Kavero · Product stories, thoughtfully made.</span>
          <span className="flex items-center gap-4"><span className="inline-flex items-center gap-1.5"><HugeiconsIcon icon={CloudIcon} /> Local-first by design</span><span className="hidden sm:inline">Docs: user guide · MCP · deployment</span></span>
        </div>
      </footer>
    </main>
  );
}
