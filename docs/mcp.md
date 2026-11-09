# Kavero and MCP

Kavero speaks the [Model Context Protocol](https://modelcontextprotocol.io) in two directions:

1. **Kavero's MCP server** (`/api/mcp`) lets AI agents — Claude, Cursor, your own scripts — create, edit, preview, export and publish catalogs.
2. **MCP connections** let Kavero read products from *your* MCP servers (store, inventory, PIM) and import them into catalogs.

Both go through the same services as the web app: the same validation, permissions and audit log.

---

## 1. Connect an agent to Kavero

### Create a token

Sign in → **Settings → API tokens & AI agents** → name it (e.g. "Claude"), pick permissions and an expiry → **Create token**. Copy it immediately; only a hash is stored.

| Permission | Allows |
| --- | --- |
| `catalogs:read` | list, get, preview, export |
| `catalogs:write` | create, edit, import products and images, generate |
| `catalogs:delete` | delete catalogs |
| `publish` | publish and unpublish websites |

Give each agent its own token with only what it needs. Revoke tokens in the same screen; every call (including refused ones) shows in **Settings → Activity**.

### Configure the client

The server uses **Streamable HTTP** at `https://<your-kavero>/api/mcp` (locally `http://localhost:3001/api/mcp`) with `Authorization: Bearer <token>`.

Claude Code:

```bash
claude mcp add --transport http kavero http://localhost:3001/api/mcp --header "Authorization: Bearer kv_your_token"
```

Generic MCP client config (Cursor, other clients):

```json
{
  "mcpServers": {
    "kavero": {
      "type": "http",
      "url": "http://localhost:3001/api/mcp",
      "headers": { "Authorization": "Bearer kv_your_token" }
    }
  }
}
```

Limits: 120 requests per minute per token; exported files up to 25 MB.

### Agent skills

`skills/` contains ready-made skills that teach an agent how to build good catalogs with these tools:

- [`kavero-catalogs`](../skills/kavero-catalogs/SKILL.md) — standard catalog structures, layouts, typography, products, RTL, QA.
- [`kavero-animations`](../skills/kavero-animations/SKILL.md) — tasteful animations and transitions.

For Claude Code, copy them into `~/.claude/skills/` (all projects) or `.claude/skills/` in a project.

---

## 2. Tool reference

Ids: `catalogId` is the **cloud catalog id** returned by `catalog_create`/`catalog_list`. Slide and element ids come from `catalog_get`. Positions are document pixels (the page size is in `catalog_get`, e.g. 1920×1080 for 16:9, 794×1123 for A4 portrait).

### Catalogs

| Tool | Permission | Input | Returns |
| --- | --- | --- | --- |
| `catalog_list` | read | — | catalogs with title, slides, revision, workspace, your role |
| `catalog_get` | read | `catalogId`, `full?` | outline (page, theme, products, assets, slides with element ids, text and positions) or the full JSON; `editorUrl` |
| `catalog_create` | write | `title`, `template?`, `page?`, `language?`, `currency?`, `description?`, `workspaceId?` | `catalogId`, `slideIds`, `page`, `editorUrl` |
| `catalog_update` | write | `catalogId`, `title?`, `description?`, `language?`, `currency?` | revision |
| `catalog_duplicate` | write | `catalogId`, `title?` | new `catalogId` |
| `catalog_delete` | delete | `catalogId`, `confirm: true` | — (ask the user first) |
| `catalog_apply_theme` | write | `catalogId`, `template?`, `colors?` (hex), `fonts?` | revision |
| `catalog_generate` | write | `brief`, `products?`, `template?`, `page?`, `language?`, `currency?`, `workspaceId?` | a complete designed catalog: `catalogId`, `slides`, `template`, `editorUrl` |

Templates: `minimal`, `studio`, `dark-luxury`, `atelier`, `maison`, `tech`, `natural`, `glow`, `harvest`, `estate`, `forge`, `velocity`. Page sizes: `16:9`, `4:3`, `a4-portrait`, `a4-landscape`, `letter-portrait`, `square`.

### Slides and elements

| Tool | Permission | Input |
| --- | --- | --- |
| `slide_create` | write | `catalogId`, `name?`, `index?`, `background?` |
| `slide_update` | write | `catalogId`, `slideId`, `name?`, `background?`, `durationMs?` |
| `slide_delete` | write | `catalogId`, `slideId` |
| `slide_reorder` | write | `catalogId`, `slideId`, `toIndex` |
| `slide_add_element` | write | `catalogId`, `slideId`, `elements[]` (up to 50) |
| `slide_update_element` | write | `catalogId`, `elementId`, `changes` (deep-merged; arrays replace) |
| `slide_remove_element` | write | `catalogId`, `elementId` |

Backgrounds: `{"kind":"color","color":"token:primary"}`, `{"kind":"gradient","from":"#111","to":"#333","angle":135}`, `{"kind":"image","assetId":"ast_…"}`.

Element JSON:

```jsonc
// text — align: "start" | "center" | "end"; direction: "auto" | "rtl" | "ltr"
{"type":"text","position":{"x":120,"y":120,"width":900,"height":140},
 "content":{"paragraphs":[[{"text":"Autumn "},{"text":"Collection","bold":true}]]},
 "style":{"fontFamily":"token:heading","fontSize":72,"fontWeight":700,"color":"token:text","align":"start"}}

// shape — rect | ellipse | triangle | line | arrow
{"type":"shape","position":{"x":0,"y":0,"width":640,"height":1080},"content":{"shape":"rect"},"style":{"fill":"token:accent"}}

// image (assetId from asset_import)
{"type":"image","position":{"x":1000,"y":120,"width":800,"height":840},"content":{"assetId":"ast_…","alt":"Leather bag"},"style":{"fit":"cover","borderRadius":16}}

// product / product grid (product ids from catalog_import_products)
{"type":"product","position":{…},"content":{"productId":"prd_…"},"style":{"imageFit":"contain","showAttributes":true}}
{"type":"product-grid","position":{…},"content":{"columns":3,"products":[{"productId":"prd_…"}]}}

// button (link on websites)
{"type":"button","position":{…},"content":{"label":"Order now","href":"https://shop.example.com"}}

// html — sandboxed, scripts removed; theme as CSS variables
{"type":"html","position":{…},"content":{"html":"<h2>Free shipping</h2>","css":"h2{color:var(--kv-primary)}"}}
```

Colors: hex or theme tokens `token:background`, `token:text`, `token:muted`, `token:primary`, `token:on-primary`, `token:accent`. Prefer tokens so `catalog_apply_theme` restyles everything.

### Products and images

| Tool | Permission | Input | Notes |
| --- | --- | --- | --- |
| `catalog_import_products` | write | `catalogId`, `products[]` (`name`, `price?`, `currency?`, `description?`, `sku?`, `category?`, `url?`, `attributes?`, `imageUrl?`, `id?`), `addSlides?` (`none`/`single`/`per-category`), `columns?`, `source?` | Upserts by `id`; downloads `imageUrl`s; can add product-grid slides (6 per slide) |
| `asset_import` | write | `catalogId`, `name`, and `url` **or** `data` (base64) + `mimeType` | For cover photos, backgrounds, logos. Returns `assetId`, `width`, `height` |

Image downloads accept public http(s) URLs only (private network and cloud-metadata addresses are refused) and PNG, JPEG, GIF or WebP up to 15 MB.

### Motion

| Tool | Input |
| --- | --- |
| `catalog_set_transition` | `catalogId`, `slideId`, `type` (`none`, `fade`, `morph`, `slide`, `push`, `zoom`, `wipe`, `flip`), `durationMs?`, `direction?`. `morph` moves elements shared with the previous slide (same `morphKey`/id, layer `name`, or unique content) |
| `catalog_animate_element` | `catalogId`, `elementId`, `category` (`entrance`, `emphasis`, `exit`), `preset` (`fade`, `slide`, `scale`, `bounce`, `rotate`, `blur`, `float`, `pulse`), `trigger?` (`on-enter`, `after-previous`, `with-previous`), `durationMs?`, `delayMs?`, `direction?` |

### Preview, export, publish

| Tool | Permission | Notes |
| --- | --- | --- |
| `catalog_preview` | read | PNG of one slide (`slideIndex`), finished state. Check every slide you change. |
| `catalog_export_pdf` | read | Embedded PDF file (one page per slide) |
| `catalog_export_pptx` | read | Embedded editable PowerPoint, plus compatibility notes |
| `catalog_publish` | publish | `visibility` `public`/`unlisted`/`private`, `slug?` → live `url` |
| `catalog_unpublish` | publish | Takes the website offline |

Password-protected publishing is set in the app.

---

## 3. Recipes

### Build a catalog from a store

1. Read products from the store's MCP server (your client calls its tools).
2. `catalog_generate` with a brief and the products (include `imageUrl`s) — or `catalog_create` with a template, then `catalog_import_products` with `addSlides: "per-category"`.
3. `catalog_get` to see slide and element ids; refine copy with `slide_update_element`.
4. `asset_import` a cover photo, then `slide_update` the cover with `background: {"kind":"image","assetId":…}` (add a semi-transparent shape above it for legible text).
5. `catalog_preview` each changed slide and fix overlaps.
6. Give the user the `editorUrl`; export or publish when they're happy.

### Right-to-left catalogs (Persian, Arabic, Hebrew)

- Create with `language: "fa"` (or `ar`, `he`, `ur`). The catalog becomes right-to-left; `align: "start"` is right.
- Leave `direction` on `auto`; paragraphs that start with Persian are RTL even if they contain `(UPVC)`.
- Put phone numbers, codes and URLs in their own text element with `direction: "ltr"`.
- Never insert bidi control characters (U+202A–U+202E, U+2066–U+2069).
- Choose a font with the script, e.g. `fonts: {"heading":"Vazirmatn","body":"Vazirmatn"}` via `catalog_apply_theme`.

### Hand the result to the user

Every create/generate/get result has an `editorUrl`. Opening it while signed in downloads the catalog into the browser and opens the editor.

---

## 4. Product sources (MCP connections)

**Settings → MCP connections → Connect**: a name, the server URL, transport (Streamable HTTP, or SSE for older servers) and authentication (none, bearer token, or a custom header such as `X-API-Key`). Kavero tests the connection and lists its tools. Secrets are encrypted at rest and never sent back to the browser.

Then in the editor, **Import products** → choose the source and tool → adjust the JSON arguments → **Fetch products** → review → **Add to catalog** (with images, and optionally new product slides). **Generate with AI** can use the same sources.

Kavero recognises common result shapes automatically: arrays of products (WooCommerce/REST style), GraphQL `edges[].node` (Shopify style), nested `data`/`items`/`products`, prices as numbers, strings or `{amount, currencyCode}`, images as URLs or `{src|url}` objects.

Local (stdio) MCP servers need the desktop app's companion, which isn't available yet; run them behind a Streamable HTTP bridge in the meantime.

---

## Security notes

- Tokens are scoped and expiring; store them like passwords. A leaked token can be revoked instantly.
- Deleting requires the `catalogs:delete` permission **and** `confirm: true` — agents should ask the user first.
- Agents act with the token owner's workspace roles: a viewer's token can't edit workspace catalogs.
- HTML from agents is sanitized and rendered in a sandbox; it can't run scripts.
