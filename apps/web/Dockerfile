# Build from the repo root:  docker compose build web
# (or: docker build -f apps/web/Dockerfile --secret id=web_env,src=apps/web/.env .)

FROM node:24-slim AS builder
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY . .
RUN --mount=type=secret,id=web_env,target=/app/apps/web/.env.local --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile

ENV NODE_ENV=production
RUN --mount=type=secret,id=web_env,target=/app/apps/web/.env.local cd apps/web && bun run build && rm -f .next/standalone/.env* .next/standalone/apps/web/.env*
# standalone output excludes public/; ensure it exists so the runner copy never fails
RUN mkdir -p apps/web/public

FROM node:24-slim AS runner
# Chromium + ffmpeg power PDF/video/preview exports; fonts keep rendering consistent.
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium ffmpeg fonts-liberation fonts-noto-color-emoji fonts-noto-core ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data/storage && chown -R node:node /data

WORKDIR /app
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  KAVERO_CHROME_PATH=/usr/bin/chromium \
  FFMPEG_PATH=/usr/bin/ffmpeg \
  KAVERO_STORAGE_DIR=/data/storage \
  HOSTNAME=0.0.0.0 \
  PORT=3001

COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public
# varlock auto-load needs the Varlock CLI and its installed dependencies; the bun store also
# backs the symlinked serverExternalPackages (playwright-core, @ffmpeg-installer/ffmpeg).
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/apps/web/.env.schema ./apps/web/.env.schema

USER node
EXPOSE 3001
VOLUME ["/data/storage"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/apps/web
CMD ["node", "--import", "varlock/auto-load", "server.js"]
