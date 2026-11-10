# Kavero agent skills

Skills teach an AI agent (Claude Code, Claude Desktop, claude.ai, or any MCP client) how to build good catalogs with [Kavero's MCP server](../docs/mcp.md). Each folder holds a `SKILL.md` (instructions, with a `description` that tells the agent when to use it) and sometimes `references/` with longer examples.

| Skill | Use it for |
| --- | --- |
| [`kavero-quickstart`](kavero-quickstart/SKILL.md) | Connecting an agent (token, scopes, client config), choosing `catalog_generate` vs `catalog_create`, templates, page sizes, language/RTL, the end-to-end flow |
| [`kavero-catalogs`](kavero-catalogs/SKILL.md) | Catalog structure, layouts with coordinates, typography, color, RTL, quality checklist |
| [`kavero-product-sources`](kavero-product-sources/SKILL.md) | Importing products and images, mapping Shopify/WooCommerce/CSV data, large catalogs, editable product cards |
| [`kavero-animations`](kavero-animations/SKILL.md) | Element animations, slide transitions, slide durations for video and websites |
| [`kavero-morph`](kavero-morph/SKILL.md) | Morph / "magic move" sequences between slides, with step-by-step recipes |
| [`kavero-publish-export`](kavero-publish-export/SKILL.md) | Previews, PDF and PowerPoint exports, publishing and updating websites, editor-only exports (MP4, HTML file, JPG zip) |

The agent also needs the Kavero MCP server connected with a token — see `kavero-quickstart` or [docs/mcp.md](../docs/mcp.md).

## Install

**Claude Code** — copy the skill folders into `~/.claude/skills/` (all projects) or `.claude/skills/` inside a project:

```bash
mkdir -p ~/.claude/skills
cp -r skills/kavero-* ~/.claude/skills/
```

Skills load automatically when a request matches their description.

**Claude Desktop / claude.ai** — zip each skill folder (the zip must contain the folder with `SKILL.md` at its top) and upload it under **Settings → Capabilities → Skills** (custom skills require a plan with skills enabled):

```bash
cd skills && for s in kavero-*; do zip -r "$s.zip" "$s"; done
```

**Other agents** (Cursor, custom agents, other LLM clients) — paste the body of the relevant `SKILL.md` (and any `references/` file it mentions) into the agent's system prompt, project rules or instructions. Start with `kavero-quickstart` and `kavero-catalogs`; add the others when the task needs them.

## Keeping skills accurate

Tool names, arguments and limits in these skills mirror `packages/mcp-server/src/index.ts` and `packages/catalog-engine/src/schema.ts`. When a tool changes, update the skills that mention it (search for the tool name in `skills/`).
