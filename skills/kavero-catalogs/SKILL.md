---
name: kavero-catalogs
description: Build professional product catalogs and presentations in Kavero through its MCP server (catalog_create, catalog_generate, slide_add_element, catalog_import_products, asset_import, font_add_google, font_upload, catalog_preview, catalog_publish…). Use when the user asks to create, design, fill, restyle or fix a Kavero catalog, lookbook, price list, product presentation or brochure — including right-to-left (Persian, Arabic, Hebrew) catalogs.
---

# Building catalogs with Kavero

Kavero catalogs are slide documents. Everything you create stays editable by the user, so build with real elements (text, shapes, images, product cards), never flattened pictures of text.

## Workflow

1. **Understand the brief.** Audience (consumers, wholesale buyers, investors), tone, language, page format (screen = `16:9`; print = `a4-portrait`), number of products, whether prices are shown.
2. **Start fast, then refine.**
   - Many products, standard structure → `catalog_generate` (brief + products with `imageUrl`). It plans sections and lays out slides.
   - Specific design → `catalog_create` with the closest template, then `catalog_import_products` and your own slides.
3. **Read before you edit.** `catalog_get` gives slide ids, element ids, positions and text. Edit existing elements with `slide_update_element` rather than stacking new ones on top.
4. **Images.** `asset_import` cover photos, logos and backgrounds (URL or base64); product photos come in through `imageUrl` on products.
5. **Check every slide you touch** with `catalog_preview`. Look for overlaps, text overflowing its box, empty placeholders, low contrast, and anything touching the page edge.
6. **Hand over.** Give the user the `editorUrl`. Export (`catalog_export_pdf` / `catalog_export_pptx`) or publish (`catalog_publish`, default `unlisted`) only when asked.

Batch work: `slide_add_element` accepts up to 50 elements per call; `catalog_import_products` up to 500 products.

## A standard catalog

| # | Slide | Content |
| --- | --- | --- |
| 1 | Cover | Brand/collection name (largest type in the catalog), one-line subtitle, hero image or bold color field, logo |
| 2 | Intro *(optional)* | 2–4 sentences about the brand or collection; contents list for 10+ slides |
| 3 | Category divider | Category name + short line, accent color block or image — one per category |
| 4 | Product grid | Heading + `product-grid`, **max 6 products** (3×2 landscape, 2×3 portrait) |
| 5 | Featured product | One `product` card large + name, persuasive description, specs, price |
| 6 | Comparison / pricing | 2–3 products or tiers side by side with the recommended one highlighted |
| 7 | Services / why us *(optional)* | 3–6 short points with icons or shapes |
| 8 | Closing / contact | Call to action, contact details, `button` with a link for the website version |

Repeat 3–5 per category. Keep 8–24 slides; split anything denser.

## Layout rules

- Work on a margin grid: **margin = 7% of the short side** (≈76 px on 1920×1080, ≈56 px on A4 portrait). Nothing touches the page edge unless it's a deliberate full-bleed block or background.
- Align elements to shared edges; equal gaps between repeated items. Use `references/layouts.md` for ready coordinates.
- One focal point per slide. White space is part of the design.
- Product cards: leave room for name, description and price under the photo; use `imageFit: "contain"` for product photos (cut-outs, tall or wide items) and `"cover"` only for lifestyle photos.
- Show specs with `showAttributes: true` on product cards instead of building separate text boxes.

## Typography

| Role | 16:9 (1920×1080) | A4 portrait (794×1123) | Weight |
| --- | --- | --- | --- |
| Cover title | 96–120 | 44–56 | 700–800 |
| Slide heading | 56–72 | 28–36 | 700 |
| Subheading / product name | 32–40 | 18–22 | 600 |
| Body | 24–28 | 12–14 | 400 |
| Caption / small print | 18–20 | 9–10 | 400 |

- Use `token:heading` / `token:body` fonts and set them once for the whole catalog.
- **Fonts:** add them with `font_add_google` (`{"family":"Playfair Display","weights":[400,700],"applyTo":"heading"}`) or `font_upload` for a brand font file, then `font_list` to check. Keep the default `embed: true` so previews, PDF and video use the exact font; embed every weight you use. Use `font_apply` with `elementIds` for one-off text (a script logo, a price in a display face). Two families at most: one for headings, one for body.
- Line height 1.1–1.2 for headings, 1.4–1.5 for body. Keep body lines under ~70 characters.
- Make text boxes tall enough for their text; long copy belongs on its own slide, not squeezed into small type.

## Color

- Use theme tokens (`token:primary`, `token:accent`, `token:text`, `token:muted`, `token:background`, `token:on-primary`) so the user can restyle with one `catalog_apply_theme` call.
- Text on images: put a shape with `opacity` 0.4–0.6 between the image and the text, or place text on a solid color block.
- One accent color for emphasis (prices, highlights, the recommended tier). Check contrast in `catalog_preview`.

## Right-to-left catalogs (Persian, Arabic, Hebrew, Urdu)

- Create with `language: "fa"` / `"ar"` / `"he"` / `"ur"`. The page direction becomes RTL; `align: "start"` is the right edge. Mirror layouts: hero image on the left, text on the right.
- Keep `direction: "auto"` (default) so each paragraph follows its first letter; `شیر توپی (UPVC)` renders correctly.
- Phone numbers, codes, URLs and email addresses go in their **own** text element with `direction: "ltr"`.
- **Never** insert Unicode bidi control characters (U+202A–U+202E, U+2066–U+2069). They break editing.
- Pick a font that covers the script and embed it with `font_add_google` (`applyTo: "both"`): Vazirmatn (Persian), Noto Naskh Arabic / Cairo (Arabic), Rubik / Heebo (Hebrew). Embedded files include every script, so mixed Persian/Latin text renders correctly.
- Persian digits (۰۱۲۳) are fine in text; keep prices numeric in product data (`price: 120000`, `currency: "IRR"`).

## Templates

| Category | Templates |
| --- | --- |
| General | `minimal`, `studio` |
| Fashion | `dark-luxury`, `atelier` |
| Jewelry & watches | `maison` |
| Electronics | `tech` |
| Furniture & home | `natural` |
| Cosmetics | `glow` |
| Food & drink | `harvest` |
| Real estate | `estate` |
| Industrial & tools | `forge` |
| Automotive | `velocity` |

## Quality checklist (run before handing over)

- [ ] Every slide previewed; no overlaps, no overflowing or clipped text, nothing off-page.
- [ ] No placeholder text ("Product name", "Category name", lorem ipsum) left.
- [ ] Every product appears at least once; prices/currency correct or deliberately hidden.
- [ ] Headings consistent in size and position across slides of the same kind.
- [ ] Images have `alt` text; covers and backgrounds are legible.
- [ ] RTL catalogs: no bidi control characters; phone numbers in LTR boxes.
- [ ] Gave the user the `editorUrl`; motion added only if requested (see the `kavero-animations` skill).
