# Using Kavero

Kavero turns product information into designed, animated catalogs and presentations. One catalog can be exported as PDF, PowerPoint or MP4 video, and published as an animated website.

- [Getting started](#getting-started)
- [Creating a catalog](#creating-a-catalog)
- [The editor](#the-editor)
- [Text, fonts and right-to-left languages](#text-fonts-and-right-to-left-languages)
- [Products](#products)
- [Images and HTML blocks](#images-and-html-blocks)
- [Animations and transitions](#animations-and-transitions)
- [Preview and export](#preview-and-export)
- [Cloud sync, conflicts and workspaces](#cloud-sync-conflicts-and-workspaces)
- [Publishing a website](#publishing-a-website)
- [Settings](#settings)
- [Administering a server](#administering-a-server)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Troubleshooting](#troubleshooting)

For AI agents and the MCP server, see [mcp.md](mcp.md). For hosting your own Kavero, see [deployment.md](deployment.md).

## Getting started

Open Kavero (locally `http://localhost:3001`) and click **Open the editor**. You don't need an account: catalogs are saved in your browser (IndexedDB) as you work.

**Example presentations.** A fresh dashboard comes with four ready-to-use 6-slide decks — **Kavero**, **OpenRive**, **Upstand** and **dgrunner** — built with the editor's own features (theme colors and fonts, a Morph transition from the cover to the overview, staggered animations, a code panel and link buttons). Present them, export them, or duplicate one as the starting point for your own product. They're normal catalogs: edit or delete them freely; a deleted example doesn't come back. To add fresh copies, use **Add example presentations** on an empty dashboard.

Sign in when you want to:

- sync catalogs across devices and keep version history,
- publish websites,
- share catalogs with a team (workspaces),
- use AI with a configured model, connect product sources, or let AI agents work through MCP.

## Creating a catalog

**From the home page**: type what you want in the prompt ("a price list of 12 coffee machines, print-ready A4") or pick a suggestion. Signed in with an AI model connected, it opens a chat: the assistant may ask a question or two, then builds the catalog and shows a preview with **Open in editor** (the catalog is saved in your browser). Otherwise the prompt opens **Generate with AI** on the dashboard with your text filled in.

On the dashboard:

- **New catalog** — choose a title, page size (16:9, 4:3, A4 portrait/landscape, US Letter, square), language, currency and a starting point: blank or one of 12 templates (general, fashion, jewelry, electronics, furniture, cosmetics, food, real estate, industrial, automotive).
- **Generate with AI** — describe the catalog ("autumn lookbook for wholesale buyers"), choose a style or let Kavero pick, and add products by pasting a list or pulling them from a connected MCP source. You see every slide before anything is created. Without an AI model configured, Kavero's built-in planner arranges your products.
- **Import** — open a `.kavero` project file.

Paste products one per line as `name, price, category, image URL`:

```text
Weekender Bag, 640, Bags, https://example.com/bag.jpg
Card Holder, 85, Small leather goods
```

Each catalog card has a menu: rename, duplicate, export a `.kavero` file, save to cloud, delete.

## The editor

| Area | What it does |
| --- | --- |
| Top bar | Title, save status, cloud status, undo/redo, **Chat**, **Export**, **Publish**, **Preview** |
| Tool rail (left edge) | Icon buttons, one under another: heading, text, rectangle, ellipse, line, image, product card, product grid, HTML block, import products, chat. Hover any of them for what it does and its shortcut. At the bottom: keyboard shortcuts and the **Workspace** menu |
| Pages panel | **Slides**: thumbnails; add, duplicate, rename, delete and reorder. **Layers**: every element on the current slide, top layer first. **Products**: the catalog's product library |
| Canvas | Select, drag, resize (corners/edges), rotate (top handle); drag on empty space to select several. Zoom controls sit at the bottom right |
| Properties panel | Everything about the selection, or the slide and theme when nothing is selected |
| Chat panel | Talk to your AI model about this catalog (see [Chat](#chat)) |

**Arrange the workspace your way.** Drag a panel by the grip in its header to the other side of the canvas or to reorder it; drag its inner edge to resize it (or focus the edge and use the arrow keys); the arrow button moves it across and **×** hides it. The **Workspace** menu at the bottom of the rail shows or hides panels and resets the layout. Your layout is remembered in this browser.

- Snapping guides appear when edges or centers line up with the slide or other elements; hold **Alt** to move freely, **Shift** to lock to one axis.
- **Align** buttons (Position section) line one element up with the slide (left, center, right, top, middle, bottom) or several elements with each other; with three or more selected you can also distribute them evenly. Hover a button for its shortcut (**Alt+A/H/D** and **Alt+W/V/S**). Several selected elements can also be grouped; clicking a grouped element selects the whole group.
- Each element can be locked, hidden, reordered (front/back) and given an opacity.
- **Right-click** anything for its menu: elements (cut, copy, paste, duplicate, delete, copy/paste style, order, align, lock, hide, rename, select all of a type), empty canvas (paste here, select all, add slide) and slide thumbnails (duplicate, copy/paste slide, rename, move, delete). Menus work with the arrow keys too.
- Copy and paste work between catalogs and browser tabs. Pasting an image or text copied from another app adds it to the slide.

### Layers

Open the **Layers** tab in the left sidebar to see every element on the slide, top first.

- Click to select; **Ctrl/⌘-click** to add or remove; **Shift-click** to select a range.
- Hover a layer for its **eye** (hide/show), **lock** and **delete** buttons. Hidden and locked layers keep their icons visible.
- **Double-click** a name to rename it. Drag layers to change the stacking order.
- Right-click a layer for the same menu as on the canvas.
- Changes save automatically in your browser. **Undo/redo** covers every change, including AI edits.
- **Theme colors** (shown when nothing is selected) recolor every element that uses them. Prefer theme colors over fixed ones so a catalog can be restyled in one place.

### Chat

Click **Chat** in the top bar (or the chat icon in the rail) to talk to your connected AI model about the open catalog. It sees the whole catalog, the slide you're on and what you've selected, so you can ask questions ("which slides have no prices?") or describe changes ("make this slide more minimal", "add a tagline", "change the theme to dark luxury").

- For a change, the assistant proposes an edit with a before/after preview. Nothing changes until you click **Apply**, and each applied edit is one undo step.
- Each catalog has its own conversation, remembered in this browser, so you can come back later and continue where you left off. If you edit by hand in between, the assistant works from the catalog as it is now. **New chat** starts over.
- Chat needs an account and an AI model: your own key (Settings → AI) or the server's.

## Text, fonts and right-to-left languages

- Double-click text on the slide to edit it; **Esc** or clicking away finishes.
- Properties: font, size, weight, line height, letter spacing, color, alignment, italic, underline.
- **Fonts**: theme heading/body fonts, popular web fonts, or **From this computer…** to use an installed font (Chrome/Edge can list them) or upload `.ttf/.otf/.woff/.woff2` files. Fonts you add are stored inside the catalog so previews and exports look the same on any machine. Only use fonts whose license allows embedding.
- **Right-to-left**: set the catalog language to Persian, Arabic, Hebrew or Urdu and the catalog becomes right-to-left. Alignment uses **start/end**, so "start" means right in an RTL catalog.
- **Direction** (text properties) is **Automatic** by default: each paragraph follows its own first letter, so mixed lines like `شیر توپی (UPVC)` display correctly. Set **Left to right** for a text box that holds a phone number, code or URL inside an RTL slide. Don't paste invisible bidi control characters; they're not needed.

## Products

Products belong to the catalog: define a product once and show it on as many slides as you like. Editing it updates every card.

### The product library

Open the **Products** tab in the left sidebar to see every product in the catalog.

- **New** opens the product form; **Import** brings in many products from a connected MCP source (with images).
- Click a product to edit it. Hover it for **Add to slide**, **Edit**, **Duplicate** and **Delete**.
- Each row shows the price and how many cards use the product. Deleting a product that is on slides first tells you which slides and elements use it; confirming removes its cards and takes it out of grids. **Undo** brings everything back.
- You can also add products by pasting a list in **Generate with AI**.

### Product details

Only the name is required. Fill in what your cards should show:

| Field | Notes |
| --- | --- |
| Name, subtitle | Subtitle is a short tagline under the name |
| Brand, category, SKU | Also used by search in the library and picker |
| Price, compare-at price, currency, unit | A compare-at price higher than the price is shown struck through with the discount (e.g. −25%). Currency defaults to the catalog's. Unit appears after the price, e.g. "per m²" or "/ kg" |
| Badge | A short label over the photo: New, Sale, Bestseller… |
| Availability | In stock, out of stock, pre-order or limited stock |
| Rating | 0–5, shown as stars |
| Images | Upload several or pick images already in the catalog; reorder or remove them and choose the primary one (the first, shown on cards) |
| Product link | Shown as a **View product** link when turned on for a card |
| Description | Longer text, cut off neatly on small cards |
| Specs | Name–value rows (Size, Material…), in the order you set |
| Tags | Search keywords; not shown on cards |

### Adding products to slides

- **Product** (toolbar) opens the picker: search by name, SKU, brand, category or tag and pick one. **Product grid** lets you pick several; the list on the right is the order in the grid.
- **New product** in the picker opens the form and adds the product when you save it. With no products yet, the picker explains how to add or import them.
- A selected **product card** shows its product in the properties with **Change…** (pick another) and **Edit product**.
- A selected **product grid** lists its products: reorder, remove or edit them, set the columns and gap, or use **Add or reorder products…**.

### What a card shows

Under **Card shows** choose: image, name, brand, subtitle, price, compare-at price, badge, availability, rating, SKU, description, specs (with a maximum count) and the **View product** link. Fields a product doesn't have are skipped, so cards don't get empty gaps; long names and descriptions are cut off neatly. Also choose the layout (photo on top or beside the text), photo fit (**Show whole photo** or **Fill and crop**) and corner radius.

Cards look the same in the editor, Preview, published websites, PDF, JPG, video and HTML exports. PowerPoint cards carry the same information as editable text. Prices are formatted for the catalog's language and currency, and cards follow right-to-left catalogs.

## Images and HTML blocks

- **Image**: upload a picture (fill/fit/stretch, rounded corners, grayscale, alt text). Identical files are stored once.
- **HTML block**: write your own HTML and CSS for anything the built-in elements can't do. Theme colors are available as CSS variables (`var(--kv-primary)`, `var(--kv-heading)`). Scripts, forms and embedded frames are removed and the block runs in a sandbox, so it can style but never run code. Images inside must use https or data URLs.

## Animations and transitions

- **Element animations** (properties → Animation): entrance, emphasis or exit with effects fade, slide, scale, bounce, rotate, blur, float, pulse. Choose when it starts — **with the slide**, **after the previous animation**, or **with the previous** — and its duration and delay.
- **Slide transitions** (slide properties): none, fade, morph, slide, push, zoom, wipe, flip, with duration and direction. **Duration** sets how long the slide stays on screen in playback and video.
- Animations play in Preview, on published websites, in HTML exports and in MP4 exports exactly the same way. PDF shows the finished state; PowerPoint export keeps the content but not the motion.

### Morph

Morph works like PowerPoint's Morph or Keynote's Magic Move: elements that are on both slides glide from where they were to where they are now, changing size, rotation, color and font size on the way. Everything else cross-fades.

1. **Duplicate a slide** (Ctrl Shift D, or right-click the thumbnail). The copy gets the Morph transition automatically.
2. On the copy, move, resize, recolor or restyle elements, add new ones or delete some.
3. Preview: the elements animate from the first slide's layout to the second.

Elements are matched when one is a copy of the other (duplicated slides, or copy/paste between slides), when they have the same layer name, or when they show the same thing (same text, image or product) and it appears only once on each slide. The slide properties show how many elements matched. Matched elements don't replay their entrance animations after the morph. Choose another transition to turn it off.
## Preview and export

- **Preview** plays the catalog from the current slide (Space pauses, arrows change slides, Esc closes).
- **Export**:
  - **PDF** (optionally with page numbers) — one page per slide, selectable text.
  - **PowerPoint** — text, shapes and images stay editable; you're told what can't be carried over (transitions, HTML styling, embedded fonts).
  - **Video (MP4)** — 720p to 4K at 24/30/60 fps, rendered frame by frame on the server.
  - **Website (single HTML file)** — one `.html` file with the catalog, its images, fonts and videos built in, plus the player (animations, transitions, Morph, keyboard/touch navigation, full screen, `#3` slide links). Upload it to any web host or your own site, attach it to an email, or open it straight from disk — no Kavero server needed. Google Fonts load from the internet when online; embedded fonts always work.
  - **JPG images (.zip)** — every slide as a JPEG (1920 px wide, or 3840 px for 4K) in one zip, named in slide order (`01-cover.jpg`, `02-…`). Slides show their finished state; good for social posts, marketplaces and email.
  - **Kavero project file** — the whole catalog with its images and fonts, for backup or moving between browsers.
- PDF, JPG and video need Chrome (or Chromium) on the machine running the Kavero server. PowerPoint and the HTML file are built in your browser and work offline.

## Cloud sync, conflicts and workspaces

- Signed in, a catalog's menu offers **Save to my cloud** or **Save to *workspace***. After that it syncs automatically a few seconds after you stop editing. Badges: **Local**, **Synced**, **Changed** (edits not uploaded yet), **Conflict**, **Sign in to sync**.
- Opening the dashboard or a catalog pulls a newer cloud version (from another device, or from an AI agent) when you have no unsynced edits.
- **Conflicts** (changed in two places): choose **Keep both** (your version becomes a separate catalog), **Keep this browser's version** or **Use the cloud version**. Nothing is overwritten without your choice.
- Catalogs only in your cloud appear under **In your cloud, not in this browser**; **Open** downloads and opens them.
- **Workspaces** (Settings → Workspaces) share catalogs with a team:

| Role | Can |
| --- | --- |
| Owner | Everything, including deleting the workspace |
| Admin | Manage members, publish and delete catalogs |
| Editor | Create and edit catalogs |
| Viewer | View and preview catalogs |

Invite by email: Kavero creates a link you send yourself; only that email address can accept it within 7 days.

## Publishing a website

**Publish** (top bar) saves the latest version to the cloud, then lets you choose:

- the address (`/c/your-name`),
- who can see it: **Public** (indexed by search engines), **Unlisted** (anyone with the link), **Password**, or **Private** (you and workspace members),
- a search title and description; the first slide becomes the link preview image.

The website shows the version you published. Later edits stay private until you click **Update**. The dialog shows views for the last 30 days. Visitors can use arrow keys, click/tap either side, swipe, press F for full screen, or link to a slide with `#3`.

## Settings

- **Workspaces** — create, invite, change roles, leave or delete.
- **API keys** — keys for MCP clients, with separate permissions and expiry; shown once. Includes a ready-to-paste MCP client config.
- **MCP connections** — product sources (Streamable HTTP or SSE, with bearer or header auth). Credentials are encrypted.
- **AI** — connect multiple providers: **Claude** (Anthropic), **OpenRouter**, **OpenAI**, or an **OpenAI-compatible server** such as Ollama or LM Studio. Load the provider's model list, search and select a model, review its known input and output capabilities, then test and save it. The key is encrypted on the server and never shown again (only its last 4 characters). Choose a default provider for generation, AI edits and the MCP `catalog_generate` tool. Also shows your generation history.
- **Activity** — categorized audit log of catalog, asset, export, publishing, workspace, AI, API key, integration and sign-in actions, with outcome filters and pagination.

## Administering a server

The **first account created on a new Kavero server is its admin**. Admins see **Admin** in the header and account menu.

- **Overview** — accounts, admins, cloud catalogs, published sites and views, stored files, AI requests in the last 30 days.
- **Users** — search accounts and, from each row's menu:
  - **Make admin / Remove admin**. You can't remove your own admin role, and the last admin can't be removed.
  - **Suspend** (until lifted, or for 1, 7 or 30 days, with a reason). A suspended account is signed out, can't sign in, its API keys stop working and its published sites go offline. **Lift suspension** restores everything.
  - **Sign out everywhere** — ends all sessions and revokes the account's API keys.
  - **Delete account** — removes the account with its cloud catalogs, published sites and API keys (type the email to confirm). Workspaces it created stay with their other members.
- **Published sites** — every site on the server with its owner and views; **Unpublish** takes one offline (the owner keeps the catalog).
- **Activity** — the server-wide audit log; filter to admin actions or MCP/agent actions.
- **Sign-ups** — **Open** (anyone), **Invite-only** (only email addresses with a pending workspace invitation) or **Closed**. Existing accounts are never affected.

Every admin action is recorded in the activity log. Lost admin access? See [Deployment → Admin accounts](deployment.md#admin-accounts).

## Keyboard shortcuts

Press **?** in the editor (or the keyboard button in the toolbar) for the full list. Ctrl on Windows/Linux is ⌘ on macOS.

| Keys | Action |
| --- | --- |
| Ctrl Z, Ctrl Shift Z (or Ctrl Y) | Undo, redo |
| Ctrl C, X, V | Copy, cut, paste (also images and text from other apps) |
| Ctrl D | Duplicate selection |
| Ctrl Alt C, Ctrl Alt V | Copy style, paste style |
| Delete / Backspace | Delete selection |
| Ctrl A | Select all on the slide |
| Tab, Shift Tab | Select next / previous element |
| Esc | Deselect; close menus and dialogs |
| Ctrl G, Ctrl Shift G | Group, ungroup |
| Ctrl ], Ctrl [ | Bring forward, send backward |
| Ctrl Shift ], Ctrl Shift [ | Bring to front, send to back |
| Ctrl Shift L, Ctrl Shift H | Lock / unlock, hide / show |
| Alt A / H / D | Align left / center / right |
| Alt W / V / S | Align top / middle / bottom |
| Arrow keys (Shift = 10 px) | Nudge selection; with nothing selected, previous/next slide |
| Page Up / Page Down | Previous / next slide |
| Ctrl M, Ctrl Shift D | New slide, duplicate slide |
| Ctrl + / Ctrl − / Ctrl 0 | Zoom in, out, fit |
| Double-click text | Edit text |

## Troubleshooting

- **Signed out unexpectedly** — sessions survive server restarts, but cookies belong to one host: `localhost:3001` and `127.0.0.1:3001` are different sites to the browser. Always use the address in `BETTER_AUTH_URL`.
- **"Sign in to sync" badge** — the catalog is linked to a cloud copy but you're signed out, so Kavero can't check for newer versions.
- **Fonts look different in an export** — use theme fonts, web fonts or fonts added to the catalog; system fonts on your computer may not exist on the server.
- **PDF or video export fails** — Chrome or Chromium must be installed on the server (set `KAVERO_CHROME_PATH` if it's in an unusual place).
- **Mixed Persian/English text in the wrong order** — leave Direction on Automatic; use Left to right only for phone numbers and codes.
