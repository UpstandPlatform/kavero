# Deploying Kavero

Kavero ships as one Next.js server (`apps/web`, standalone output), Postgres and Redis. Binary assets live in object storage (a local folder or an S3-compatible bucket). PDF, video and preview exports need headless Chromium and ffmpeg on the server.

## Environment

Declared in `apps/web/.env.schema` (varlock). Values come from the process environment, `apps/web/.env`, or `.env.local`. Run `bunx varlock load` in `apps/web` to check what resolves.

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | yes | `development` | `production` in deployments. |
| `DATABASE_URL` | yes | — | Postgres connection string. Sensitive. |
| `REDIS_URL` | no | unset | Redis connection string for shared rate limits, Better Auth session lookups and short-lived caches. When omitted or unavailable, these use bounded process-local fallback storage. Sensitive if it contains credentials. |
| `BETTER_AUTH_SECRET` | yes | — | ≥ 32 random chars (`openssl rand -base64 48`). Signs sessions **and** derives the key that encrypts stored MCP connection credentials: rotating it signs everyone out and makes saved connection tokens unreadable (they must be re-entered). |
| `BETTER_AUTH_URL` | yes | — | Public origin, e.g. `https://kavero.example.com`. Public. Used for auth, trusted origins, sitemap and robots. |
| `STORAGE_DRIVER` | no | `filesystem` | `filesystem` or `s3`. |
| `KAVERO_STORAGE_DIR` | no | `<cwd>/.storage` | Folder for the filesystem driver. `/data/storage` in the Docker image. |
| `NEXT_PUBLIC_OPENVERSE_ENABLED` | no | unset (disabled) | Set to `true` to show Openverse stock image search in the media library. |
| `NEXT_PUBLIC_GIPHY_API_KEY` | no | unset (disabled) | Public GIPHY key; GIF search is hidden when no key is configured. |
| `S3_BUCKET` | with `s3` | — | Bucket name. |
| `S3_REGION` | no | `us-east-1`, or `auto` when `S3_ENDPOINT` is set | Use `auto` for Cloudflare R2. |
| `S3_ENDPOINT` | no | AWS | R2: `https://<account>.r2.cloudflarestorage.com`; MinIO: `http://minio:9000`. |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | no | SDK default chain | Sensitive. Omit both to use an IAM role / `AWS_*` env / shared config. |
| `S3_FORCE_PATH_STYLE` | no | `false` | `true` for MinIO. |
| `KAVERO_CHROME_PATH` | no | auto-detect | Chrome/Chromium binary. `/usr/bin/chromium` in the image. |
| `FFMPEG_PATH` | no | bundled `@ffmpeg-installer` binary | `/usr/bin/ffmpeg` in the image. |

AI and other feature variables are documented in the schema next to their definitions.

## Docker

```sh
# create apps/web/.env with at least BETTER_AUTH_SECRET (see table above)
docker compose up -d --build              # postgres + redis, then migrate and web
docker compose logs -f web
```

- `apps/web/.env` is mounted as a BuildKit secret during build (never baked into layers) and loaded as `env_file` at runtime. Values in `environment:` in `docker-compose.yml` override it — change `BETTER_AUTH_URL` there for a real domain.
- `web` listens on `3001`. Postgres is published on host port `5436` for local tools. Redis is published on `127.0.0.1:6379` for local development and is only reachable through the internal Compose network by default.
- Volumes: `Kavero_postgres_data` (database), `Kavero_redis_data` (Redis AOF persistence), `Kavero_storage_data` at `/data/storage` (assets, OG images).
- Compose Redis uses AOF persistence, bounded memory and `noeviction` so rate-limit counters are not silently evicted. Set REDIS_URL in the Compose environment to use a managed Redis service instead.
- `shm_size: 1gb` gives Chromium enough shared memory; keep it if you run the image elsewhere (`--shm-size=1g`).
- The image runs as the unprivileged `node` user and has a `HEALTHCHECK` on `/api/health`.

Standalone `docker build` (from the repo root):

```sh
docker build -f apps/web/Dockerfile --secret id=web_env,src=apps/web/.env -t kavero-web .
docker run -p 3001:3001 --shm-size=1g --env-file apps/web/.env -v kavero-storage:/data/storage kavero-web
```

## Migrations

Migrations live in `packages/db/src/migrations` (drizzle-kit). Apply them before starting a new version:

```sh
# compose: runs automatically before web starts; on demand:
docker compose run --rm migrate

# anywhere else (needs the repo + bun install):
cd packages/db && DATABASE_URL=postgres://... bunx drizzle-kit migrate
```

Create new migrations in development with `bun run db:generate` after changing `packages/db/src/schema`.

## Exports, proxies and limits

| Variable | Default | What it does |
| --- | --- | --- |
| `KAVERO_RENDER_URL` | `BETTER_AUTH_URL` | Address the export browser uses to reach the app. Set an internal address when the server can't reach its own public URL (the Docker compose file sets `http://127.0.0.1:3001`). |
| `KAVERO_MAX_BROWSERS` | `2` | Headless Chrome exports (PDF, JPG, video, previews) running at once; others queue, then get "busy, try again". |
| `TRUST_PROXY` | unset | Set to `true` (or the number of proxy hops) behind a reverse proxy, so password-protected sites can rate-limit wrong passwords per visitor. Without it only a per-site limit applies. |

Export requests are capped at 60 MB and page sizes at 10000 px. Export browsers can only load the app itself, Google Fonts and public HTTPS addresses.

## Admin accounts

- On a new server, **the first account that signs up becomes the admin**. Create your own account right after deploying, before sharing the address.
- Servers upgraded from a version without admins: the migration makes the **oldest account** the admin if none exists. Check **Admin → Users** after upgrading.
- Admins can make other accounts admins and choose who may sign up (open, invite-only or closed) in **Admin → Sign-ups**. For a private company server, set it to invite-only or closed once your team has joined.
- Recovering admin access (run where the app's `DATABASE_URL` is available):

  ```bash
  bun run make-admin you@example.com
  ```

  Add `--remove` to take admin away. It also lifts a suspension on that account.

## Hosting options

Kavero needs a long-running Node server (API routes, MCP endpoint, background video jobs) with Chromium available. Pick by scale:

| Option | Good for | Notes |
| --- | --- | --- |
| **One VPS + Docker Compose** (recommended start) | Teams, small business | Any Linux VM with 2 vCPU / 4 GB RAM. `docker compose up -d --build`, a reverse proxy for HTTPS (below), daily backups. |
| **Container platforms** (Fly.io, Railway, Render, Coolify, Dokku, Kubernetes) | Managed ops | Deploy `apps/web/Dockerfile` with a managed Postgres; use S3/R2 storage so instances are stateless. Give it ≥ 1 GB shared memory for Chromium. |
| **Serverless (Vercel, Netlify)** | Not recommended | No Chromium for PDF/video/previews, short function timeouts, no in-memory video jobs. Editor, sync and publishing work; exports don't. |
| **Desktop app** | Single user, offline | See [desktop.md](desktop.md). |

### VPS walkthrough

```sh
# 1. On the server (Docker + Compose installed)
git clone <your fork> kavero && cd kavero
cp apps/web/.env.example apps/web/.env      # set BETTER_AUTH_SECRET, BETTER_AUTH_URL=https://catalog.example.com
#    and change POSTGRES_PASSWORD in docker-compose.yml / its .env
docker compose up -d --build                 # postgres + redis, then migrate and web on :3001

# 2. HTTPS with Caddy (automatic certificates)
cat > Caddyfile <<'EOF'
catalog.example.com {
  reverse_proxy 127.0.0.1:3001
}
EOF
caddy run --config Caddyfile                 # or run Caddy/Traefik/nginx as a service
```

- Remove the Postgres `ports:` mapping in production.
- Updates: `git pull && docker compose up -d --build` (migrations run automatically before `web` starts).
- Published catalogs live at `https://catalog.example.com/c/<slug>`; the MCP endpoint is `https://catalog.example.com/api/mcp`.

### CI/CD

`.github/workflows/` contains:

- **CI** — typecheck, unit tests and a production build on every push and pull request.
- **Docker** — builds the web image (and pushes it to GitHub Container Registry on version tags) if enabled.
- **Desktop** — builds Windows, macOS and Linux installers on `v*` tags and attaches them to a GitHub Release ([desktop.md](desktop.md)).

To deploy automatically, add a job after the image is pushed that SSHes to your server and runs `docker compose pull && docker compose up -d`, or point your container platform at the GHCR image.

## Storage

| Option | When | Setup |
| --- | --- | --- |
| Filesystem (default) | single server | Mount a persistent volume at `KAVERO_STORAGE_DIR`. Not shared between instances. |
| AWS S3 | multi-instance / managed | `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_REGION`, keys or IAM role. |
| Cloudflare R2 | cheap egress | `STORAGE_DRIVER=s3`, `S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com`, `S3_REGION=auto`, R2 API token keys. |
| MinIO | self-hosted S3 | `STORAGE_DRIVER=s3`, `S3_ENDPOINT=http://minio:9000`, `S3_FORCE_PATH_STYLE=true`. |

The bucket stays private: assets are always served through the app (`/api/catalogs/:id/assets/*`, `/c/:slug/assets/*`), which enforces access. The credentials need `GetObject`, `PutObject`, `DeleteObject` on the bucket. Keys look like `catalogs/<id>/<sha256>` and `publications/<id>/og-v<n>.png`. Switching drivers does not migrate data — copy the folder into the bucket with the same keys (e.g. `aws s3 sync ./storage s3://bucket/`).

## Chrome and ffmpeg

Needed for PDF export, video export, slide previews (MCP `catalog_preview`) and social preview images. The Docker image installs Debian `chromium`, `ffmpeg` and fonts (Liberation, Noto, Noto Color Emoji). Outside Docker, install Chrome/Chromium and either ffmpeg or rely on the bundled npm binary; set `KAVERO_CHROME_PATH` / `FFMPEG_PATH` if they are not in a standard location.

Rendering loads the app's own `/render` page over HTTP at the **request's origin**, so the server must be able to reach the URL users reach it on (behind a proxy: make sure the public hostname resolves from inside the container, or route it back internally).

Video exports render in-process (max 3 concurrent jobs), write to the OS temp dir, and are tracked in memory: a restart drops running jobs, and with several instances a user must hit the same instance to download (use sticky sessions).

## Backup and recovery

Back up the database and the asset storage together; the database references storage keys.

```sh
# Database
docker compose exec -T postgres pg_dump -U postgres -Fc Kavero > kavero-$(date +%F).dump
docker compose exec -T postgres pg_restore -U postgres -d Kavero --clean --if-exists < kavero-2026-11-09.dump

# Filesystem storage volume
docker run --rm -v kavero_Kavero_storage_data:/data -v "$PWD":/backup alpine tar czf /backup/storage-$(date +%F).tgz -C /data .
docker run --rm -v kavero_Kavero_storage_data:/data -v "$PWD":/backup alpine tar xzf /backup/storage-2026-11-09.tgz -C /data
```

(`docker volume ls` shows the exact volume name.) For S3/R2, enable bucket versioning or replicate the bucket (`aws s3 sync s3://bucket s3://backup-bucket`). Restore order: storage, then database, then run migrations, then start `web`. Keep `BETTER_AUTH_SECRET` with the backups — without it stored MCP credentials cannot be decrypted.

Local-only catalogs live in each user's browser (IndexedDB) and are not on the server; users can export `.kavero` project files.

## Monitoring

`GET /api/health` (never cached):

```json
{ "status": "ok", "db": true, "storage": true, "chrome": true, "ffmpeg": true, "version": "0.1.0" }
```

- `200` when the database answers `select 1`; `503` otherwise. `status` is `ok`, `degraded` (storage probe failed) or `error` (database down).
- `storage` writes, reads and deletes a tiny `health/probe-*` object. `chrome`/`ffmpeg` only check the binaries exist.
- Point load-balancer/uptime checks here; alert on `503` and on `storage: false` or `chrome: false` (exports will fail).

## Security notes

- `BETTER_AUTH_SECRET`: ≥ 32 random characters, unique per environment, stored as a secret.
- Serve only over HTTPS (terminate TLS at a reverse proxy) and set `BETTER_AUTH_URL` to the `https://` origin; secure cookies and trusted origins depend on it.
- Rate limits (MCP API: 120 req/min per API key; AI requests; publication password attempts) use shared Redis storage when `REDIS_URL` is configured. If Redis is unavailable or not configured, Kavero falls back to bounded process-local storage; in that mode limits are per instance and may be less strict across multiple instances.
- Keep Postgres off the public internet (compose publishes `5436` for local use; remove the `ports:` mapping in production) and change the default `POSTGRES_PASSWORD`.
- MCP API keys are scoped by catalogs, assets, exports, AI generation, workspaces and publishing permissions, then audited in `audit_log`; revoke unused keys in Settings.
- `robots.txt` disallows `/api/`, `/editor/`, `/render`, `/settings`, `/dashboard`; only `public` publications appear in `/sitemap.xml`.
