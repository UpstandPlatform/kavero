# Kavero and MCP

Kavero speaks the [Model Context Protocol](https://modelcontextprotocol.io) in two directions:

1. **Kavero's MCP server** (`/api/mcp`) lets AI agents — Claude, Cursor, your own scripts — create, edit, preview, export and publish catalogs.
2. **MCP connections** let Kavero read products from *your* MCP servers (store, inventory, PIM) and import them into catalogs.

Both go through the same services as the web app: the same validation, permissions and audit log.

---

## 1. Connect an agent to Kavero

### Create an API key

Sign in → **Settings → API keys** → name it (e.g. "Claude"), choose permissions and an expiry → **Create API key**. Copy it immediately; only a hash is stored.

| Permission | Allows |
| --- | --- |
| `catalogs:read` | list, get and preview catalogs |
| `catalogs:write` | create, edit and import products |
| `catalogs:delete` | delete catalogs |
| `assets:write` | import images and fonts |
| `exports:read` | render previews and export files |
| `ai:generate` | generate catalogs with AI |
| `workspaces:write` | create catalogs in a team workspace |
| `publish` | publish and unpublish websites |

Give each agent its own API key with only what it needs. Revoke keys in the same screen; every call (including refused ones) shows in **Settings → Activity**.

### Configure the client

> **Desktop app:** Kavero's own server runs on your computer, so use `http://127.0.0.1:41731/api/mcp` (the default port) with an API key from the app's Settings — no account or deployment needed. Keep the app open while the agent works; links it returns (`kavero://editor/…`) open the catalog in the app.


The server uses **Streamable HTTP** at `https://<your-kavero>/api/mcp` (locally `http://localhost:3001/api/mcp`) with `Authorization: Bearer <api-key>`.

Claude Code:

```bash
claude mcp add --transport http kavero http://localhost:3001/api/mcp --header "Authorization: Bearer kv_your_api_key"
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

Limits: 120 requests per minute per API key; exported files up to 25 MB.

### Agent skills

`skills/` contains ready-made skills that teach an agent how to build good catalogs with these tools:

- [`kavero-catalogs`](../skills/kavero-catalogs/SKILL.md) — standard catalog structures, layouts, typography, products, RTL, QA.
- [`kavero-animations`](../skills/kavero-animations/SKILL.md) — tasteful animations and transitions.
- [`kavero-quickstart`](../skills/kavero-quickstart/SKILL.md) — connecting an agent (API key, scopes, client config), choosing a template and page size, the end-to-end flow.
- [`kavero-morph`](../skills/kavero-morph/SKILL.md) — Morph ("magic move") sequences: matching elements with `morphKey`/`name`, timing, worked recipes.
- [`kavero-product-sources`](../skills/kavero-product-sources/SKILL.md) — importing products and images, field mapping from stores and spreadsheets, large catalogs.
- [`kavero-publish-export`](../skills/kavero-publish-export/SKILL.md) — previews, PDF and PowerPoint exports, publishing websites, and what's editor-only (MP4, HTML file, JPG zip).

For Claude Code, copy them into `~/.claude/skills/` (all projects) or `.claude/skills/` in a project. See [`skills/README.md`](../skills/README.md) for other agents.

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
| `slide_add_markdown` | write | `catalogId`, `slideId`, `markdown` (≤ 20,000 characters), `position?`, `style?`, `name?` |
| `markdown_update` | write | `catalogId`, `elementId`, `markdown?`, `style?` |
| `slide_add_table` | write | `catalogId`, `slideId`, `columns[]` + `rows[][]` **or** `csv`, `header?` (default true), `position?`, `style?`, `name?` |
| `table_update` | write | `catalogId`, `elementId`, `ops[]?` (applied in order as one change), `style?` |

Backgrounds: `{"kind":"color","color":"token:primary"}`, `{"kind":"gradient","from":"#111","to":"#333","angle":135}`, `{"kind":"image","assetId":"ast_…"}`.

Element JSON:

```jsonc
// text — align: "start" | "center" | "end"; direction: "auto" | "rtl" | "ltr"
{"type":"text","position":{"x":120,"y":120,"width":900,"height":140},
 "content":{"paragraphs":[[{"text":"Autumn "},{"text":"Collection","bold":true}]]},
 "style":{"fontFamily":"token:heading","fontSize":72,"fontWeight":700,"color":"token:text","align":"start"}}

// shape — rect | ellipse | triangle | line | arrow
{"type":"shape","position":{"x":0,"y":0,"width":640,"height":1080},"content":{"shape":"rect"},"style":{"fill":"token:accent"}}

// path — a pen-tool line or shape, scaled to its box. Send SVG path data ("d", first subpath; M L H V C S Q T Z,
// arcs become straight lines) with an optional viewBox, or "points": anchors normalized to the box (0..1) with
// optional bezier handles "in"/"out" relative to the anchor, plus "closed". fill is optional ("none" = open stroke).
{"type":"path","position":{"x":200,"y":300,"width":600,"height":300},
 "content":{"d":"M10 80 C40 10 65 10 95 80","viewBox":{"width":100,"height":100}},
 "style":{"stroke":"token:primary","strokeWidth":6,"lineCap":"round","lineJoin":"round","dash":[],"fill":"none"}}

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

Markdown and tables:

```jsonc
// markdown — GitHub-flavored; raw HTML is ignored, links only http(s)/mailto/tel. Sizes in document pixels.
{"type":"markdown","position":{…},"content":{"markdown":"# Agenda

- [x] Launch
- [ ] Review"},
 "style":{"baseFontSize":24,"fontFamily":"token:body","headingFontFamily":"token:heading","color":"token:text","linkColor":"token:primary","align":"start"}}

// table — up to 50 columns × 500 rows, 1,000 characters per cell; rows hold cell text in column order
{"type":"table","position":{…},
 "content":{"header":true,"columns":[{"id":"c1","label":"Item"},{"id":"c2","label":"Price","align":"end","format":"currency"}],
            "rows":[["Pen","1.5"],["Book","12"]]},
 "style":{"fontSize":20,"headerBackground":"token:primary","headerColor":"token:on-primary","zebra":true,"borderColor":"token:muted","borderWidth":1,"density":"normal"}}
```

`slide_add_table` takes `columns` as labels (`["Item","Price"]`) or objects (`{"label":"Price","align":"end","format":"currency","width":2}`), and numbers in `rows` are stored as text; or pass `csv` (comma, semicolon or tab separated; the first row becomes the header). Column formats: `text` (as typed), `number`, `currency` (catalog currency), `percent`, `date`. `table_update` ops (0-based body row/column indexes; the header is not a row):

| Op | Fields |
| --- | --- |
| `setCell` | `row`, `column`, `value` |
| `setCells` | `row`, `column`, `values[][]` (grows the table when needed) |
| `insertRows` / `deleteRows` | `index`, `count?`; `insertRows` also takes `values[][]` |
| `insertColumns` / `deleteColumns` | `index`, `count?`; `insertColumns` also takes `labels[]` |
| `moveRow` / `moveColumn` | `from`, `to` |
| `updateColumn` | `column`, `changes` (`label`, `align`, `format`, `width`) |
| `setHeader` | `header` |

`catalog_get` outlines show markdown as plain text (with its first heading as `title`) and tables as `columns`, `rows` (count), `header` and their first rows as text.

Colors: hex or theme tokens `token:background`, `token:text`, `token:muted`, `token:primary`, `token:on-primary`, `token:accent`. Prefer tokens so `catalog_apply_theme` restyles everything.

### Products and images

| Tool | Permission | Input | Notes |
| --- | --- | --- | --- |
| `catalog_import_products` | write | `catalogId`, `products[]` (fields below), `addSlides?` (`none`/`single`/`per-category`), `columns?`, `source?` | Upserts by `id`; downloads `imageUrl`/`imageUrls`; can add product-grid slides (6 per slide) |
| `asset_import` | write | `catalogId`, `name`, and `url` **or** `data` (base64) + `mimeType` | For cover photos, backgrounds, logos. Returns `assetId`, `width`, `height` |

Product fields (all optional except `name`; `catalog_generate` accepts the same):

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Updates the product with this id, otherwise creates one |
| `name` | string | Required |
| `subtitle` | string, max 200 | Short tagline under the name |
| `description` | string | |
| `brand`, `category`, `sku` | string | |
| `price` | number | |
| `compareAtPrice` | number ≥ 0 | Original price; shown struck through with the discount when higher than `price` |
| `currency` | 3-letter code | Defaults to the catalog currency |
| `unit` | string, max 30 | After the price, e.g. `"per m²"`, `"/ kg"` |
| `badge` | string, max 30 | Label over the photo, e.g. `"New"`, `"Sale"` |
| `availability` | `in-stock`, `out-of-stock`, `pre-order`, `limited` | |
| `rating` | number 0–5 | Shown as stars |
| `tags` | string[] | Search keywords in the editor; not shown on cards |
| `url` | https URL | "View product" link |
| `attributes` | object | Specs as label → value, in display order |
| `imageUrl` | https URL | Primary image |
| `imageUrls` | https URL[], max 10 | More images, after `imageUrl` |

Product cards and grids choose what to show with optional style flags (unset means the default): `showImage`, `showName`, `showBrand`, `showSubtitle`, `showCompareAtPrice`, `showBadge`, `showAvailability`, `showRating` (default `true`), `showSku`, `showLink` (default `false`), plus `showPrice`, `showDescription`, `showAttributes` and `maxAttributes` (default 8). For example `slide_update_element` with `changes: {"style":{"showSku":true,"showLink":true}}`. The catalog outline lists each product's id, name, price, brand, category, badge and availability.

Image downloads accept public **https** URLs only (private network and cloud-metadata addresses are refused) and PNG, JPEG, GIF or WebP up to 8 MB; base64 `data` can be up to 15 MB. `catalog_import_products` downloads at most 60 images (`imageUrl` plus `imageUrls`) per call — import large lists in batches.

### Fonts

| Tool | Permission | Input | Notes |
| --- | --- | --- | --- |
| `font_list` | read | `catalogId` | Theme heading/body fonts, font files stored in the catalog (family, weight, style, `assetId`), families loaded from Google Fonts by name, and how many text elements use each |
| `font_add_google` | write | `catalogId`, `family` (exact name from fonts.google.com), `weights?` (default `[400,600,700]`), `italic?`, `embed?` (default `true`), `applyTo?` (`heading`/`body`/`both`) | With `embed` the complete font files (every script) are stored in the catalog, so PDF, JPG, video and offline HTML exports don't depend on Google. Missing weights are skipped and reported |
| `font_upload` | write | `catalogId`, `family`, `url` (https) **or** `data` (base64), `weight?`, `style?` (`normal`/`italic`), `name?`, `applyTo?` | One face per call: TTF, OTF, WOFF or WOFF2 up to 15 MB, checked from the file's contents. For brand or licensed fonts — only upload fonts whose license allows embedding |
| `font_apply` | write | `catalogId`, `family`, `theme?` (`heading`/`body`/`both`), `elementIds?`, `weight?` | Sets theme roles (everything using `token:heading` / `token:body` follows) and/or specific text elements |
| `font_remove` | write | `catalogId`, `family` **or** `assetId` | Removes stored files; text keeps its family name and falls back to Google Fonts by name or a system font. Reports where the family is still used |

A family stored in the catalog is used instead of Google Fonts for that name, so embed every weight you use (the browser synthesises missing bold or italic faces, which looks worse).

### Motion

| Tool | Input |
| --- | --- |
| `catalog_set_transition` | `catalogId`, `slideId`, `type` (`none`, `fade`, `morph`, `slide`, `push`, `zoom`, `wipe`, `flip`), `durationMs?`, `direction?`. `morph` moves elements shared with the previous slide (same `morphKey`/id, layer `name`, or unique content) |
| `catalog_animate_element` | `catalogId`, `elementId`, `category` (`entrance`, `emphasis`, `exit`, `keyframes`), `preset` (`appear`, `fade`, `slide`, `scale`, `bounce`, `rotate`, `spin`, `flip`, `zoom`, `grow`, `shrink`, `rise`, `blur`, `float`, `pulse`; paths also `draw`, `erase`, `trace`; `custom` for keyframes), `trigger?` (`on-enter`, `after-previous`, `with-previous`, `on-click`), `durationMs?`, `delayMs?`, `direction?`, `easing?` (`linear`, `ease-in`, `ease-out`, `ease-in-out`, `spring`), `reverse?`, `fillAfterDraw?`, `iterations?`, `loop?`, `playDirection?` (`normal`, `alternate`), `keyframes?` |

Path animations: **draw** (entrance) reveals the stroke from the path start to its end (`reverse: true` goes end → start; `fillAfterDraw: true` fades the fill in afterwards), **erase** (exit) removes it the same way, **trace** (emphasis) runs a short dash along the path — add `loop: true` to repeat it until the slide ends.

Keyframes: `{"category":"keyframes","preset":"custom","durationMs":2000,"loop":true,"playDirection":"alternate","keyframes":[{"offset":0,"y":0,"easing":"ease-in-out"},{"offset":0.5,"y":-40,"scale":1.1},{"offset":1,"y":0}]}`. Each keyframe has an `offset` (0–1) and any of `x`, `y` (px offsets), `scale`, `rotation` (degrees), `opacity` (0–1) and, for paths, `drawProgress` (0–1); its `easing` shapes the motion to the next keyframe. Properties a keyframe leaves out are interpolated between the keyframes that set them.

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
4. Set the brand fonts: `font_add_google` (or `font_upload` for a brand font file) with `applyTo: "both"`.
5. `asset_import` a cover photo, then `slide_update` the cover with `background: {"kind":"image","assetId":…}` (add a semi-transparent shape above it for legible text).
6. `catalog_preview` each changed slide and fix overlaps.
7. Give the user the `editorUrl`; export or publish when they're happy.

### Right-to-left catalogs (Persian, Arabic, Hebrew)

- Create with `language: "fa"` (or `ar`, `he`, `ur`). The catalog becomes right-to-left; `align: "start"` is right.
- Leave `direction` on `auto`; paragraphs that start with Persian are RTL even if they contain `(UPVC)`.
- Put phone numbers, codes and URLs in their own text element with `direction: "ltr"`.
- Never insert bidi control characters (U+202A–U+202E, U+2066–U+2069).
- Choose a font with the script and embed it: `font_add_google` with `{"family":"Vazirmatn","weights":[400,700,800],"applyTo":"both"}` (or `Noto Naskh Arabic`, `Noto Sans Hebrew`). Embedded fonts render the same in previews, PDF and video.

### Hand the result to the user

Every create/generate/get result has an `editorUrl`. Opening it while signed in downloads the catalog into the browser and opens the editor.

---

## 4. Product sources (MCP connections)

**Settings → MCP connections → Connect**: a name, the server URL, transport (Streamable HTTP, or SSE for older servers) and authentication (none, bearer credential, or a custom header such as `X-API-Key`). Kavero tests the connection and lists its tools. Secrets are encrypted at rest and never sent back to the browser.

Then in the editor, **Import products** → choose the source and tool → adjust the JSON arguments → **Fetch products** → review → **Add to catalog** (with images, and optionally new product slides). **Generate with AI** can use the same sources.

Kavero recognises common result shapes automatically: arrays of products (WooCommerce/REST style), GraphQL `edges[].node` (Shopify style), nested `data`/`items`/`products`, prices as numbers, strings or `{amount, currencyCode}`, images as URLs or `{src|url}` objects.

Local (stdio) MCP servers need the desktop app's companion, which isn't available yet; run them behind a Streamable HTTP bridge in the meantime.

---

## Security notes

- API keys are scoped and expiring; store them like passwords. A leaked key can be revoked instantly.
- Deleting requires the `catalogs:delete` permission **and** `confirm: true` — agents should ask the user first.
- Agents act with the API key owner's workspace roles: a viewer's key can't edit workspace catalogs.
- HTML from agents is sanitized and rendered in a sandbox; it can't run scripts.
