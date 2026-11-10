import { createCatalog, createId } from "./document";
import {
  catalogElementSchema,
  type CatalogDocument,
  type CatalogElement,
  type CatalogSlide,
  type ElementAnimation,
  type SlideTransition,
} from "./schema";

/**
 * Ready-made presentations shown on the dashboard of a fresh Kavero: Kavero itself
 * and other Upstand Platform open-source projects. Each is a 6-slide 16:9 deck built
 * from editable elements (cover → Morph overview → features → how it works →
 * quick start → closing), so it doubles as a showcase of what the editor can do.
 */

export interface ExampleDeck {
  /** Stable key, used to seed each example once per browser. */
  key: string;
  title: string;
  description: string;
  build: () => CatalogDocument;
}

interface Card {
  title: string;
  text: string;
}

interface DeckSpec {
  key: string;
  title: string;
  description: string;
  theme: CatalogDocument["theme"];
  /** Font for code panels. */
  mono?: string;
  kicker: string;
  name: string;
  tagline: string;
  website?: string;
  repo: string;
  overview: { lead: string; pillars: [Card, Card, Card, Card] };
  features: { title: string; items: [Card, Card, Card, Card, Card, Card] };
  how: { title: string; steps: [Card, Card, Card] };
  quickstart: { title: string; text: string; code: string[] };
  closing: { title: string; text: string; footer: string };
}

// ---------------------------------------------------------------------------
// Element helpers (1920×1080 page)
// ---------------------------------------------------------------------------

const W = 1920;
const M = 120;

type Box = { x: number; y: number; w: number; h: number };
type Style = Record<string, unknown>;
type Extra = { name?: string; morphKey?: string; animations?: ElementAnimation[]; opacity?: number };

const pos = (b: Box) => ({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.w), height: Math.round(b.h), rotation: 0 });

const enter = (preset: ElementAnimation["preset"], delayMs = 0, direction?: ElementAnimation["direction"], durationMs = 700): ElementAnimation => ({
  id: createId("anim"), category: "entrance", preset, trigger: "on-enter", startMs: delayMs, durationMs, delayMs: 0, easing: "ease-out",
  ...(direction ? { direction } : {}),
});

const meta = (x: Extra) => ({
  ...(x.name ? { name: x.name } : {}),
  ...(x.morphKey ? { morphKey: x.morphKey } : {}),
  ...(x.opacity !== undefined ? { opacity: x.opacity } : {}),
  animations: x.animations ?? [],
});

const text = (b: Box, value: string, style: Style = {}, x: Extra = {}): CatalogElement =>
  catalogElementSchema.parse({
    id: createId("el"), type: "text", position: pos(b), ...meta(x),
    content: { paragraphs: value.split("\n").map((line) => [{ text: line }]) },
    style: { fontFamily: "token:body", color: "token:text", ...style },
  });

const shape = (b: Box, fill: string, opts: { shape?: "rect" | "ellipse" | "line"; radius?: number; stroke?: string; strokeWidth?: number } = {}, x: Extra = {}): CatalogElement =>
  catalogElementSchema.parse({
    id: createId("el"), type: "shape", position: pos(b), ...meta(x), content: { shape: opts.shape ?? "rect" },
    style: { fill, borderRadius: opts.radius ?? 0, strokeWidth: opts.strokeWidth ?? 0, ...(opts.stroke ? { stroke: opts.stroke } : {}) },
  });

const button = (b: Box, label: string, href: string, background = "token:primary", color = "token:on-primary", x: Extra = {}): CatalogElement =>
  catalogElementSchema.parse({ id: createId("el"), type: "button", position: pos(b), ...meta(x), content: { label, href }, style: { background, color, borderRadius: Math.round(b.h / 2) } });

const slide = (name: string, elements: CatalogElement[], transition?: SlideTransition, background = "token:background"): CatalogSlide => ({
  id: createId("sld"), name, background: { kind: "color", color: background }, elements, ...(transition ? { transition } : {}),
});

const tr = (type: SlideTransition["type"], durationMs = 700, direction?: SlideTransition["direction"]): SlideTransition => ({
  type, durationMs, delayMs: 0, easing: "ease-in-out", ...(direction ? { direction } : {}),
});

const heading = (extra: Style = {}): Style => ({ fontFamily: "token:heading", fontWeight: 700, lineHeight: 1.08, letterSpacing: -1, ...extra });
const kicker = (extra: Style = {}): Style => ({ fontSize: 22, fontWeight: 600, letterSpacing: 4, color: "token:accent", ...extra });
const body = (extra: Style = {}): Style => ({ fontSize: 26, lineHeight: 1.5, color: "token:muted", ...extra });
const host = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

// ---------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------

function cover(s: DeckSpec): CatalogSlide {
  return slide("Cover", [
    shape({ x: 1180, y: 150, w: 780, h: 780 }, "token:primary", { shape: "ellipse" }, { name: "Orb", morphKey: "orb", opacity: 0.9, animations: [enter("scale", 0, undefined, 900)] }),
    shape({ x: 1420, y: 610, w: 360, h: 360 }, "token:accent", { shape: "ellipse" }, { name: "Orb small", morphKey: "orb-small", opacity: 0.85, animations: [enter("scale", 200, undefined, 900)] }),
    text({ x: M, y: 230, w: 1000, h: 40 }, s.kicker.toUpperCase(), kicker(), { name: "Kicker", morphKey: "kicker", animations: [enter("fade", 100)] }),
    text({ x: M, y: 300, w: 1150, h: 300 }, s.name, heading({ fontSize: 168, letterSpacing: -4 }), { name: "Title", morphKey: "title", animations: [enter("slide", 200, "up", 900)] }),
    text({ x: M, y: 610, w: 980, h: 200 }, s.tagline, body({ fontSize: 34, lineHeight: 1.4 }), { name: "Tagline", animations: [enter("fade", 500, undefined, 900)] }),
    shape({ x: M, y: 860, w: 96, h: 6 }, "token:accent", { radius: 3 }, { name: "Rule", morphKey: "rule" }),
    text({ x: M, y: 890, w: 1100, h: 40 }, [s.website && host(s.website), host(s.repo)].filter(Boolean).join("   ·   "), { fontSize: 22, color: "token:muted" }, { name: "Links" }),
  ]);
}

/** Morphs from the cover: title, kicker, rule and orbs glide into the corner, cards come in. */
function overview(s: DeckSpec): CatalogSlide {
  const cardW = (W - 2 * M - 3 * 32) / 4;
  const els: CatalogElement[] = [
    shape({ x: 1640, y: -140, w: 420, h: 420 }, "token:primary", { shape: "ellipse" }, { name: "Orb", morphKey: "orb", opacity: 0.9 }),
    shape({ x: 1560, y: 150, w: 120, h: 120 }, "token:accent", { shape: "ellipse" }, { name: "Orb small", morphKey: "orb-small", opacity: 0.85 }),
    text({ x: M, y: 110, w: 1000, h: 40 }, s.kicker.toUpperCase(), kicker(), { name: "Kicker", morphKey: "kicker" }),
    text({ x: M, y: 160, w: 1300, h: 110 }, s.name, heading({ fontSize: 84, letterSpacing: -2 }), { name: "Title", morphKey: "title" }),
    shape({ x: M, y: 290, w: 96, h: 6 }, "token:accent", { radius: 3 }, { name: "Rule", morphKey: "rule" }),
    text({ x: M, y: 330, w: 1400, h: 150 }, s.overview.lead, body({ fontSize: 32, color: "token:text", lineHeight: 1.45 }), { name: "Lead", animations: [enter("fade", 300)] }),
  ];
  s.overview.pillars.forEach((p, i) => {
    const x = M + i * (cardW + 32);
    const delay = 500 + i * 150;
    els.push(
      shape({ x, y: 560, w: cardW, h: 400 }, "token:primary", { radius: 24 }, { name: `Card ${i + 1}`, opacity: 0.12, animations: [enter("slide", delay, "up")] }),
      text({ x: x + 36, y: 600, w: 64, h: 60 }, `0${i + 1}`, heading({ fontSize: 40, color: "token:accent" }), { animations: [enter("slide", delay, "up")] }),
      text({ x: x + 36, y: 690, w: cardW - 72, h: 90 }, p.title, heading({ fontSize: 34, lineHeight: 1.15, letterSpacing: -0.5 }), { animations: [enter("slide", delay, "up")] }),
      text({ x: x + 36, y: 790, w: cardW - 72, h: 160 }, p.text, body({ fontSize: 22 }), { animations: [enter("slide", delay, "up")] }),
    );
  });
  return slide("Overview", els, tr("morph", 1000));
}

function features(s: DeckSpec): CatalogSlide {
  const colW = (W - 2 * M - 2 * 48) / 3;
  const els: CatalogElement[] = [
    text({ x: M, y: 110, w: 1000, h: 40 }, "FEATURES", kicker()),
    text({ x: M, y: 160, w: 1500, h: 110 }, s.features.title, heading({ fontSize: 68, letterSpacing: -1.5 })),
  ];
  s.features.items.forEach((f, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = M + col * (colW + 48);
    const y = 340 + row * 340;
    const delay = 200 + i * 110;
    els.push(
      shape({ x, y, w: 64, h: 64 }, "token:accent", { shape: "ellipse" }, { animations: [enter("scale", delay)] }),
      text({ x, y: y + 14, w: 64, h: 40 }, String(i + 1), heading({ fontSize: 28, align: "center", color: "token:on-primary", letterSpacing: 0 }), { animations: [enter("scale", delay)] }),
      text({ x, y: y + 90, w: colW, h: 50 }, f.title, heading({ fontSize: 32, letterSpacing: -0.5 }), { animations: [enter("fade", delay)] }),
      text({ x, y: y + 148, w: colW, h: 150 }, f.text, body({ fontSize: 22 }), { animations: [enter("fade", delay)] }),
    );
  });
  return slide("Features", els, tr("push", 700, "left"));
}

function howItWorks(s: DeckSpec): CatalogSlide {
  const stepW = (W - 2 * M - 2 * 80) / 3;
  const els: CatalogElement[] = [
    text({ x: M, y: 110, w: 1000, h: 40 }, "HOW IT WORKS", kicker()),
    text({ x: M, y: 160, w: 1600, h: 110 }, s.how.title, heading({ fontSize: 68, letterSpacing: -1.5 })),
    shape({ x: M + 60, y: 459, w: W - 2 * M - 120, h: 2 }, "token:muted", {}, { name: "Connector", opacity: 0.4, animations: [enter("fade", 100, undefined, 900)] }),
  ];
  s.how.steps.forEach((st, i) => {
    const x = M + i * (stepW + 80);
    const delay = 300 + i * 250;
    els.push(
      shape({ x, y: 400, w: 120, h: 120 }, "token:primary", { shape: "ellipse" }, { animations: [enter("scale", delay)] }),
      text({ x, y: 428, w: 120, h: 64 }, String(i + 1), heading({ fontSize: 52, align: "center", color: "token:on-primary", letterSpacing: 0 }), { animations: [enter("scale", delay)] }),
      text({ x, y: 580, w: stepW, h: 60 }, st.title, heading({ fontSize: 38, letterSpacing: -0.5 }), { animations: [enter("slide", delay, "up")] }),
      text({ x, y: 650, w: stepW, h: 260 }, st.text, body({ fontSize: 24 }), { animations: [enter("slide", delay, "up")] }),
    );
  });
  return slide("How it works", els, tr("fade", 600));
}

function quickstart(s: DeckSpec): CatalogSlide {
  const mono = s.mono ?? "JetBrains Mono";
  // Panel fits its code: header dots, then one line per row.
  const panel: Box = { x: 860, y: 200, w: W - 860 - M, h: Math.max(420, 150 + s.quickstart.code.length * 46) };
  return slide("Quick start", [
    text({ x: M, y: 110, w: 640, h: 40 }, "QUICK START", kicker()),
    text({ x: M, y: 160, w: 640, h: 160 }, s.quickstart.title, heading({ fontSize: 68, letterSpacing: -1.5 })),
    text({ x: M, y: 350, w: 640, h: 300 }, s.quickstart.text, body({ fontSize: 26 })),
    shape(panel, "#0b0d12", { radius: 24 }, { name: "Code panel", animations: [enter("slide", 200, "left", 800)] }),
    shape({ x: panel.x + 32, y: panel.y + 32, w: 18, h: 18 }, "#ff5f57", { shape: "ellipse" }, { animations: [enter("fade", 600)] }),
    shape({ x: panel.x + 62, y: panel.y + 32, w: 18, h: 18 }, "#febc2e", { shape: "ellipse" }, { animations: [enter("fade", 650)] }),
    shape({ x: panel.x + 92, y: panel.y + 32, w: 18, h: 18 }, "#28c840", { shape: "ellipse" }, { animations: [enter("fade", 700)] }),
    text({ x: panel.x + 48, y: panel.y + 100, w: panel.w - 96, h: panel.h - 140 }, s.quickstart.code.join("\n"),
      { fontFamily: mono, fontSize: 26, lineHeight: 1.75, color: "#e6edf3", direction: "ltr" },
      { name: "Code", animations: [enter("fade", 700, undefined, 900)] }),
  ], tr("fade", 600));
}

function closing(s: DeckSpec): CatalogSlide {
  // Buttons fit their label (28px semibold ≈ 15.5px per character, plus padding).
  const widthFor = (label: string) => Math.max(320, Math.round(label.length * 15.5 + 110));
  const gh = "View on GitHub";
  const buttons: CatalogElement[] = [button({ x: M, y: 700, w: widthFor(gh), h: 84 }, gh, s.repo, "token:primary", "token:on-primary", { animations: [enter("slide", 600, "up")] })];
  if (s.website) {
    const site = "Visit the website";
    buttons.push(button({ x: M + widthFor(gh) + 32, y: 700, w: widthFor(site), h: 84 }, site, s.website, "token:accent", "token:on-primary", { animations: [enter("slide", 750, "up")] }));
  }
  return slide("Closing", [
    shape({ x: 1220, y: 160, w: 760, h: 760 }, "token:primary", { shape: "ellipse" }, { name: "Orb", opacity: 0.9, animations: [enter("scale", 0, undefined, 1000)] }),
    shape({ x: 1150, y: 640, w: 300, h: 300 }, "token:accent", { shape: "ellipse" }, { name: "Orb small", opacity: 0.85, animations: [enter("scale", 200, undefined, 1000)] }),
    text({ x: M, y: 250, w: 1000, h: 40 }, s.kicker.toUpperCase(), kicker()),
    text({ x: M, y: 310, w: 1050, h: 220 }, s.closing.title, heading({ fontSize: 96, letterSpacing: -2.5 }), { animations: [enter("slide", 100, "up", 900)] }),
    text({ x: M, y: 545, w: 960, h: 130 }, s.closing.text, body({ fontSize: 30 }), { animations: [enter("fade", 400)] }),
    ...buttons,
    text({ x: M, y: 900, w: 1100, h: 40 }, s.closing.footer, { fontSize: 22, color: "token:muted" }, { animations: [enter("fade", 900)] }),
  ], tr("zoom", 700));
}

function buildDeck(s: DeckSpec): CatalogDocument {
  const doc = createCatalog({ title: s.title, description: s.description, page: "16:9" });
  doc.theme = structuredClone(s.theme);
  doc.slides = [cover(s), overview(s), features(s), howItWorks(s), quickstart(s), closing(s)];
  return doc;
}

// ---------------------------------------------------------------------------
// Decks
// ---------------------------------------------------------------------------

const KAVERO: DeckSpec = {
  key: "kavero",
  title: "Kavero — From product data to beautiful experiences",
  description: "Meet Kavero: the AI-native catalog and presentation builder.",
  theme: {
    colors: { background: "#0a0a0a", text: "#fafafa", muted: "#a3a3a3", primary: "#fafafa", "on-primary": "#0a0a0a", accent: "#f5b13d" },
    fonts: { heading: "Inter", body: "Inter" },
  },
  kicker: "Open source · AI-native",
  name: "Kavero",
  tagline: "From product data to beautiful catalogs, presentations, videos and websites — designed by you, built with AI.",
  repo: "https://github.com/UpstandPlatform/Kavero",
  overview: {
    lead: "Bring your products — pasted, imported from any MCP server, or generated with AI — design them in a visual editor, and publish one catalog everywhere.",
    pillars: [
      { title: "Visual editor", text: "Slides, layers, product cards and grids, HTML blocks, snapping, undo and autosave." },
      { title: "Built-in AI", text: "A designed first draft from a brief, and slide edits you approve with a preview." },
      { title: "MCP both ways", text: "Import products from your store; let Claude build and publish catalogs for you." },
      { title: "Local-first", text: "Works offline in the browser or desktop app. Sync and collaborate when you want." },
    ],
  },
  features: {
    title: "One document, every format",
    items: [
      { title: "PDF and PowerPoint", text: "Print-ready PDFs with real text, and PowerPoint files that stay editable." },
      { title: "Video and images", text: "MP4 up to 4K, or every slide as a JPG — rendered frame by frame." },
      { title: "Websites", text: "Publish an animated site with SEO, or export one self-contained HTML file." },
      { title: "Motion and Morph", text: "Entrance animations, transitions, and PowerPoint-style Morph between slides." },
      { title: "Teams and admin", text: "Workspaces with roles, cloud sync with conflict handling, and a server admin." },
      { title: "Every language", text: "Right-to-left catalogs for Persian, Arabic and Hebrew, with embedded fonts." },
    ],
  },
  how: {
    title: "From products to a published catalog",
    steps: [
      { title: "Bring products", text: "Paste a list, import from your store over MCP, or start from one of 12 templates." },
      { title: "Design with AI", text: "Generate a first draft, then refine slides, layers, products and animations." },
      { title: "Publish everywhere", text: "Export PDF, PowerPoint, video or HTML, or publish a website in one click." },
    ],
  },
  quickstart: {
    title: "Run it in a minute",
    text: "Install the desktop app from GitHub Releases — no account, no setup — or run the web app yourself with Bun and Docker.",
    code: ["# web app", "bun install", "bun run db:start", "bun run db:migrate", "bun run dev:web", "", "# open http://localhost:3001"],
  },
  closing: {
    title: "Your products deserve better catalogs.",
    text: "Kavero is free and open source under the MIT license. Stars, issues and pull requests are welcome.",
    footer: "MIT licensed · Desktop app for Windows, macOS and Linux · Made by Upstand Platform",
  },
};

const OPENRIVE: DeckSpec = {
  key: "openrive",
  title: "OpenRive — Open-source editor for Rive animations",
  description: "Design, animate and build state machines, exported as real .riv files.",
  website: "https://openrive.upstand.dev",
  theme: {
    colors: { background: "#0c0a1a", text: "#f4f2ff", muted: "#a7a2c8", primary: "#7c5cff", "on-primary": "#ffffff", accent: "#ff5c8a" },
    fonts: { heading: "Space Grotesk", body: "Inter" },
  },
  kicker: "Open source · Local-first",
  name: "OpenRive",
  tagline: "An open-source, local-first editor for Rive .riv animations — interactive UIs, motion and game experiences that run everywhere.",
  repo: "https://github.com/UpstandPlatform/openrive",
  overview: {
    lead: "Design, animate, build state machines, and export files that play in every official Rive runtime. No accounts. No cloud. Your files stay with you.",
    pillars: [
      { title: "Real .riv files", text: "Reads and writes the actual runtime format; files round-trip byte for byte." },
      { title: "Official rendering", text: "The canvas is drawn by the official Rive WASM runtime: what you see ships." },
      { title: "Local and login-free", text: "Projects in embedded PostgreSQL on your machine, or your own server." },
      { title: "Everywhere you work", text: "Web, desktop, terminal UI, MCP server and REST API on one core." },
    ],
  },
  features: {
    title: "Everything to design, animate and ship",
    items: [
      { title: "Design", text: "Artboards, shapes, pen paths, text with fonts, gradients, clipping and constraints." },
      { title: "Animate", text: "Timelines with auto-keying, a curve editor, loops, ping-pong and blend states." },
      { title: "Interactivity", text: "State machines with layers, transitions, conditions and pointer listeners." },
      { title: "Data binding", text: "View models drive transitions, listeners and your app — with live preview." },
      { title: "Code and embed", text: "Automation scripts plus embed code for Web, React, Flutter, iOS and Android." },
      { title: "AI and MCP", text: "42 MCP tools and agent skills, so an AI can build animations through the CLI." },
    ],
  },
  how: {
    title: "From idea to every runtime",
    steps: [
      { title: "Design", text: "Draw artboards, import SVGs, images and fonts, and set up theme colors." },
      { title: "Animate", text: "Key timelines, wire state machines and data binding, preview it live." },
      { title: "Ship", text: "Export a real .riv for mobile, desktop, web, consoles, TVs and vehicles." },
    ],
  },
  quickstart: {
    title: "Up and running locally",
    text: "No database to set up: OpenRive runs an embedded PostgreSQL until you point DATABASE_URL at a server. Desktop installers ship with every release.",
    code: ["git clone https://github.com/", "  UpstandPlatform/OpenRive.git", "cd OpenRive", "bun install", "bun run dev", "", "# open http://localhost:3000"],
  },
  closing: {
    title: "Animate anything. Own every file.",
    text: "OpenRive is free and open source under the MIT license — self-host it with Docker or run it on your desktop.",
    footer: "MIT licensed · Not affiliated with Rive Inc. · Made by Upstand Platform",
  },
};

const UPSTAND: DeckSpec = {
  key: "upstand",
  title: "Upstand — Open-source, self-hosted PaaS",
  description: "Deploy apps and databases, route with automatic HTTPS, and operate servers from one dashboard.",
  website: "https://upstand.dev",
  theme: {
    colors: { background: "#07111f", text: "#eef6ff", muted: "#93a7c1", primary: "#10b981", "on-primary": "#04140d", accent: "#38bdf8" },
    fonts: { heading: "Plus Jakarta Sans", body: "Inter" },
  },
  kicker: "Open source · Self-hosted PaaS",
  name: "Upstand",
  tagline: "A free, AI-friendly, open-source alternative to Vercel, Netlify, Heroku, Coolify and Dokploy — on your own servers.",
  repo: "https://github.com/UpstandPlatform/upstand",
  overview: {
    lead: "A container-first control plane that orchestrates Docker Swarm nodes, deploys apps and databases, configures Caddy routing and runs server operations from one web interface.",
    pillars: [
      { title: "Deploy anything", text: "Dockerfile, Railpack, Nixpacks, Buildpacks, static sites and Compose stacks." },
      { title: "Databases built in", text: "PostgreSQL, MySQL, MariaDB, MongoDB, Redis and libSQL in a few clicks." },
      { title: "HTTPS by default", text: "Atomic Caddy reloads with automatic certificates and routing middleware." },
      { title: "AI operations", text: "UpGal assistant and an MCP endpoint, with approvals for every change." },
    ],
  },
  features: {
    title: "Everything you need to run production",
    items: [
      { title: "Durable build queues", text: "Per-node deployment queues with concurrency control and build locking." },
      { title: "Swarm and remote servers", text: "Provision Docker over SSH, manage Swarm nodes, drain and rotate safely." },
      { title: "Backups and restore", text: "S3 backups for databases and volumes, plus full control-plane archives." },
      { title: "Enterprise security", text: "OIDC and SAML SSO, SCIM provisioning, TOTP 2FA and scoped API keys." },
      { title: "Operations tools", text: "Owner web terminal, log reviewer with filters, and secure file transfers." },
      { title: "Self-hosted or cloud", text: "Run it on one VPS, or as a multi-tenant cloud with remote workload servers." },
    ],
  },
  how: {
    title: "From a fresh server to production",
    steps: [
      { title: "Install", text: "One installer sets up Swarm, Caddy and the dashboard on a Linux server." },
      { title: "Connect", text: "Add your domain, remote servers over SSH, Git repositories and registries." },
      { title: "Deploy", text: "Ship apps, databases and Compose stacks with HTTPS, backups and monitoring." },
    ],
  },
  quickstart: {
    title: "Install on your server",
    text: "The installer pulls audited release images, generates secrets and starts the dashboard. Pick a release tag and run it on a fresh Linux server.",
    code: ["export UPSTAND_VERSION=vX.Y.Z", "", "curl -fsSL https://raw.", "  githubusercontent.com/", "  UpstandPlatform/upstand/", "  $UPSTAND_VERSION/install.sh \\", "  | sudo -E bash"],
  },
  closing: {
    title: "Your cloud, on your servers.",
    text: "Upstand is free and open source. Deploy it today and keep full control of your apps, data and costs.",
    footer: "Open source · Docker Swarm · Caddy · Better Auth · Made by Upstand Platform",
  },
};

const DGRUNNER: DeckSpec = {
  key: "dgrunner",
  title: "dgrunner — Self-hosted GitHub Actions runners, safely",
  description: "Set up and manage self-hosted runners on Linux, Windows, WSL and Docker.",
  mono: "JetBrains Mono",
  theme: {
    colors: { background: "#0d1117", text: "#e6edf3", muted: "#8b949e", primary: "#2ea043", "on-primary": "#ffffff", accent: "#58a6ff" },
    fonts: { heading: "Inter", body: "Inter" },
  },
  kicker: "Open source · CLI",
  name: "dgrunner",
  tagline: "Set up and manage self-hosted GitHub Actions runners on Linux and Windows, in WSL, Docker or disposable Hyper-V VMs.",
  repo: "https://github.com/UpstandPlatform/dgrunner",
  overview: {
    lead: "Bare-metal speed, your own hardware and GPUs, no minute limits — without the security risks of a misconfigured runner on your workstation or company machines.",
    pillars: [
      { title: "Pre-flight audits", text: "Checks Git, Docker, privileges and network before anything is installed." },
      { title: "Verified binaries", text: "Runner releases are checked against official SHA-256 checksums." },
      { title: "Lifecycle control", text: "Services, start, stop, logs, status and self-upgrade from one CLI." },
      { title: "Disposable sandboxes", text: "One fresh Hyper-V Linux VM per job for workflows that need isolation." },
    ],
  },
  features: {
    title: "Runners where you need them",
    items: [
      { title: "Windows native", text: "A background runner for PowerShell, .NET and Windows-only pipelines." },
      { title: "Linux in Docker", text: "Ubuntu 24.04, 22.04, Debian or your own image, restarting automatically." },
      { title: "WSL2", text: "Detects installed distros, labels them, and can install new ones for you." },
      { title: "Security guardrails", text: "Root checks, Docker exposure warnings, masked tokens and 0700 permissions." },
      { title: "Verification workflow", text: "Generates a workflow that proves the runner works on GitHub." },
      { title: "Agent skills", text: "Skills for Claude Code and Codex to set up, operate and troubleshoot runners." },
    ],
  },
  how: {
    title: "A trusted runner in three steps",
    steps: [
      { title: "Check", text: "dgrunner doctor audits your machine, Git, Docker and network." },
      { title: "Set up", text: "The wizard downloads, verifies, registers and starts the runner." },
      { title: "Verify", text: "dgrunner guide generates a workflow that runs on your new runner." },
    ],
  },
  quickstart: {
    title: "Install and run the wizard",
    text: "Needs Node.js 22+, Git and Docker (Hyper-V only for sandboxes). Get a short-lived token from Settings → Actions → Runners in your private repository.",
    code: ["npm install -g @upstand/dgrunner", "", "dgrunner doctor", "dgrunner", "dgrunner guide --generate-workflow", "", "# or: npx @upstand/dgrunner"],
  },
  closing: {
    title: "Fast CI on your hardware. Safely.",
    text: "dgrunner is open source. Use self-hosted runners for repositories you trust, and sandboxes for everything else.",
    footer: "Open source · npm @upstand/dgrunner · Made by Upstand Platform",
  },
};

const SPECS = [KAVERO, OPENRIVE, UPSTAND, DGRUNNER];

/** The example presentations, in the order they appear on the dashboard. */
export const EXAMPLE_DECKS: ExampleDeck[] = SPECS.map((s) => ({ key: s.key, title: s.title, description: s.description, build: () => buildDeck(s) }));
