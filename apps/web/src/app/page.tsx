import { HugeiconsIcon } from "@hugeicons/react";
import { BotIcon, CloudIcon, CursorPointer02Icon, FileDownloadIcon, Film01Icon, GlobeIcon, HardDriveIcon, Layout01Icon, PackageSearchIcon, Presentation01Icon, SparklesIcon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { Button } from "@Kavero/ui/components/button";
import type { Metadata } from "next";
import Link from "next/link";

import { LandingPrompt } from "@/modules/chat/landing-chat";

import { HomePreview } from "./home-preview";

export const metadata: Metadata = {
  title: "Kavero — product catalogs and presentations, from data to beautiful",
  description: "Build product catalogs with a visual editor and AI, import products over MCP, and publish them as PDF, PowerPoint, video or animated websites. Local-first, no account needed.",
};

const FEATURES = [
  { icon: CursorPointer02Icon, title: "Visual slide editor", text: "Drag, resize and rotate text, images, shapes, product cards and grids. Snapping, layers, undo/redo and autosave." },
  { icon: SparklesIcon, title: "AI generation", text: "Describe the catalog, add products, and get an editable, designed catalog. Ask AI to restyle a slide and approve the change." },
  { icon: PackageSearchIcon, title: "Products over MCP", text: "Connect your store or inventory as an MCP server and import products with photos, prices and specs." },
  { icon: BotIcon, title: "An MCP server for agents", text: "Claude and other agents can create, edit, preview, export and publish catalogs with 29 tools and scoped tokens." },
  { icon: Film01Icon, title: "Motion built in", text: "Entrance, emphasis and exit animations and slide transitions, rendered identically in preview, websites and MP4 video." },
  { icon: GlobeIcon, title: "Animated websites", text: "Publish to a link: public, unlisted, password-protected or private, with SEO, social previews and view counts." },
  { icon: FileDownloadIcon, title: "PDF and PowerPoint", text: "Print-ready PDFs with selectable text and PowerPoint files where text, shapes and images stay editable." },
  { icon: HardDriveIcon, title: "Local-first", text: "Works without an account. Catalogs live in your browser; export a .kavero file any time." },
  { icon: UserGroupIcon, title: "Cloud and workspaces", text: "Sign in to sync across devices and share catalogs with your team as owner, admin, editor or viewer." },
];

const MCP_CONFIG = `{
  "mcpServers": {
    "kavero": {
      "type": "http",
      "url": "https://your-kavero/api/mcp",
      "headers": { "Authorization": "Bearer kv_…" }
    }
  }
}`;

export default function Home() {
  return (
    <main className="w-full">
      {/* Hero */}
      <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 pt-16 pb-12 lg:grid-cols-[1fr_1.1fr]">
        <div className="grid gap-6">
          <p className="inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground"><HugeiconsIcon icon={Layout01Icon} className="size-3.5" /> Catalogs · Presentations · Websites</p>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">From product data to beautiful experiences.</h1>
          <p className="max-w-xl text-lg text-pretty text-muted-foreground">
            Kavero turns your products into designed, animated catalogs. Build them visually or with AI, pull products from any MCP source, and publish as PDF, PowerPoint, video or a website.
          </p>
          {/* Start with a prompt: chat with the connected model, or the built-in planner. */}
          <LandingPrompt />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <Link href="/dashboard" className="inline-flex items-center gap-1.5 font-medium hover:underline"><HugeiconsIcon icon={Presentation01Icon} className="size-4" /> Or open the editor</Link>
            <span className="text-xs text-muted-foreground">No account needed: everything is saved in your browser until you choose to sync.</span>
          </div>
        </div>
        <HomePreview />
      </section>

      {/* Features */}
      <section className="border-t bg-muted/30">
        <div className="mx-auto w-full max-w-6xl px-4 py-16">
          <h2 className="mb-2 text-2xl font-semibold tracking-tight">One catalog, every format</h2>
          <p className="mb-10 max-w-2xl text-muted-foreground">Every output is generated from the same document, so your PDF, slides, video and website always match.</p>
          <div className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <article key={title} className="grid content-start gap-2 bg-background p-6">
                <HugeiconsIcon icon={Icon} className="size-5 text-primary" aria-hidden />
                <h3 className="font-medium">{title}</h3>
                <p className="text-sm text-muted-foreground">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto w-full max-w-6xl px-4 py-16">
        <h2 className="mb-10 text-2xl font-semibold tracking-tight">How it works</h2>
        <ol className="grid gap-8 md:grid-cols-3">
          {[
            ["Bring your products", "Paste a list, connect an MCP product source, or start from one of 12 templates for fashion, jewelry, electronics, furniture, food and more."],
            ["Design and animate", "Generate a first draft with AI, then refine every slide in the editor: layouts, typography, colors, transitions and animations."],
            ["Publish anywhere", "Export PDF, PowerPoint or MP4, or publish an animated website your customers can open on any device."],
          ].map(([title, text], i) => (
            <li key={title} className="grid content-start gap-2">
              <span className="text-sm font-medium text-primary tabular-nums">0{i + 1}</span>
              <h3 className="text-lg font-medium">{title}</h3>
              <p className="text-sm text-muted-foreground">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* MCP */}
      <section className="border-t bg-muted/30">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-16 lg:grid-cols-2">
          <div className="grid content-start gap-4">
            <h2 className="text-2xl font-semibold tracking-tight">Built for AI agents</h2>
            <p className="text-muted-foreground">
              Kavero speaks the Model Context Protocol. Give an agent a scoped token and it can build a full catalog for you: import products with photos, lay out slides, animate them, check previews and publish the result.
            </p>
            <ul className="grid gap-2 text-sm">
              <li className="flex gap-2"><HugeiconsIcon icon={BotIcon} className="size-4 shrink-0 text-primary" /> Create a token in <Link className="underline underline-offset-2" href="/settings#tokens">Settings → API tokens</Link></li>
              <li className="flex gap-2"><HugeiconsIcon icon={CloudIcon} className="size-4 shrink-0 text-primary" /> Catalogs agents build appear on your dashboard, ready to edit</li>
            </ul>
          </div>
          <pre className="overflow-x-auto rounded-xl border bg-background p-4 text-xs leading-relaxed"><code>{MCP_CONFIG}</code></pre>
        </div>
      </section>

      {/* CTA / footer */}
      <section className="mx-auto grid w-full max-w-6xl justify-items-start gap-4 px-4 py-16">
        <h2 className="text-2xl font-semibold tracking-tight">Start your first catalog</h2>
        <p className="max-w-xl text-muted-foreground">Open the editor in your browser, or read the guides for using Kavero, connecting agents over MCP and deploying your own instance.</p>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard"><Button size="lg">Open the editor</Button></Link>
        </div>
      </section>
      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-muted-foreground">
          <span>Kavero — from product data to beautiful experiences.</span>
          <span>Guides: docs/user-guide.md · docs/mcp.md · docs/deployment.md</span>
        </div>
      </footer>
    </main>
  );
}
