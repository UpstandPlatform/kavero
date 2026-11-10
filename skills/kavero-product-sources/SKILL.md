---
name: kavero-product-sources
description: Get products and images into Kavero catalogs over MCP — catalog_import_products (upsert by id, price/currency/attributes/category, imageUrl downloads, auto product-grid slides), asset_import for photos and logos (https URL or base64, size/type limits), mapping data from Shopify, WooCommerce, CSV/spreadsheets or another MCP server the agent is connected to, paginating large catalogs across slides, and keeping product cards linked and editable. Use when the user gives a product list, spreadsheet, store, PIM, feed or URLs to put in a catalog, wants to update prices/stock data, add product photos, or build a catalog with many products.
---

# Getting products into Kavero

Products live in the catalog's product list; `product` and `product-grid` elements **reference** them by id. Update a product once and every card showing it changes — so always import products and use product elements, never retype names and prices into text boxes.

## Where products come from

Kavero's MCP server has no tools for reading stores. You fetch the data, map it, then call `catalog_import_products`:

- **Another MCP server connected to your client** (Shopify, WooCommerce, PIM, database): call its tools, map the result (see `references/field-mapping.md`).
- **File or paste** (CSV, Excel, JSON, a table in chat): parse it yourself.
- **Web pages**: only if the user asks and the data is theirs to use; never scrape behind logins.

Kavero's own **Settings → MCP connections** (product sources the user registers in Kavero) are used from the editor's **Import products** dialog and **Generate with AI** — not over MCP. If the user already set one up there and has no agent-side connection, tell them to import from the editor instead.

## catalog_import_products

`{catalogId, products[1–500], addSlides?, columns?, source?}` — scope `catalogs:write`.

| Product field | Rules |
| --- | --- |
| `id` | ≤ 100 chars. **Set a stable id** (`"sku-AB123"`, the store's id) so re-imports update instead of duplicating. Omitted → a new `prd_…` id every time |
| `name` | required, 1–200 chars |
| `description` | ≤ 2000 chars, plain text — strip HTML, keep 1–3 sentences for cards |
| `sku` | ≤ 100 chars |
| `price` | a **number** (`129.9`, not `"€129,90"`); omit if unknown or not shown |
| `currency` | 3-letter ISO (`EUR`); uppercased for you. Omit to use the catalog currency |
| `url` | product page (http/https) |
| `category` | ≤ 100 chars; drives `per-category` slides |
| `attributes` | flat `{"Material":"Leather","Weight":"1.2 kg"}`, string → string. Shown when a card has `showAttributes: true`; keep 3–6 short specs |
| `imageUrl` | public **https** image; downloaded and stored with the catalog |

Behavior:

- **Upsert by `id`**: fields you send replace those fields; most fields you omit are kept, and an existing product keeps its image if you send no new `imageUrl`. **Exception:** omitting `currency` or `source` on a re-import clears them — always resend both.
- **Images**: at most **60 `imageUrl`s are downloaded per call** — further ones are silently skipped. With many products, call in batches of ≤ 60 products that have images. Failed downloads come back in `warnings` (`"<name>: image not imported (…)"`); the product is still imported.
- `addSlides`: `none` (default) | `single` (all products under "Products") | `per-category` (one section per `category`). Each slide gets a heading and a `product-grid` with **at most 6 products**; more products → more slides. `columns` 1–6 (default 3; use 2 on portrait pages). Slides are appended at the end.
- Returns `productIds` (same order as input), `imagesImported`, `warnings`, `createdIds`.
- `source`: free label (`"shopify"`, `"woocommerce"`, `"csv"`), stored on each product for traceability.

`catalog_generate` accepts the same product objects (≤ 500, ≤ 60 image downloads) and designs the whole catalog around them.

## asset_import (cover photos, backgrounds, logos, variant photos)

`{catalogId, name, url}` **or** `{catalogId, name, data, mimeType}` — never both.

- `url`: public **https** address (plain http only reaches a local dev server). Private-network and cloud-metadata addresses are refused; ≤ 5 redirects, 15 s timeout, **≤ 8 MB**; PNG, JPEG, GIF or WebP.
- `data`: base64 (a `data:` prefix is fine) with `mimeType` `image/png` | `image/jpeg` | `image/gif` | `image/webp`; **≤ 15 MB** decoded. Use when you have a local file and no public URL.
- Returns `assetId`, `width`, `height`, `alreadyPresent`. Same bytes → same `assetId` (no duplicates), so re-importing is safe.
- Use `width`/`height` to size the image element without distortion, or set `fit: "cover"`/`"contain"`.
- Place it: `slide_add_element` `{"type":"image","content":{"assetId":"…","alt":"…"}}` or `slide_update` `{"background":{"kind":"image","assetId":"…"}}`.
- Product photos only attach through `imageUrl` on `catalog_import_products`. If a product's photo exists only as a local file, `asset_import` it and place it as an `image` element beside the card (or have the user set it on the product in the editor).

## Large catalogs

1. Import in batches (≤ 500 products per call; ≤ 60 with images per call), with stable ids.
2. Group by category; order categories the way the user sells (bestsellers first).
3. Per category: a divider slide, then product-grid slides of **≤ 6 products** (3×2 on 16:9, 2×3 on A4 portrait). Grids allow up to 8 columns, but cards get too small past 6 per slide.
4. Feature 1–3 hero products per category with a single large `product` card (`showAttributes: true`).
5. Keep the deck under ~24 slides for screens; for a full price list (hundreds of items) prefer `a4-portrait` with 6 per page, or ask whether a shortlist is better.
6. `catalog_preview` a sample of grid slides (first, a long-named product, last) to check names and prices fit.

Building grids yourself (instead of `addSlides`):

```json
{"catalogId":"<catalogId>","slideId":"<slideId>","elements":[
 {"type":"text","position":{"x":76,"y":76,"width":1768,"height":90},
  "content":{"paragraphs":[[{"text":"Bags"}]]},"style":{"fontFamily":"token:heading","fontSize":56,"fontWeight":700}},
 {"type":"product-grid","position":{"x":76,"y":200,"width":1768,"height":804},
  "content":{"columns":3,"products":[{"productId":"sku-B1"},{"productId":"sku-B2"},{"productId":"sku-B3"},
   {"productId":"sku-B4"},{"productId":"sku-B5"},{"productId":"sku-B6"}]},
  "style":{"gap":32,"imageFit":"contain","showDescription":false}}]}
```

A4 portrait grid: `{"x":56,"y":140,"width":682,"height":927}`, `columns: 2`, `gap: 20`.

## Keeping cards editable and correct

- Card options (`style`): `layout` `vertical` | `horizontal` | `overlay`, `showPrice`, `showDescription`, `showAttributes`, `imageFit` `contain` (cut-outs, default) | `cover` (lifestyle photos), `background`, `borderRadius`; grids add `gap`.
- Price updates: re-run `catalog_import_products` with the same ids and `{id, name, price, currency}` — `name` is required on every product, and `currency` would otherwise be cleared.
- Hide prices for a B2B/lookbook version with `showPrice: false` on cards instead of deleting prices.
- After importing, `catalog_get` lists `products` (id, name, price, currency) — check every product is used at least once and no card or grid references an id that isn't in the list.
- RTL catalogs: keep `price` numeric and `currency` set (e.g. `IRR`); names, descriptions and attribute values can be Persian/Arabic — don't add bidi control characters.

## Don'ts

- Don't put prices or names in text boxes when a product card can show them.
- Don't send HTML in `description`, currency symbols in `price`, or nested objects in `attributes`.
- Don't pass `http://`, intranet or signed/expiring URLs as images — they fail or break later; use base64 `asset_import` for local files.
- Don't import the same products without ids twice — you'll get duplicates.
