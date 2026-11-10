# Morph recipes (tool-call sequences)

Coordinates are for **16:9, 1920 × 1080**, margin 76 (see `kavero-catalogs/references/layouts.md`). Replace `<catalogId>`, slide ids and product/asset ids with real ones from `catalog_get` / tool results. `slide_create` and `slide_add_element` return `createdIds` — the new slide id, or the new element ids in the order you sent them.

Every recipe follows the same shape: build slide A → preview → build slide B with the same `morphKey`s → set `morph` on slide B → delay newcomers' entrances → preview both.

---

## 1. Grid → product detail zoom

Three product cards in a row; the chosen one grows into the left half, the other two slide off to the right, and name, description and price appear beside it. Uses individual `product` cards because a `product-grid` morphs as one block.

**Slide A — line-up**

```json
// slide_create
{"catalogId":"<catalogId>","name":"Line-up"}
// slide_add_element  (slideId = createdIds[0] from slide_create)
{"catalogId":"<catalogId>","slideId":"<slideA>","elements":[
  {"type":"text","name":"Heading","morphKey":"heading",
   "position":{"x":76,"y":76,"width":1768,"height":90},
   "content":{"paragraphs":[[{"text":"The trail collection"}]]},
   "style":{"fontFamily":"token:heading","fontSize":56,"fontWeight":700,"color":"token:text"}},
  {"type":"product","name":"Card Trail","morphKey":"card-prd_trail",
   "position":{"x":76,"y":200,"width":568,"height":804},
   "content":{"productId":"prd_trail"},"style":{"imageFit":"contain","showDescription":false}},
  {"type":"product","name":"Card Summit","morphKey":"card-prd_summit",
   "position":{"x":676,"y":200,"width":568,"height":804},
   "content":{"productId":"prd_summit"},"style":{"imageFit":"contain","showDescription":false}},
  {"type":"product","name":"Card Ridge","morphKey":"card-prd_ridge",
   "position":{"x":1276,"y":200,"width":568,"height":804},
   "content":{"productId":"prd_ridge"},"style":{"imageFit":"contain","showDescription":false}}
]}
// catalog_preview  {"catalogId":"<catalogId>","slideIndex":<index of slide A>}
```

**Slide B — detail of the first product** (inserted right after A)

```json
// slide_create
{"catalogId":"<catalogId>","name":"Trail Runner","index":<index of slide A + 1>}
// slide_add_element
{"catalogId":"<catalogId>","slideId":"<slideB>","elements":[
  {"type":"text","name":"Heading","morphKey":"heading",
   "position":{"x":1012,"y":140,"width":832,"height":50},
   "content":{"paragraphs":[[{"text":"The trail collection"}]]},
   "style":{"fontFamily":"token:heading","fontSize":26,"fontWeight":600,"color":"token:muted"}},
  {"type":"product","name":"Card Trail","morphKey":"card-prd_trail",
   "position":{"x":76,"y":76,"width":860,"height":928},
   "content":{"productId":"prd_trail"},"style":{"imageFit":"contain","showDescription":false,"showPrice":false}},
  {"type":"product","name":"Card Summit","morphKey":"card-prd_summit",
   "position":{"x":1960,"y":200,"width":568,"height":804},
   "content":{"productId":"prd_summit"},"style":{"imageFit":"contain","showDescription":false}},
  {"type":"product","name":"Card Ridge","morphKey":"card-prd_ridge",
   "position":{"x":2560,"y":200,"width":568,"height":804},
   "content":{"productId":"prd_ridge"},"style":{"imageFit":"contain","showDescription":false}},
  {"type":"text","name":"Name",
   "position":{"x":1012,"y":220,"width":832,"height":160},
   "content":{"paragraphs":[[{"text":"Trail Runner 2"}]]},
   "style":{"fontFamily":"token:heading","fontSize":64,"fontWeight":700,"lineHeight":1.1}},
  {"type":"text","name":"Description",
   "position":{"x":1012,"y":420,"width":832,"height":300},
   "content":{"paragraphs":[[{"text":"Grippy, light and waterproof. Built for wet rock and long days."}]]},
   "style":{"fontSize":26,"lineHeight":1.45,"color":"token:muted"}},
  {"type":"text","name":"Price",
   "position":{"x":1012,"y":900,"width":832,"height":80},
   "content":{"paragraphs":[[{"text":"€149"}]]},
   "style":{"fontSize":44,"fontWeight":700,"color":"token:primary"}}
]}
// catalog_set_transition
{"catalogId":"<catalogId>","slideId":"<slideB>","type":"morph","durationMs":1100}
// newcomers arrive after the move (ids = createdIds[4..6] of the call above)
// catalog_animate_element
{"catalogId":"<catalogId>","elementId":"<nameId>","category":"entrance","preset":"slide","direction":"up","trigger":"on-enter","delayMs":900,"durationMs":500}
{"catalogId":"<catalogId>","elementId":"<descriptionId>","category":"entrance","preset":"fade","trigger":"after-previous","durationMs":400}
{"catalogId":"<catalogId>","elementId":"<priceId>","category":"entrance","preset":"fade","trigger":"with-previous","delayMs":120,"durationMs":400}
// catalog_preview slide A and slide B
```

The cards placed at `x: 1960` / `2560` are off-page: they travel out to the right instead of fading. In RTL catalogs mirror everything (`x' = 1920 − x − width`) and send the others off to the left (`x: -640`, `-1240`).

**Extending the chain:** add slide C for `prd_summit` (Summit card at the detail box, Trail card off-page left at `x: -940`) and set `morph` on C as well; finish with a copy of slide A (same keys, original positions) to zoom back out.

**A4 portrait (794 × 1123, M 56):** line-up as 2 + 1 or a single row of 3 cards `{56|287|518, 200, 220, 360}`; detail card `{56, 56, 682, 560}`, name `{56, 650, 682, 70}` size 32, description `{56, 730, 682, 220}` size 14, price `{56, 980, 682, 60}` size 26. Off-page: `y: 1200`.

---

## 2. Title moves aside to reveal specs

A full-bleed cover photo with a big title; on the next slide the photo docks into the left half with rounded corners, the dark overlay fades out, the title shrinks into a heading on the right, and the specs appear.

Import the photo first: `asset_import {"catalogId":"<catalogId>","url":"https://…/aero-x1.jpg","name":"Aero X1 hero"}` → `assetId`.

**Slide A — cover**

```json
// slide_add_element (on the cover slide, or a new slide)
{"catalogId":"<catalogId>","slideId":"<slideA>","elements":[
  {"type":"image","name":"Hero photo","morphKey":"hero-photo",
   "position":{"x":0,"y":0,"width":1920,"height":1080},
   "content":{"assetId":"<assetId>","alt":"Aero X1 headphones on a desk"},
   "style":{"fit":"cover","borderRadius":0}},
  {"type":"shape","name":"Overlay","morphKey":"overlay",
   "position":{"x":0,"y":0,"width":1920,"height":1080},"opacity":0.45,
   "content":{"shape":"rect"},"style":{"fill":"#000000","borderRadius":0}},
  {"type":"text","name":"Title","morphKey":"title",
   "position":{"x":160,"y":380,"width":1600,"height":200},
   "content":{"paragraphs":[[{"text":"Aero X1"}]]},
   "style":{"fontFamily":"token:heading","fontSize":140,"fontWeight":800,"lineHeight":1.05,"color":"#ffffff","align":"start"}},
  {"type":"text","name":"Subtitle","morphKey":"subtitle",
   "position":{"x":160,"y":600,"width":1600,"height":60},
   "content":{"paragraphs":[[{"text":"Wireless, silent, all-day."}]]},
   "style":{"fontSize":34,"color":"#ffffff","align":"start"}}
]}
```

**Slide B — specs**

```json
// slide_create {"catalogId":"<catalogId>","name":"Aero X1 specs","index":<index of A + 1>}
// slide_add_element
{"catalogId":"<catalogId>","slideId":"<slideB>","elements":[
  {"type":"image","name":"Hero photo","morphKey":"hero-photo",
   "position":{"x":76,"y":76,"width":860,"height":928},
   "content":{"assetId":"<assetId>","alt":"Aero X1 headphones on a desk"},
   "style":{"fit":"cover","borderRadius":24}},
  {"type":"shape","name":"Overlay","morphKey":"overlay",
   "position":{"x":76,"y":76,"width":860,"height":928},"opacity":0,
   "content":{"shape":"rect"},"style":{"fill":"#000000","borderRadius":24}},
  {"type":"text","name":"Title","morphKey":"title",
   "position":{"x":1012,"y":120,"width":832,"height":110},
   "content":{"paragraphs":[[{"text":"Aero X1"}]]},
   "style":{"fontFamily":"token:heading","fontSize":72,"fontWeight":800,"lineHeight":1.05,"color":"token:text","align":"start"}},
  {"type":"text","name":"Subtitle","morphKey":"subtitle",
   "position":{"x":1012,"y":240,"width":832,"height":50},
   "content":{"paragraphs":[[{"text":"Wireless, silent, all-day."}]]},
   "style":{"fontSize":26,"color":"token:muted","align":"start"}},
  {"type":"shape","name":"Rule",
   "position":{"x":1012,"y":330,"width":120,"height":4},
   "content":{"shape":"rect"},"style":{"fill":"token:primary"}},
  {"type":"text","name":"Specs",
   "position":{"x":1012,"y":380,"width":832,"height":440},
   "content":{"paragraphs":[
     [{"text":"Battery  ","bold":true},{"text":"40 h, 10 min = 5 h"}],
     [{"text":"Noise cancelling  ","bold":true},{"text":"Adaptive, 3 modes"}],
     [{"text":"Weight  ","bold":true},{"text":"248 g"}],
     [{"text":"Connection  ","bold":true},{"text":"Bluetooth 5.4, USB-C audio"}]]},
   "style":{"fontSize":28,"lineHeight":1.6}},
  {"type":"text","name":"Price",
   "position":{"x":1012,"y":880,"width":832,"height":90},
   "content":{"paragraphs":[[{"text":"€329"}]]},
   "style":{"fontSize":48,"fontWeight":700,"color":"token:primary"}}
]}
// catalog_set_transition
{"catalogId":"<catalogId>","slideId":"<slideB>","type":"morph","durationMs":1200}
// catalog_animate_element — Rule, then Specs, then Price
{"catalogId":"<catalogId>","elementId":"<ruleId>","category":"entrance","preset":"slide","direction":"left","trigger":"on-enter","delayMs":1000,"durationMs":400}
{"catalogId":"<catalogId>","elementId":"<specsId>","category":"entrance","preset":"fade","trigger":"after-previous","durationMs":500}
{"catalogId":"<catalogId>","elementId":"<priceId>","category":"entrance","preset":"slide","direction":"up","trigger":"after-previous","durationMs":400}
```

Notes: the title's color animates from white to `token:text` and its size from 140 to 72; keep `align` identical on both slides (enums switch halfway and would jump). If the product is a Kavero product, swap the Specs text for a `product` card with `showAttributes: true`.

---

## 3. Variant & price highlight

A selector ring moves between color swatches; the product photo cross-fades to the chosen color, the variant label and price change, and the price turns accent-colored on the premium variant. Import one photo per variant with `asset_import` (`<ast_navy>`, `<ast_sand>`, `<ast_olive>`).

Swatch fills are the real product colors (hex is right here — they describe the product, not the theme).

**Slide A — Navy**

```json
{"catalogId":"<catalogId>","slideId":"<slideA>","elements":[
  {"type":"image","name":"Variant photo","morphKey":"variant-photo",
   "position":{"x":76,"y":76,"width":1000,"height":928},
   "content":{"assetId":"<ast_navy>","alt":"Weekender bag in navy"},"style":{"fit":"contain"}},
  {"type":"text","name":"Name","morphKey":"name",
   "position":{"x":1160,"y":160,"width":684,"height":150},
   "content":{"paragraphs":[[{"text":"Weekender Bag"}]]},
   "style":{"fontFamily":"token:heading","fontSize":64,"fontWeight":700,"lineHeight":1.1}},
  {"type":"shape","name":"Swatch navy","morphKey":"swatch-navy",
   "position":{"x":1160,"y":520,"width":96,"height":96},"content":{"shape":"ellipse"},"style":{"fill":"#1f2a44"}},
  {"type":"shape","name":"Swatch sand","morphKey":"swatch-sand",
   "position":{"x":1296,"y":520,"width":96,"height":96},"content":{"shape":"ellipse"},"style":{"fill":"#d8c3a5"}},
  {"type":"shape","name":"Swatch olive","morphKey":"swatch-olive",
   "position":{"x":1432,"y":520,"width":96,"height":96},"content":{"shape":"ellipse"},"style":{"fill":"#6b7041"}},
  {"type":"shape","name":"Selector","morphKey":"selector",
   "position":{"x":1148,"y":508,"width":120,"height":120},"content":{"shape":"ellipse"},
   "style":{"fill":"transparent","stroke":"token:primary","strokeWidth":6}},
  {"type":"text","name":"Variant","morphKey":"variant-label",
   "position":{"x":1160,"y":660,"width":684,"height":50},
   "content":{"paragraphs":[[{"text":"Navy"}]]},"style":{"fontSize":28,"color":"token:muted"}},
  {"type":"text","name":"Price","morphKey":"price",
   "position":{"x":1160,"y":780,"width":684,"height":100},
   "content":{"paragraphs":[[{"text":"€129"}]]},
   "style":{"fontSize":72,"fontWeight":700,"color":"token:text"}}
]}
```

**Slide B — Sand** (same elements; only these change)

| Key | Change on slide B |
| --- | --- |
| `variant-photo` | `"content":{"assetId":"<ast_sand>","alt":"Weekender bag in sand"}` → cross-fades in place |
| `selector` | `"position":{"x":1284,"y":508,"width":120,"height":120}` → ring slides to the 2nd swatch |
| `variant-label` | text `Sand` |
| `price` | text `€149`, `"fontSize":84`, `"color":"token:primary"` → grows and turns accent |

Send the full element list again with those edits (same `morphKey`s, no `id`s), then:

```json
// catalog_set_transition
{"catalogId":"<catalogId>","slideId":"<slideB>","type":"morph","durationMs":800}
// optional: one emphasis on the price after the move
{"catalogId":"<catalogId>","elementId":"<priceIdOnB>","category":"emphasis","preset":"pulse","trigger":"on-enter","delayMs":850,"durationMs":900}
```

Slide C (Olive) repeats the pattern with the selector at `x: 1420`. Short durations (700–900 ms) suit this small move. In RTL catalogs put the photo on the right (`x: 844`) and the swatches/text on the left, and order the swatches right-to-left.

**A4 portrait:** photo `{56, 56, 682, 600}`; name `{56, 690, 682, 60}` size 32; swatches 56 px at y 780, x 56 / 132 / 208, selector 72 px at `x − 8, y 772`; variant `{56, 860, 682, 30}` size 16; price `{56, 920, 682, 70}` size 40.
