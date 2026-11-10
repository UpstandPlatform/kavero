# Kavero documentation

**Kavero** — from product data to beautiful experiences. Build product catalogs and presentations visually or with AI, import products over MCP, and publish them as PDF, PowerPoint, JPG images, MP4 video, a single HTML file or animated websites.

## Start here

| | |
| --- | --- |
| **[Using Kavero](user-guide.md)** | Create a catalog, edit slides and layers, products, right-to-left text, animations and Morph, exports, cloud sync, publishing, workspaces, shortcuts and troubleshooting. |
| **[Administering a server](user-guide.md#administering-a-server)** | The first account is the admin: users and roles, suspensions, sign-up policy, site moderation, activity log. |
| **[Kavero and MCP](mcp.md)** | Connect Claude or any MCP client, permissions, all 29 tools (including fonts), element JSON, recipes (store → catalog, RTL), and product sources. |
| **[Agent skills](../skills/README.md)** | Drop-in skills for agents: connect (`kavero-quickstart`), build catalogs (`kavero-catalogs`), animate (`kavero-animations`, `kavero-morph`), bring in products (`kavero-product-sources`) and deliver (`kavero-publish-export`). |

## Run and operate

| | |
| --- | --- |
| **[Deployment](deployment.md)** | Environment variables, Docker, migrations, admin accounts, export limits, hosting options, HTTPS, storage (S3/R2/MinIO), Chrome/ffmpeg, backups, monitoring, CI/CD. |
| **[Desktop app](desktop.md)** | The Electron app, building installers, and the release workflow. |
| **[Architecture](architecture.md)** | How the packages fit together: document model, editor commands, renderer, sync, publishing, exports, MCP. |

## Quick links

- Local app: `http://localhost:3001` · Dashboard: `/dashboard` · Settings: `/settings` · Admin: `/admin`
- MCP endpoint: `/api/mcp` (Streamable HTTP, `Authorization: Bearer kv_…`)
- Health: `/api/health`

## Project

- [Contributing](../CONTRIBUTING.md) — setup, checks, commit style, templates and translations
- [Changelog](../CHANGELOG.md) — what changed in each release
- [Donations](../DONATIONS.md) — support Kavero's development
- [License](../LICENSE) — MIT
