# Kavero documentation

**Kavero** — from product data to beautiful experiences. Build product catalogs and presentations visually or with AI, import products over MCP, and publish them as PDF, PowerPoint, MP4 video or animated websites.

## Start here

| | |
| --- | --- |
| **[Using Kavero](user-guide.md)** | Create a catalog, edit slides, products, right-to-left text, animations, exports, cloud sync, publishing, workspaces, shortcuts and troubleshooting. |
| **[Kavero and MCP](mcp.md)** | Connect Claude or any MCP client, permissions, all 24 tools, element JSON, recipes (store → catalog, RTL), and product sources. |
| **[Agent skills](../skills/)** | Drop-in skills that teach agents to build standard catalogs (`kavero-catalogs`) and animate them well (`kavero-animations`). |

## Run and operate

| | |
| --- | --- |
| **[Deployment](deployment.md)** | Environment variables, Docker, migrations, hosting options, HTTPS, storage (S3/R2/MinIO), Chrome/ffmpeg, backups, monitoring, CI/CD. |
| **[Desktop app](desktop.md)** | The Electron app, building installers, and the release workflow. |
| **[Architecture](architecture.md)** | How the packages fit together: document model, editor commands, renderer, sync, publishing, exports, MCP. |

## Quick links

- Local app: `http://localhost:3001` · Dashboard: `/dashboard` · Settings: `/settings`
- MCP endpoint: `/api/mcp` (Streamable HTTP, `Authorization: Bearer kv_…`)
- Health: `/api/health`
