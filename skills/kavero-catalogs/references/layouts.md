# Ready layouts (coordinates)

All values are document pixels: `{x, y, width, height}`. `M` = margin.

## 16:9 — 1920 × 1080, M = 76

**Cover, split**
- Accent block: `{0, 0, 760, 1080}` (shape, `token:accent`) — or a full-bleed image `{0, 0, 1920, 1080}` with a dark overlay shape `{0, 0, 1920, 1080}`, opacity 0.45
- Title: `{836, 380, 1008, 260}` size 104, weight 800
- Subtitle: `{836, 660, 1008, 80}` size 32, `token:muted`
- Logo: `{836, 120, 240, 80}`

**Category divider**
- Color block: `{0, 0, 768, 1080}`
- Kicker ("01"): `{844, 360, 400, 60}` size 28, `token:primary`
- Title: `{844, 430, 1000, 180}` size 88, weight 700
- Line: `{844, 640, 120, 4}` (rect, `token:primary`)

**Product grid (3 × 2)**
- Heading: `{76, 76, 1768, 90}` size 56
- Grid: `{76, 200, 1768, 804}`, `columns: 3`, gap 32

**Featured product**
- Product card (photo only, `showDescription: false`, `showPrice: false`): `{76, 76, 860, 928}`
- Name: `{1012, 260, 832, 160}` size 64
- Description: `{1012, 440, 832, 260}` size 26, line height 1.45
- Specs: product card with `showAttributes: true`, or text `{1012, 720, 832, 180}`
- Price: `{1012, 920, 832, 80}` size 44, weight 700, `token:primary`

**Comparison (3 columns)**
- Heading: `{76, 76, 1768, 90}`
- Columns (width 568, gap 32): x = 76, 676, 1276; y 200; height 804
- Highlight the middle column: background shape `token:primary`, its text `token:on-primary`

**Closing**
- Background: slide color `token:primary`
- Title: `{76, 400, 1768, 140}` size 88, `align: center`, `token:on-primary`
- Contact: `{76, 580, 1768, 120}` size 28, `align: center`
- Button: `{760, 760, 400, 88}`

## A4 portrait — 794 × 1123, M = 56

**Cover**
- Image: `{0, 0, 794, 640}` (`fit: cover`)
- Title: `{56, 680, 682, 140}` size 48, weight 800
- Subtitle: `{56, 830, 682, 60}` size 16, `token:muted`
- Footer rule: `{56, 1040, 682, 2}`

**Category divider**
- Color block: `{0, 0, 794, 480}`
- Title: `{56, 560, 682, 120}` size 40

**Product grid (2 × 3)**
- Heading: `{56, 56, 682, 60}` size 30
- Grid: `{56, 140, 682, 927}`, `columns: 2`, gap 20

**Two products per page** (spec sheets)
- Product A card: `{56, 56, 682, 480}` with `layout: "horizontal"`, `showAttributes: true`
- Divider: `{56, 556, 682, 1}`
- Product B card: `{56, 577, 682, 480}`

**Contact page**
- Heading: `{56, 120, 682, 60}` size 32
- Details (one text element per line; phone/email with `direction: "ltr"`): start at y 220, height 40 each, gap 12

RTL catalogs: mirror horizontally — `x' = pageWidth − x − width`.
