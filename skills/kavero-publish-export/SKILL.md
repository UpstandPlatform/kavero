---
name: kavero-publish-export
description: Deliver Kavero catalogs over MCP — slide preview PNGs (catalog_preview), PDF (catalog_export_pdf) and editable PowerPoint (catalog_export_pptx) with their limits and compatibility warnings, and websites via catalog_publish / catalog_unpublish (visibility public/unlisted/private, slugs, republishing after edits). Also says which deliverables exist only in the Kavero editor (MP4 video, single-file HTML website, JPG images zip, password-protected sites, PDF page numbers, .kavero file) so the agent points the user there instead of inventing tools. Use when the user asks to export, download, print, share, publish, put online, update the website, get a link, make a PDF/PPTX/video/images, or take a catalog offline.
---

# Exporting and publishing Kavero catalogs

Deliver only what the user asked for. Before any export or publish, `catalog_preview` the slides you changed and fix problems — every format starts from the same slides.

## What MCP can do

| Deliverable | Tool | Scope | Notes |
| --- | --- | --- | --- |
| Slide image (check layout) | `catalog_preview` `{catalogId, slideIndex?}` | `catalogs:read` | PNG, 1280 px wide, finished state (all animations done, no transition). `slideIndex` 0-based, default 0 |
| PDF | `catalog_export_pdf` `{catalogId}` | `catalogs:read` | One page per slide at the catalog's page size, selectable text, finished state |
| PowerPoint | `catalog_export_pptx` `{catalogId}` | `catalogs:read` | Text, shapes, images editable; returns compatibility notes |
| Website | `catalog_publish` `{catalogId, visibility?, slug?}` | `publish` | Returns `url`, `slug`, `version`, `missingFiles` |
| Take website offline | `catalog_unpublish` `{catalogId}` | `publish` | Deletes the publication; the catalog stays |

Preview and PDF need Chrome/Chromium on the Kavero server; if missing, the tools say "isn't available on this server (no Chrome)" — tell the user to export from the editor or ask their admin. Exports come back as an embedded file resource (base64) of at most **25 MB**; larger files fail with "export it from the Kavero app instead". Save the file where the user wants it, or tell them how your client exposes it.

## PDF

- Use for print and email. Pick `a4-portrait`/`letter-portrait` at creation time for print; PDF uses the catalog's page size.
- Static: transitions and animations aren't exported (slides show their end state); videos show their poster image. Make sure no slide depends on motion to be understood — e.g. in a Morph chain, every slide must read on its own.
- Large photo-heavy catalogs can exceed 25 MB → suggest the editor's **Export → PDF** (also offers page numbers, which MCP can't add).

## PowerPoint (PPTX)

Read the returned notes and pass the relevant ones to the user. Current exporter behavior:

- Slide transitions (including `morph`) and element animations are **not** exported.
- Gradient backgrounds use their first color; HTML blocks become plain editable text (CSS is lost); videos become their poster image.
- Rounded image corners become square (fully round images are kept); rotated product grids are unrotated; fonts stored in the catalog can't be embedded — install them on the presenting computer.
- Product cards without a product are left out.

If the user wants Morph in PowerPoint, they must re-apply PowerPoint's own Morph transition there.

## Websites

`catalog_publish` snapshots the **current** cloud catalog. Later edits are **not** live until you call `catalog_publish` again (each call bumps `version`). Always give the user the returned `url`.

**Visibility** (`visibility`):

| Value | Who can see it |
| --- | --- |
| `unlisted` (default for a first publish) | Anyone with the link; not indexed |
| `public` | Anyone; indexed by search engines and listed in the sitemap |
| `private` | Not public — only signed-in people with access to the catalog |
| password | **Editor only**: Publish dialog → Password (min. 8 characters). Not settable over MCP |

Republishing **without** `visibility` keeps the current setting — including a password-protected site. Passing `visibility` replaces it (passing one on a password site removes the password). So when updating an existing site, omit `visibility` unless the user asked to change it. Choose `public` only when the user wants search engines to find it.

**Slug** (`slug`, the address `/c/<slug>`):

- Omit it to keep the current address, or on first publish to get one from the title (a short suffix is added if taken).
- Custom slugs: 3–60 characters, lowercase `a–z`, `0–9` and single dashes, starting and ending with a letter or digit. Reserved: `admin`, `api`, `app`, `assets`, `auth`, `c`, `dashboard`, `editor`, `help`, `kavero`, `login`, `new`, `render`, `settings`, `static`, `www`. MCP does not slugify for you — pass `"spring-lookbook-2027"`, not `"Spring Lookbook 2027"`.
- Errors: "That address is taken." → propose another; "That address was just taken…" → retry once.
- Changing the slug moves the site; the old link stops working. Confirm with the user first.

**`missingFiles`** lists assets whose files aren't stored with the cloud catalog (e.g. images added in a browser that never synced, or catalogs made with `catalog_duplicate`). They show as missing on the site: re-add them with `asset_import` and update the elements, or ask the user to open the catalog in the editor so it syncs, then publish again.

Workspace catalogs: publishing needs a role allowed to publish (owner/admin); a token acts with its owner's role.

**Unpublish** only when asked (it's destructive for anyone holding the link). Deleting a catalog (`catalog_delete`) also removes its website.

## Editor-only deliverables — point the user there

No MCP tool exists for these. Say exactly where to click and give the `editorUrl` (from `catalog_get`):

| Deliverable | Where |
| --- | --- |
| **MP4 video** (720p–4K, 24/30/60 fps, plays animations, transitions and Morph) | Editor → **Export → Video (MP4)** — set slide durations first (`slide_update` `durationMs`, see `kavero-animations`) |
| **Website as a single HTML file** (self-contained, works offline, includes Morph and animations) | Editor → **Export → Website (single HTML file)** |
| **JPG images (.zip)** — every slide 1920 px wide (or 3840 px), finished state, named `01-cover.jpg`… | Editor → **Export → JPG images** |
| PDF with page numbers | Editor → **Export → PDF** |
| Kavero project file (backup/move) | Editor → **Export → Kavero project file** |
| Password-protected website, SEO title/description, 30-day view stats | Editor → **Publish** dialog |

For a single slide image, `catalog_preview` returns a 1280-px PNG you can hand over directly.

## Recipes

**"Send me a PDF"** → preview changed slides → `catalog_export_pdf` → hand over the file; mention that animations show in their finished state.

**"Put it online"** → `catalog_publish {"catalogId":"…"}` (unlisted) → share `url`. "Make it public / searchable" → `catalog_publish {"catalogId":"…","visibility":"public"}`.

**"Update the website"** after edits → `catalog_publish {"catalogId":"…"}` with no `visibility`/`slug` → report the new `version`.

**"I need it for PowerPoint"** → `catalog_export_pptx` → relay the compatibility notes; offer to simplify affected slides (e.g. replace a gradient with a solid `token:` color, HTML blocks with text elements) and export again.

**"Make a video / Instagram images"** → set slide durations (video) → give the `editorUrl` and the menu path from the table above.
