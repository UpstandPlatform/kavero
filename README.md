# Kavero

**From product data to beautiful experiences.**

[![CI](https://github.com/UpstandPlatform/kavero/actions/workflows/ci.yml/badge.svg)](https://github.com/UpstandPlatform/kavero/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Kavero is an AI-native catalog and presentation builder. Bring your products — pasted, imported from any MCP server, or generated with AI — design them in a visual slide editor, animate them, and publish the same catalog as a **PDF**, an editable **PowerPoint**, **JPG images**, an **MP4 video**, a **single HTML file** or an **animated website**.

It's local-first: open it and start working, no account needed. Sign in to sync across devices, collaborate in workspaces, publish, and let AI agents build catalogs for you over MCP.

![The Kavero editor: slide thumbnails on the left, a jewelry catalog cover on the canvas, and the properties panel with text styling and animation settings](docs/images/editor.png)

## Highlights

- **Visual editor** — text, images, shapes, product cards and grids, HTML blocks; snapping, groups, layers, undo/redo, autosave, and a PowerPoint-style Morph transition that moves shared elements between slides.
- **AI generation and editing** — a designed first draft from a brief and a product list; slide edits you approve with a before/after preview. Works with Anthropic Claude, OpenRouter, OpenAI or local models — set on the server, or by each user with their own key in Settings → AI. A built-in planner takes over when no model is configured.
- **MCP both ways** — import products from your store's MCP server; let Claude and other agents create, edit, preview, export and publish catalogs through Kavero's MCP server (29 tools incl. fonts, scoped tokens, audit log).
- **Motion** — element animations and slide transitions that play the same in preview, on websites and in video.
- **Every format from one document** — PDF with selectable text, PowerPoint with editable objects, MP4 up to 4K, JPG slide images in a zip, published websites with SEO and social previews, or a single self-contained HTML file to host anywhere.
- **12 templates** for fashion, jewelry, electronics, furniture, cosmetics, food, real estate, industrial, automotive and general catalogs.
- **Right-to-left** catalogs (Persian, Arabic, Hebrew, Urdu) with per-paragraph direction.
- **Teams** — workspaces with owner, admin, editor and viewer roles.
- **Server admin** — the first account is the admin: manage users and roles, suspend accounts, moderate published sites, choose open, invite-only or closed sign-ups, and review the activity log.

## Quick start

Requirements: [Bun](https://bun.sh) 1.4+, Docker (for Postgres), Chrome or Chromium (for PDF/video export).

```bash
bun install
cp apps/web/.env.example apps/web/.env   # or create it: see docs/deployment.md
bun run db:start                          # Postgres on localhost:5436
cd packages/db && bunx drizzle-kit migrate && cd ../..
bun run dev:web                           # http://localhost:3001
```

`apps/web/.env` needs `DATABASE_URL`, `BETTER_AUTH_SECRET` (32+ random characters) and `BETTER_AUTH_URL=http://localhost:3001`. Add `ANTHROPIC_API_KEY` to give everyone an AI model, or let each user add their own Claude/OpenRouter key in Settings → AI.

Everything runs in one container too: `docker compose up -d --build` (see [deployment](docs/deployment.md)).

## Documentation

| Guide | |
| --- | --- |
| [Using Kavero](docs/user-guide.md) | Dashboard, editor, layers, products, RTL, animations and Morph, exports, sync, publishing, admin, shortcuts |
| [MCP](docs/mcp.md) | Connecting agents, tool reference, element JSON, recipes, product sources |
| [Deployment](docs/deployment.md) | Environment, Docker, migrations, admin accounts, storage, hosting, backups, CI |
| [Desktop app](docs/desktop.md) | The Electron app, installers, and automatic releases with changelog |
| [Architecture](docs/architecture.md) | Packages, document model, sync, rendering, exports |
| [Agent skills](skills/README.md) | Skills that teach AI agents to use Kavero over MCP: quick start, catalogs, animations, Morph, products, publishing and exports |

## Repository

```text
apps/
  web/            Next.js app: dashboard, editor, published sites, API, MCP endpoint
  desktop/        Electron desktop app
packages/
  catalog-engine/ document schema, validation, templates
  editor-core/    command system, undo/redo
  renderer/       shared slide renderer and presentation player
  animation-engine/ deterministic animations and transitions
  ai/             LLM providers, catalog planner and builder
  export-chromium/ PDF, MP4 and image rendering (headless Chrome + ffmpeg)
  export-pptx/    editable PowerPoint export
  local-storage/  IndexedDB storage and .kavero files
  api/            tRPC routers and services (catalogs, publishing, workspaces, AI, integrations)
  mcp-server/     Kavero's MCP tools
  db/             Drizzle schema and migrations
  auth/, ui/, config/
skills/           agent skills for building catalogs with Kavero
docs/             guides
```

## Scripts

| Command | |
| --- | --- |
| `bun run dev:web` | Web app in development |
| `bun run dev:desktop` | Desktop app against the dev server |
| `bun run build` | Build everything |
| `bun run check-types` | Typecheck all packages |
| `bun run db:start` / `db:stop` | Start/stop Postgres (Docker) |
| `bun run db:generate` / `db:migrate` | Create/apply migrations |
| `bun run test` | Unit tests |
| `bun run make-admin <email>` | Make an account a server admin (recovery) |
| `bun scripts/release.ts` | Preview the next release version and changelog |

End-to-end suites live in `packages/mcp-server/e2e/` and `packages/auth/e2e/` and run against a local dev server and database.

## Releases

Windows installers are published on [GitHub Releases](https://github.com/UpstandPlatform/kavero/releases). Versions and the [changelog](CHANGELOG.md) are generated automatically from commit messages when changes land on `master` — see [Desktop app → Releases](docs/desktop.md#releases).

## Contributing

Bug reports, ideas and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the setup, checks and commit style, and use the [issue templates](https://github.com/UpstandPlatform/kavero/issues/new/choose). Please report security problems privately through [security advisories](https://github.com/UpstandPlatform/kavero/security/advisories/new).

## Donations

Kavero is free and open source. If it saves you time, you can support its development:

| Network | Address |
| --- | --- |
| TON | `UQBglMTG79v4lv6j0CyhJSKaB8vNr704qUgcyA0CkUtGEZ7q` |
| ETH, Base, BSC, Arbitrum | `0x39aAf891Ed40995dC5BAC792BC607630C2ecB09d` |
| Bitcoin | `bc1qq0qyu27f3qvzfeued6qmhr635ffe6zcvk6v4gh` |
| TRON | `TRkn78pomDFzB2LDYMwHLZrSiuJ4aZQxJF` |

Thank you! Stars, bug reports and pull requests help too. See [DONATIONS.md](DONATIONS.md) for details.

## License

[MIT](LICENSE) © 2026 Morteza Bagheri and Kavero contributors.
