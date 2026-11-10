---
name: kavero-animations
description: Add tasteful element animations and slide transitions to Kavero catalogs with catalog_animate_element and catalog_set_transition (and slide durations for video/website playback). Use when the user asks for motion, animation, transitions, a more dynamic or "animated" catalog, an animated website, or an MP4 video of a Kavero catalog.
---

# Animating Kavero catalogs

Motion in Kavero is data, not code: it plays identically in Preview, on published websites and in MP4 exports. PDF shows each slide's finished state; PowerPoint keeps content but not motion. Good motion guides the eye in reading order and then gets out of the way.

## Tools

- `catalog_animate_element` — `elementId`, `category` (`entrance` | `emphasis` | `exit`), `preset` (`fade`, `slide`, `scale`, `bounce`, `rotate`, `blur`, `float`, `pulse`), `trigger` (`on-enter` = with the slide, `after-previous`, `with-previous`), `durationMs`, `delayMs`, `direction` (for `slide`: `up`, `down`, `left`, `right`).
- `catalog_set_transition` — `slideId`, `type` (`none`, `fade`, `morph`, `slide`, `push`, `zoom`, `wipe`, `flip`), `durationMs`, `direction`. Plays when that slide appears.
- `slide_update` — `durationMs`: how long a slide stays on screen in video and autoplay.
- Get element ids from `catalog_get`; check timing with the user in Preview.
- `after-previous` / `with-previous` chain in layer order (`zIndex`, bottom to top), not in the order you add animations. The document schema also knows an `on-click` trigger and `motion-path`/`custom` animations, but the MCP tool doesn't accept them — don't try to set them.

## Principles

1. **Order = reading order.** Heading first, then supporting text, then images/products. Chain with `after-previous` (or `with-previous` for things that belong together).
2. **Short and quick.** Entrances 400–800 ms; stagger 80–150 ms between siblings; a slide's whole entrance sequence ≤ 1.5 s.
3. **One style per catalog.** Pick a family (fade + slide-up is the safe default) and reuse it. Don't mix bounce, rotate and blur on one slide.
4. **Animate less than you can.** 2–4 animated elements per slide; leave backgrounds, decorative shapes and long body text static or simply fading.
5. **Emphasis is rare.** At most one `pulse`/`float` per slide (a price, a CTA button), never on body text.
6. **Exits are almost never needed** — slide transitions handle leaving.

## Recommended defaults

| Element | Animation | Timing |
| --- | --- | --- |
| Cover title | entrance `slide` up | `on-enter`, 800 ms, delay 150 |
| Cover subtitle | entrance `fade` | `after-previous`, 600 ms |
| Slide heading | entrance `slide` up | `on-enter`, 600 ms |
| Body text | entrance `fade` | `after-previous`, 500 ms |
| Product card / image | entrance `scale` | `after-previous`, 600 ms; siblings `with-previous` + delay 100×i |
| Product grid | entrance `fade` | `after-previous`, 700 ms |
| Price / CTA button | emphasis `pulse` | `after-previous`, 1200 ms (optional) |
| Closing title | entrance `scale` | `on-enter`, 700 ms |

`bounce` uses a spring curve automatically — use it only for playful brands (kids, food, events). `blur` suits luxury/editorial covers. `rotate` is rarely right.

## Transitions

| Moment | Transition |
| --- | --- |
| Default between slides | `fade`, 500–600 ms |
| Entering a new category / chapter | `push` from `left` (or `right` in RTL catalogs), 700 ms |
| Into the closing slide | `zoom` or `fade`, 600 ms |
| Image-led editorial slides | `wipe`, 700 ms |

Keep `flip` for one special moment at most.

### Morph (hero / magic-move)

`morph` moves elements that appear on both slides from their old position, size, rotation, color and font size to the new ones; the rest cross-fades. Use it for "the same scene, rearranged": a product image that grows from a grid into a hero shot, a title that slides aside to make room for details, a price that moves next to a chosen variant.

- Elements match when they share an identity (`morphKey`, set on copies made by duplicating a slide or copy/paste), the same layer `name`, or the same unique content (same text, image asset or product). Give the paired elements the same `name` when you build both slides yourself.
- 800–1200 ms with `ease-in-out` reads best. Keep most elements matched; morph between unrelated slides is just a fade.
- Don't add entrance animations to matched elements: after a morph they are shown at rest anyway. Use `none` for slides meant to read as a continuation (e.g. two pages of the same table).
- Building a morph sequence over MCP (no duplicate-slide tool, `morphKey`, worked recipes): see the `kavero-morph` skill.

## Video and websites

- For MP4 export and autoplaying websites, set `durationMs` per slide: about 4 s for covers and dividers, 6–8 s for product grids, 1 s per 15 words of body text, and always ≥ (last animation end + 1.5 s).
- Viewers with "reduce motion" enabled see the finished slides without animation — never put information only in motion.
- RTL catalogs: mirror directions (`slide` from `right` instead of `left`, `push` from `right`).

## Recipe: animate a whole catalog

1. `catalog_get` → list slides and element ids.
2. For each slide, in reading order: animate the heading (`on-enter`), then 1–3 key elements (`after-previous`, siblings `with-previous` with staggered `delayMs`).
3. Set transitions: `fade` everywhere, `push` into category dividers, `zoom` into the closing slide.
4. If a video is wanted, set `durationMs` on each slide (see above).
5. Tell the user to check it with **Preview** in the editor (or the published link); `catalog_preview` shows the finished state only.

## Don'ts

- Don't animate every element, or every slide the same busy way.
- Don't loop emphasis effects on body text.
- Don't exceed ~1 s for a single entrance in a product catalog.
- Don't use motion to hide layout problems — fix the layout first.
