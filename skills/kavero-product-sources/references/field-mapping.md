# Mapping product data to Kavero

Target shape for `catalog_import_products` (`products[]`):

```json
{"id":"sku-AB123","name":"Weekender Bag","description":"Full-grain leather, fits a 15\" laptop.",
 "sku":"AB123","price":129.9,"currency":"EUR","url":"https://shop.example.com/weekender",
 "category":"Bags","attributes":{"Material":"Leather","Volume":"38 L"},
 "imageUrl":"https://cdn.example.com/weekender.jpg"}
```

General rules: `price` is a number in major units (euros, not cents); strip HTML and shorten `description`; flatten `attributes` to strings; pick **one** image (the main photo, ideally on a plain background); skip products without a name; de-duplicate by id.

## Shopify (GraphQL Admin / Storefront, `edges[].node`)

| Shopify | Kavero |
| --- | --- |
| `id` (`gid://shopify/Product/123`) or `handle` | `id` — e.g. `"shopify-123"` or the handle |
| `title` | `name` |
| `description` (plain) — or `descriptionHtml` with tags stripped | `description` |
| `variants.edges[0].node.sku` | `sku` |
| `priceRange.minVariantPrice.amount` (string) / `variants…price` | `price` — `parseFloat` |
| `priceRange.minVariantPrice.currencyCode` | `currency` |
| `onlineStoreUrl` | `url` |
| `productType` or first collection title | `category` |
| `options` (`[{name:"Color",values:[…]}]`) | `attributes` — `{"Color":"Navy, Sand"}` |
| `featuredImage.url` / `images.edges[0].node.url` | `imageUrl` |

Variants: one product per sellable item for price lists; one product with a joined `attributes` value ("Sizes": "S, M, L") for lookbooks. If variant prices differ, use the lowest and say "from" in a text label, or import variants as separate products with ids like `shopify-123-navy`.

## WooCommerce (REST `/wp-json/wc/v3/products`)

| WooCommerce | Kavero |
| --- | --- |
| `id` | `id` — `"wc-<id>"` |
| `name` | `name` |
| `short_description` (HTML) → strip; fall back to `description` | `description` |
| `sku` | `sku` |
| `price` (string, e.g. `"129.90"`) | `price` — `parseFloat` |
| store currency (settings / `currency` on orders) | `currency` |
| `permalink` | `url` |
| `categories[0].name` | `category` |
| `attributes[]` (`{name, options[]}`) | `attributes` — `{name: options.join(", ")}` |
| `images[0].src` | `imageUrl` |

Skip `status != "publish"` and, if the user wants, `stock_status == "outofstock"`.

## CSV / spreadsheets

Typical columns → fields: `Name|Title|Product` → `name`; `Price|Unit price` → `price` (remove currency symbols and thousands separators; `1.299,00` in German/Persian formats → `1299`); `Currency` → `currency`; `Category|Collection|Group` → `category`; `SKU|Code|Art. no.` → `sku` and `id`; `Image|Image URL|Photo` → `imageUrl`; every other short column (`Color`, `Size`, `Material`, `Weight`) → `attributes`.

Ask the user when a column's meaning is unclear (e.g. two price columns: retail vs wholesale).

## Generic JSON / other MCP servers

Look for the product array at the top level or under `data`, `items`, `products`, `results`, or GraphQL `edges[].node`. Prices may be numbers, strings or `{amount, currencyCode}`; images may be strings or `{src}` / `{url}` objects. Map, then preview 2–3 mapped products to the user before importing hundreds.

## Batching example (230 products, all with images)

```text
catalog_import_products  products[0..59]    source:"shopify"  addSlides:"none"
catalog_import_products  products[60..119]  source:"shopify"
catalog_import_products  products[120..179] source:"shopify"
catalog_import_products  products[180..229] source:"shopify"
→ then build category dividers and 6-per-slide product-grid slides yourself
  (or pass addSlides:"per-category" on each batch — slides are appended per batch, so
   a category split across batches gets separate slides; group products by category
   before batching if you use it).
```
