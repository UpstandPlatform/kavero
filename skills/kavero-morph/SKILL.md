---
name: kavero-morph
description: Build PowerPoint-style Morph ("magic move") sequences in Kavero catalogs over MCP — elements shared between consecutive slides glide to a new position, size, rotation, color and font size. Covers matching elements with morphKey/name (slide_add_element, slide_update_element), catalog_set_transition type "morph", timing, and worked recipes (product zooms from a grid into a detail view, a title moves aside to reveal specs, a selector highlights a variant and price). Use when the user asks for morph, magic move, smooth/cinematic transitions between slides, "zoom into a product", "animate from the grid to the product", or a Keynote/PowerPoint Morph-like story.
---

# Morph storytelling in Kavero

Morph plays when a slide whose transition is `morph` appears. Every element that **matches** one on the previous slide (by slide order) moves from its old geometry and style to the new one; everything else cross-fades. It plays the same in the editor Preview, published websites, single-file HTML and MP4. PDF shows finished slides; PowerPoint gets no transition (see `kavero-publish-export`).

For general motion taste (entrances, stagger, durations) see `kavero-animations`. For layout and type sizes see `kavero-catalogs`.

## How elements match (animation-engine `matchMorph`)

Only **visible** elements of the **same `type`** are paired, each at most once, in this order:

1. **Identity** — an element's `id` or `morphKey` equals the other element's `id` or `morphKey`. Two elements with the same `morphKey` always match.
2. **Same layer `name`** (the name shown in the Layers panel).
3. **Same unique content** — same text, image `assetId`, `productId`, product-grid product list, button label, shape kind, icon or video — and only if it appears exactly once on each slide.

Rule 3 is fragile (two rectangles on a slide never match by content). **Always set both `morphKey` and `name` on elements you want to morph.** `morphKey` is a free string, max 100 chars.

What interpolates: `position` (x, y, width, height, rotation — the short way round), `opacity`, and every numeric or color value in `style` (font size, border radius, stroke width, gap, fill/stroke/text colors — theme tokens are resolved first, so `token:text` → `token:primary` animates). Booleans and enums (`showPrice`, `fit`, `align`) switch halfway. If the **content** differs (new text, other image, other product) the old and new content cross-fade inside the moving box.

## There is no "duplicate slide" MCP tool

The editor's **Duplicate slide** (Ctrl Shift D) copies a slide, gives every copy `morphKey` = original id and sets `morph` (900 ms) automatically. Over MCP, rebuild the second slide yourself:

1. `catalog_get` with `full: true` and copy the first slide's `elements`.
2. For each element: **drop `id`** (ids are unique across the whole catalog) and **drop `animations`** (their ids would collide, and matched elements skip entrances anyway). Keep or add `morphKey` and `name`.
3. Change what should move: `position`, `style`, `opacity`, or content.
4. `slide_create` (use `index` to place it right after the first slide) → `slide_add_element` with the edited elements (≤ 50 per call).
5. `catalog_set_transition` on the **new** slide: `{"type":"morph","durationMs":1000}`.

To make existing elements matchable, add keys afterwards: `slide_update_element` with `{"changes":{"morphKey":"hero","name":"Hero"}}`. `catalog_get` without `full` doesn't show `name`/`morphKey`; use `full: true` to check.

## Planning a morph sequence

1. Write the story as frames: "grid of 3 → product 1 fills the left half → specs appear on the right → back to the grid".
2. List the shared elements and give each one key (`hero-photo`, `title`, `card-prd_a`). Keep the key on every slide in the chain.
3. Decide per frame what moves, grows, recolors, or enters. Change 1–3 things per step; move far enough to be noticed (≥ 150 px or ≥ 1.5× size).
4. Build slide 1 completely and `catalog_preview` it, then derive the next slide from it.
5. Set `morph` on every slide after the first in the chain. Preview each slide; motion itself is visible only in the editor's Preview or the published site — tell the user where to look.

## Timing and settings

- `catalog_set_transition`: `type: "morph"`, `durationMs` **800–1200** (default is only 500 if omitted — always pass it). Easing is `ease-in-out` by default and isn't settable over MCP. `direction` is ignored for morph.
- Big moves / full-page zooms: 1000–1200 ms. Small nudges (selector, price): 700–900 ms.
- For autoplay/video, give morph slides `slide_update` `durationMs` ≥ transition + 2500 ms so the end state can be read.

## Tricks

- **Fade an element in or out while it moves:** pair it with a copy at `"opacity": 0` on the other slide.
- **Slide something off the page:** move the copy beyond the page (e.g. `x: 1960` on 1920-wide) instead of deleting it, so it travels out rather than fading.
- **Recolor a block:** same shape and key, `fill` `token:background` → `token:primary`; put its text from `token:text` → `token:on-primary`.
- **Swap a photo in place:** same `morphKey`, different `assetId` → the photo cross-fades while the box moves.
- **Change words smoothly:** same key, new paragraphs → text cross-fades while size/position animate (e.g. price `€129` → `€149`).
- Entrance animations are fine on **unmatched** elements of the new slide (specs, captions). The slide's animation clock starts when the transition starts, so delay the first one by about the morph duration: `trigger: "on-enter"`, `delayMs` = morph `durationMs` − 200, then chain the rest with `after-previous` / `with-previous`. Chains run in layer order (`zIndex`; later-added elements are higher), not in the order you call the tool.

## Don'ts

- Don't add entrance animations to matched elements — after a morph they're shown at rest and their entrances are skipped.
- Don't set `morph` between unrelated slides: with nothing matched it's just a cross-fade. Use `fade`/`push` there.
- Don't reorder slides in a chain without re-checking: matching uses the slide immediately before.
- Don't rely on `hidden: true` elements — hidden elements are never matched.
- Don't pair different types (a `product` card never morphs into an `image`; use the product card on both slides, or images on both).
- Don't use a `product-grid` when one product must fly out of it — a grid morphs as one block. Use individual `product` cards (see recipe 1).
- RTL catalogs: mirror the story (detail photo on the right, text on the left; things leave towards the left).

## Recipes

Full tool-call sequences with coordinates for 1920×1080 (and A4 notes) are in `references/recipes.md`:

1. **Grid → product detail zoom** — one product card grows from a 3-up line-up into the hero; the others slide out.
2. **Title moves aside to reveal specs** — a centered cover title shrinks into a heading, the photo docks left, specs fade in.
3. **Variant & price highlight** — a selector ring moves between color swatches; the photo and price cross-fade and the price turns accent-colored.

## Checklist

- [ ] Every shared element has the same `morphKey` (and `name`) on both slides, same `type`, not hidden.
- [ ] `morph` set on the later slide with an explicit `durationMs` (800–1200).
- [ ] No entrance animations on matched elements; unmatched newcomers start after the morph (`delayMs` ≈ morph duration).
- [ ] Both slides look finished on their own (`catalog_preview` each one) — PDF readers see only these states.
- [ ] Told the user to watch it in Preview / on the published site, and that PowerPoint export has no Morph.
