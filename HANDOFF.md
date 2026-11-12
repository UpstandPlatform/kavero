# Handoff

Last updated: 2026-11-12. Base: `master` at `202d871` (v0.11.0). **Everything below is uncommitted in the working tree.**

## State

- `bun run check-types`: 17/17 pass. `bun run test`: 181 pass, 0 fail.
- Dev DB (Postgres on port 5436) has the new chat migration applied (`20261112120000_chat_conversation_summary`).
- Safety snapshot of the working tree before the pen-tool merge: `git show refs/backup/wip-before-pen-merge` (a stash-style commit). Delete it once this work is committed: `git update-ref -d refs/backup/wip-before-pen-merge`.
- The pen tool was built on branch `worktree-agent-a3274d8c25efaf2cc` (commit `0a27dff`) and merged here as uncommitted changes. That branch and its worktree (`.claude/worktrees/agent-a3274d8c25efaf2cc`) can be removed after committing.

## Done in this session

1. **Chat system audit fixes** (`apps/web/src/app/api/chat/route.ts`, `apps/web/src/modules/chat/*`, `packages/api/src/services/chat-*`): body size cap, the client sends only the new message, server-side abort, per-slide proposal staleness, 404 for foreign chat ids, history list without loading transcripts (new `title`/`message_count` columns), no silent fallback from a broken personal key, a tool time budget, prompt caching, injection-safe context blocks, safe error messages, and no localStorage transcripts.
2. **Extension system fixes** (`packages/extensions`, `apps/web/src/modules/editor/extensions/*`):
   - per-user consent (`effectiveGrants`) and host-enforced confirmation for tool calls;
   - MCP response and tool-list caps, and rate limits;
   - semver-compatible versions, isolated hooks, memoized contributions, and an ownership check on commands;
   - also **Lucide icons**, a default extension (Icons sidebar tab).
3. **Runtime config + editions** (`packages/api/src/platform/*`, `apps/web/src/platform.ts`, Admin → System tab):
   - Settings are stored encrypted in `app_setting` (`config:<section>`). Env vars override them and lock the field.
   - Optional `KAVERO_ENCRYPTION_KEY` (v2 SecretBox values).
   - Editions: desktop, self-hosted and cloud. Cloud adds plan limits enforced by `QuotaService`.
   - `/api/public-config` serves the media keys.
   - Docs: deployment, architecture, user guide.
4. **Pen tool + path element + Draw/Erase/Trace + keyframes** (merged from the pen branch).
5. **Markdown element** (editor + MCP `slide_add_markdown`/`markdown_update`) and **Table element** (CSV/TSV/xlsx/ods upload, paste, manual; MCP `slide_add_table`/`table_update`; native PPTX tables). `xlsx` comes from the SheetJS CDN tarball, so installs need to reach cdn.sheetjs.com.

### Verified in the browser
- Lucide icons insert (after fixing a capability-getter crash).
- Pen drawing.
- Adding the Draw animation.
- Preview playback.
- Markdown insert.
- Table paste dialog: CSV with a quoted comma parsed correctly, and the table inserted.
- Runtime config read/write against the real DB.

### Not verified in the browser
- The Admin → System screen (the browser wasn't signed in as admin).
- Chat stop/abort/409 flows.
- Keyframe editor UI.
- Excel upload.
- Exports of the new elements.

### Known gaps
- Pen:
  - SVG with several subpaths keeps only the first.
  - You can't click a segment to insert a point.
  - No canvas scrubbing for keyframes.
  - PPTX has no animations.
- Tables:
  - Cells are edited in a dialog, not inline.
  - The fade on long tables uses an estimated row height.
- Extension hooks and `pptxRenderers` run only for editor-side exports.

## Next task (not started): AI background removal, masks, per-corner radius

The user asked for these three, in their words:
- "add annotated images to remove background using the connected AI models from the image select object options to editor mask options to layers"
- "add radius options for the shapes that user add that be able to curve one edge or all like adobe illustrator"

Planned scope (confirm the reading with the user if unsure):

1. **Remove background** (image element options):
   - Select an image, then click **Remove background**. Optionally the user first marks the object to keep: click points or a brush stroke (the "annotation").
   - Use the user's connected model. `AiCredentialService` already tracks `ModelCapabilities` (input/output modalities).
     - **Image-output models** (some OpenAI / OpenRouter models): send the image + annotation and get back a transparent PNG cut-out. Store it as a new asset.
     - **Vision-only models** (e.g. Claude): ask for the object's outline as a polygon (normalized coordinates), guided by the annotation. Store it as an editable vector mask on the element.
   - Always keep the original image, so the user can undo or edit the mask.
   - Go through the server (a tRPC or route handler using the per-user provider plus `QuotaService.consumeAiRequest` when it's the server model). Validate size limits.
2. **Masks**:
   - Image mask presets: circle, rounded rect, star, polygon, and any pen `path` element (clip-path in the renderer).
   - Layers panel: "Use as mask" clips the layer(s) below to this shape/path, like Figma/Illustrator clipping masks.
   - Masks must render in the editor, present mode, published sites, Chromium exports and PPTX (PPTX: custom geometry fill or a rasterized fallback, with a warning).
3. **Per-corner radius (Illustrator-style live corners)**:
   - Today shapes and images have a single `style.borderRadius`.
   - Add per-corner radii (TL/TR/BR/BL) with a link toggle, and corner styles: round, inverted round, chamfer.
   - Add on-canvas corner widgets: drag inward to round; Alt to edit one corner.
   - Keep `borderRadius` backward compatible.
   - Apply to rect shapes, images and the rounded-rect mask.
   - PPTX: native `roundRect` when all corners are equal, otherwise custom geometry.

Touches: `packages/catalog-engine/src/schema.ts`, `packages/renderer/src/slide-view.tsx`, `packages/export-pptx/src/index.ts`, `apps/web/src/modules/editor/{canvas,properties-panel,layers-panel}.tsx`, `packages/editor-core/src/commands.ts`, `packages/api` (the AI route), and `packages/mcp-server` (expose masks/radius to agents). Add tests in the same style as the existing ones (schema, commands with undo, renderer output, PPTX XML).

## Before committing
- Review the diff (about 75+ files).
- Decide whether to commit as one change or split it (chat / extensions / platform / pen / markdown+table).
- Commit on a branch, since master auto-releases.
