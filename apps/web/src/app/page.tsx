import { HugeiconsIcon } from "@hugeicons/react";
import { BotIcon, CursorPointer02Icon, FileDownloadIcon, HardDriveIcon, Layout01Icon, PackageSearchIcon, Presentation01Icon, SparklesIcon } from "@hugeicons/core-free-icons";
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
      <section className="relative isolate overflow-hidden border-b">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute inset-x-0 top-28 mx-auto h-72 max-w-4xl rounded-full bg-primary/10 blur-[110px] sm:h-96" />
          <div className="absolute -top-24 end-[8%] size-64 rounded-full bg-orange-300/10 blur-[100px] dark:bg-primary/10" />
          <div className="absolute top-72 start-[4%] size-56 rounded-full bg-amber-200/10 blur-[100px] dark:bg-primary/5" />
        </div>

        <div className="mx-auto w-full max-w-7xl px-4 pb-14 pt-12 sm:px-6 sm:pb-16 sm:pt-16 lg:pt-20">
          <div className="mx-auto grid max-w-4xl justify-items-center gap-5 text-center sm:gap-6">
            <div className="grid justify-items-center gap-3 sm:gap-4">
              <h1 className="max-w-4xl text-4xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
                Turn product data into a <span className="text-primary">story people remember.</span>
              </h1>
              <p className="max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                Design a product catalog or presentation in one place. Refine every slide, then share it as PowerPoint, PDF, video or a website.
              </p>
            </div>

            <div className="w-full max-w-3xl pt-1 sm:pt-2">
              <LandingPrompt />
            </div>

            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm">
              <Link href="/dashboard" className="inline-flex items-center gap-2 font-medium underline-offset-4 hover:underline">
                <HugeiconsIcon icon={Presentation01Icon} /> Open your catalog workspace
              </Link>
              <span className="hidden text-muted-foreground sm:inline" aria-hidden="true">·</span>
              <span className="text-xs text-muted-foreground">No account needed to get started.</span>
            </div>
          </div>

          <div className="relative mx-auto mt-12 max-w-5xl sm:mt-16">
            <div aria-hidden="true" className="pointer-events-none absolute -inset-x-8 -inset-y-5 -z-10 rounded-[3rem] bg-primary/5 blur-3xl" />
            <HomePreview />
          </div>
        </div>
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
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-start gap-3 px-4 py-5 text-xs text-muted-foreground sm:px-6">
          <span>Kavero · Product stories, thoughtfully made.</span>
        </div>
      </footer>
    </main>
  );
}
