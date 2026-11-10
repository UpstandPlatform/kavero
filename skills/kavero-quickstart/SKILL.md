---
name: kavero-quickstart
description: Connect an AI agent to Kavero's MCP server and run the end-to-end catalog flow — API token and scopes (Settings → API tokens & AI agents), MCP client config for Claude Code / Claude Desktop / Cursor, choosing catalog_generate (brief-driven) vs catalog_create with a template id, page sizes, language/currency/RTL, then catalog_preview → refine → export or catalog_publish. Use when the user wants to set up or connect Kavero to Claude/an MCP client, gets "missing bearer token"/permission errors, asks "how do I start", "make me a catalog with Kavero", or needs to pick a template, page size or which Kavero skill to use next.
---

# Kavero quickstart (MCP)

Kavero's MCP server lets you create, edit, animate, preview, export and publish catalogs. Everything you build stays editable by the user in the Kavero editor.

## 1. Connect

**Token.** The user signs in → **Settings → API tokens & AI agents** → name (e.g. "Claude"), permissions, expiry → **Create token**. It starts with `kv_` and is shown once. The screen also has a ready-to-paste client config. Never ask the user to paste the token into chat if they can put it in the config themselves.

| Permission | Needed for |
| --- | --- |
| `catalogs:read` | `catalog_list`, `catalog_get`, `catalog_preview`, `catalog_export_pdf`, `catalog_export_pptx` |
| `catalogs:write` | create/generate/duplicate, theme, slides, elements, transitions, animations, `catalog_import_products`, `asset_import` |
| `catalogs:delete` | `catalog_delete` (also needs `confirm: true` after the user agrees) |
| `publish` | `catalog_publish`, `catalog_unpublish` |

Typical agent token: read + write (+ publish if it should put sites online). Add delete only if asked.

**Server.** Streamable HTTP at `https://<kavero-host>/api/mcp` (local dev: `http://localhost:3001/api/mcp`), header `Authorization: Bearer kv_…`.

Claude Code:

```bash
claude mcp add --transport http kavero https://<kavero-host>/api/mcp --header "Authorization: Bearer kv_your_token"
```

Cursor and other clients with HTTP + headers:

```json
{ "mcpServers": { "kavero": { "type": "http", "url": "https://<kavero-host>/api/mcp",
  "headers": { "Authorization": "Bearer kv_your_token" } } } }
```

Clients that only launch local (stdio) servers, e.g. Claude Desktop's `claude_desktop_config.json`, can use the `mcp-remote` bridge (needs Node.js):

```json
{ "mcpServers": { "kavero": { "command": "npx",
  "args": ["-y", "mcp-remote", "https://<kavero-host>/api/mcp", "--header", "Authorization:${KAVERO_AUTH}"],
  "env": { "KAVERO_AUTH": "Bearer kv_your_token" } } } }
```

**Errors.** `Missing bearer token` / `Invalid, expired or revoked token` → new token. `This token doesn't have the "<scope>" permission` → new token with that scope (scopes can't be added to an existing one). `Rate limit exceeded` → 120 requests/min per token; batch work (`slide_add_element` takes up to 50 elements, `catalog_import_products` up to 500 products). Every call is listed in **Settings → Activity**.

## 2. Start a catalog

Ask (or infer) before building: audience, language, currency, page format, product list and images, brand colors/fonts, and whether motion, PDF, PowerPoint or a website is the goal.

| Situation | Use |
| --- | --- |
| A brief + products, want a full designed catalog fast | `catalog_generate` — `brief` (≤ 4000 chars), `products[]` (≤ 500, with `imageUrl`), optional `template`, `page`, `language`, `currency`, `workspaceId`. Builds cover, category dividers, product grids, featured product, comparison and closing. Uses the user's or server's AI model, or a built-in planner. Rate-limited per user. |
| A specific design in mind, few slides, or a non-catalog presentation | `catalog_create` — `title`, `template` (or `blank`), `page`, `language`, `currency`, `description`, `workspaceId`; then add slides/elements yourself |
| Restyle an existing catalog | `catalog_apply_theme` — `template` and/or `colors` (hex) and `fonts` |
| Variation of an existing catalog | `catalog_duplicate` — note: images are **not** copied yet (placeholders in the copy) |

Omitting `template` in `catalog_generate` lets Kavero pick one from the brief. `workspaceId` comes from `catalog_list` (`workspace` column); default is the user's personal space.

### Templates (`template` ids)

| id | Use for |
| --- | --- |
| `minimal` | Clean white pages, bold type — any product, safe default |
| `studio` | Confident violet color blocks — brands that want to stand out |
| `dark-luxury` | Black and gold editorial — premium fashion, luxury |
| `atelier` | High-contrast lookbook, oversized type, red accent — fashion |
| `maison` | Ivory, champagne, emerald — jewelry and watches |
| `tech` | Cool blues on a grid — electronics, gadgets, software |
| `natural` | Warm earth tones, editorial — home and furniture |
| `glow` | Soft blush, serif type — skincare and cosmetics |
| `harvest` | Tomato red and cream blocks — food and drink |
| `estate` | Navy and sand grid — real estate listings |
| `forge` | Charcoal and safety yellow — industrial products, tools, B2B |
| `velocity` | Dark asphalt, racing red — vehicles and auto parts |

### Page sizes (`page`)

| id | Pixels | For |
| --- | --- | --- |
| `16:9` (default) | 1920 × 1080 | Screens, websites, video, PowerPoint |
| `4:3` | 1440 × 1080 | Older projectors, tablets |
| `a4-portrait` | 794 × 1123 | Print, PDF price lists |
| `a4-landscape` | 1123 × 794 | Print lookbooks |
| `letter-portrait` | 816 × 1056 | US print |
| `square` | 1080 × 1080 | Social posts |

The page size can't be changed over MCP after creation — pick it up front.

### Language, currency, direction

- `language` is a code like `en`, `de`, `fa`. `ar`, `fa`, `he`, `ur` (and `ps`, `sd`, `ug`, `yi`, `dv`, `ku`, `ckb`) make the whole catalog right-to-left; `align: "start"` is then the right edge.
- `currency` is a 3-letter ISO code (`EUR`, `USD`, `IRR`); products can carry their own.
- Change either later with `catalog_update`. Full RTL rules are in `kavero-catalogs`.

## 3. Build → check → refine

1. `catalog_get` (outline: page, theme, products, assets, slide/element ids and text). Use `full: true` only when you need styles, names or `morphKey`s.
2. Edit existing elements with `slide_update_element` (deep merge; arrays replace) before adding new ones.
3. `catalog_preview` every slide you touched (`slideIndex` is 0-based; PNG of the finished state). Fix overlaps, overflow, contrast.
4. Give the user the `editorUrl` from create/generate/get — opening it signed in loads the catalog into the editor.
5. Deliver only what was asked: export or publish (`kavero-publish-export`).

## Which skill next

| The user wants… | Skill |
| --- | --- |
| Layout, typography, slide structure, RTL, QA | `kavero-catalogs` |
| Products from a store/PIM/spreadsheet, product images, large catalogs | `kavero-product-sources` |
| Entrance/emphasis animations, transitions, video timing | `kavero-animations` |
| Morph / magic-move between slides | `kavero-morph` |
| PDF, PowerPoint, preview images, website publishing, MP4/HTML/JPG | `kavero-publish-export` |

## Rules

- Never call `catalog_delete` without the user's explicit yes in chat; then pass `confirm: true`.
- Don't publish (`catalog_publish`) unless asked; the default visibility is `unlisted`.
- Use theme tokens (`token:primary`, `token:text`, …) for colors so a later `catalog_apply_theme` restyles everything.
- Don't invent tools: if something isn't in the tool list (e.g. MP4 or JPG export), tell the user where to click in the editor.
