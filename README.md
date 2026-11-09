# Kavero

**From product data to beautiful experiences.**

Kavero is an AI-native catalog and presentation builder. Bring your products — pasted, imported from any MCP server, or generated with AI — design them in a visual slide editor, animate them, and publish the same catalog as a **PDF**, an editable **PowerPoint**, an **MP4 video** or an **animated website**.

It's local-first: open it and start working, no account needed. Sign in to sync across devices, collaborate in workspaces, publish, and let AI agents build catalogs for you over MCP.

## Highlights

- **Visual editor** — text, images, shapes, product cards and grids, HTML blocks; snapping, groups, layers, undo/redo, autosave.
- **AI generation and editing** — a designed first draft from a brief and a product list; slide edits you approve with a before/after preview. Works with Anthropic Claude, OpenRouter, OpenAI or local models — set on the server, or by each user with their own key in Settings → AI. A built-in planner takes over when no model is configured.
- **MCP both ways** — import products from your store's MCP server; let Claude and other agents create, edit, preview, export and publish catalogs through Kavero's MCP server (24 tools, scoped tokens, audit log).
- **Motion** — element animations and slide transitions that play the same in preview, on websites and in video.
- **Every format from one document** — PDF with selectable text, PowerPoint with editable objects, MP4 up to 4K, published websites with SEO and social previews.
- **12 templates** for fashion, jewelry, electronics, furniture, cosmetics, food, real estate, industrial, automotive and general catalogs.
- **Right-to-left** catalogs (Persian, Arabic, Hebrew, Urdu) with per-paragraph direction.
- **Teams** — workspaces with owner, admin, editor and viewer roles.

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
| [Using Kavero](docs/user-guide.md) | Dashboard, editor, products, RTL, animations, exports, sync, publishing, shortcuts |
| [MCP](docs/mcp.md) | Connecting agents, tool reference, element JSON, recipes, product sources |
| [Deployment](docs/deployment.md) | Environment, Docker, migrations, storage, hosting, backups, CI |
| [Desktop app](docs/desktop.md) | The Electron app and its release workflow |
| [Architecture](docs/architecture.md) | Packages, document model, sync, rendering, exports |
| [Agent skills](skills/) | `kavero-catalogs` and `kavero-animations` skills for AI agents |

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

End-to-end suites live in `packages/mcp-server/e2e/` and run against a dev server.
