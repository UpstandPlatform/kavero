# Kavero desktop

`apps/desktop` is a small Electron shell around the Kavero web app, not a second UI. It exists so Kavero can be installed like a normal app and, next, so it can run local stdio MCP servers (browsers can't spawn processes).

- **Development**: the window loads the web dev server (`http://localhost:3001`, or `KAVERO_URL`).
- **Installed app**: the Next standalone build of `apps/web` ships inside the app (`<resources>/web`). On launch the app starts it with Electron's own Node (`ELECTRON_RUN_AS_NODE=1`) on `127.0.0.1`, waits for it, loads it, and stops it on quit.

Source: `src/main.ts` (window, lifecycle, security), `src/server.ts` (bundled server), `src/config.ts` (`kavero.env`, secret), `src/varlock-env.ts`, `src/chrome.ts`, `src/preload.ts`. Electron 44, compiled with `tsc` to `dist/`.

## Development

```sh
bun run dev:web        # terminal 1: web app on :3001
bun run dev:desktop    # terminal 2: compiles apps/desktop and opens Electron
```

- `KAVERO_URL=http://localhost:3000 bun run dev:desktop` points the window elsewhere. If the server isn't up, a retry page is shown and the window reloads once it answers.
- Dev mode adds Reload / Force Reload / Toggle DevTools to the View menu and keeps its data in a separate `Kavero (dev)` folder.
- Smoke test (no visible window; loads the URL, prints the title, exits 0/1): `cd apps/desktop && bun run smoke`, or `KAVERO_SMOKE=1` / `--smoke` with any build, including a packaged `Kavero.exe`.
- Electron 44 downloads its binary on the first `electron` run (cached in the Electron cache folder), not during `bun install`.
- The renderer sees only `window.kaveroDesktop = { version, platform }`.

## Building installers locally

```sh
bun run build:desktop
# = turbo run build -F web  &&  (in apps/desktop) tsc → scripts/prepare-web.mjs → scripts/dist.mjs
```

Or step by step from `apps/desktop`: `bun run --filter web build` (repo root), then `bun run dist` (installers for the current OS) or `bun run dist:dir` (unpacked app in `release/<os>-unpacked`, faster).

- `scripts/prepare-web.mjs` stages `apps/web/.next/standalone` + `.next/static` + `public` + `.env.schema` into `apps/desktop/web-bundle`. It rebuilds bun's symlinked package store into a plain `node_modules` tree, because installers can't carry symlinks. `.env*` files, `.storage` and app sources are never copied.
- Output goes to `apps/desktop/release/` as `Kavero-<version>-<os>-<arch>.<ext>`, for example `Kavero-0.1.0-win-x64.exe`. Windows gets NSIS, macOS gets dmg and zip, Linux gets AppImage and deb. Each OS builds only its own installers.
- macOS builds are arm64 only. The bundled server contains native binaries (sharp, ffmpeg) for the build machine's architecture, so an Intel build needs an Intel runner.
- Icon: add `apps/desktop/assets/icon.png` (1024×1024). Without it, the default Electron icon is used. The folder is `assets/` and not `build/` because the root `.gitignore` ignores `build`.
- The web build needs `DATABASE_URL`, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` to pass varlock validation. Use placeholders: the desktop app supplies the real values at runtime, and `prepare-web` drops `.env` files from the bundle.

## Configuration: `kavero.env`

The installed app reads an optional dotenv file named `kavero.env` in its data folder:

| OS | Data folder |
| --- | --- |
| Windows | `%APPDATA%\Kavero` |
| macOS | `~/Library/Application Support/Kavero` |
| Linux | `~/.config/Kavero` (or `$XDG_CONFIG_HOME/Kavero`) |

Help → **Open Data Folder** opens it. Any variable from `apps/web/.env.schema` can go in this file. Restart Kavero after you edit it.

```sh
# kavero.env
DATABASE_URL=postgres://user:pass@db.example.com:5432/kavero   # enables sign-in + cloud catalogs
ANTHROPIC_API_KEY=sk-ant-...                                  # AI generation
KAVERO_CHROME_PATH=/opt/chrome/chrome                         # if Chrome isn't auto-detected
KAVERO_PORT=41731                                             # local server port (default 41731)
```

Also in the data folder:

- `auth-secret`: the `BETTER_AUTH_SECRET`, generated randomly on first launch unless `kavero.env` sets one. It also encrypts saved MCP credentials, so keep it.
- `storage/`: asset storage (`KAVERO_STORAGE_DIR`).
- `logs/server.log`: output of the bundled server.
- `desktop-state.json`: the remembered port.

The app always sets `BETTER_AUTH_URL` to the local server URL (`http://127.0.0.1:<port>`).

The port stays the same across launches on purpose. Local catalogs live in IndexedDB, which is scoped to the origin (port included), so a different port would show an empty dashboard. If the port is busy, Kavero uses a temporary one for that session and warns about it in the log.

Under the hood: the web app reads its config through varlock. A deployed server would normally resolve that config with the varlock CLI (`--import varlock/auto-load`), but that CLI is not available inside the app. Instead, `src/varlock-env.ts` builds varlock's pre-resolved `__VARLOCK_ENV` blob from the bundled `.env.schema` and the merged values (`kavero.env` > process env > desktop defaults).

## Local mode and cloud features

Without `DATABASE_URL`, Kavero starts in **local mode**: the server receives a placeholder connection string that is never reached.

- **Works**: creating and editing catalogs (IndexedDB), templates, `.kavero` project files, and PPTX export.
- **Needs a database**: sign-in, cloud catalogs and sync, publishing, API tokens, the MCP endpoint, MCP connections, and anything else that hits Postgres.
- **Health**: `/api/health` reports `db: false` in local mode, which is expected.

To enable cloud features, point `DATABASE_URL` at a Postgres database with migrations applied (see `docs/deployment.md`).

## Exports need Chrome

PDF, video and slide-preview exports drive headless Chrome against the app's own `/render` page. The desktop app looks for an installed Chrome, Edge or Chromium in the usual places for each OS and passes it to the server as `KAVERO_CHROME_PATH`. If none is found, the variable stays unset, and those exports fail until Chrome is installed or `KAVERO_CHROME_PATH` is set in `kavero.env`. ffmpeg for video is bundled (`@ffmpeg-installer`). A bundled Chromium is a possible future addition.

## Security

- **Renderer**: `contextIsolation`, `sandbox`, no `nodeIntegration`, no `<webview>`. The preload only exposes `kaveroDesktop`.
- **Navigation**: the window stays on the app's origin. Links to other http(s) or mailto URLs open in the system browser. Same-origin `target=_blank` opens a new app window with the same locked-down settings. Every other new window is denied.
- **Permissions**: all permission requests are denied except fullscreen and clipboard write.
- **Server**: binds to `127.0.0.1` only.
- **Single instance**: a second launch focuses the existing window.

## GitHub workflows

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` | push to `main`/`master`, PRs | `bun install --frozen-lockfile`, `bun run check-types` (turbo), `bun run test` (`bun test packages`), `bun run --filter web build` with placeholder env |
| `desktop.yml` | tags `v*`, manual | Matrix of Windows, macOS and Linux: web build, then `prepare-web`, then `scripts/dist.mjs`, then uploads installers as artifacts. On `v*` tags, a release job (the only job with `contents: write`) creates or updates the GitHub Release with all installers, using the tag's `CHANGELOG.md` section as notes when there is one. Tags containing `-` are marked as prereleases. |
| `release.yml` | push to `master`, manual | Automatic Windows releases with versioning and changelog — see [Releases](#releases) below. |
| `docker.yml` | push to `main`/`master`, tags, PRs touching the Dockerfile | Builds `apps/web/Dockerfile` with a placeholder `web_env` secret. On `v*` tags it pushes `ghcr.io/<owner>/kavero-web`. |

### Releases

`release.yml` turns every push to `master` that contains a feature or a fix into a Windows release:

1. **Checks, version and changelog.** Type checks and unit tests run first; then `scripts/release.ts` reads the commits since the last `v*` tag and picks the next version from their [Conventional Commits](https://www.conventionalcommits.org/) prefixes:

   | Commits since the last tag | Next version |
   | --- | --- |
   | `feat:` (or an older-style "Add …" subject) | minor — `0.3.0` → `0.4.0` |
   | `fix:`, `perf:` (or "Fix …") | patch — `0.3.0` → `0.3.1` |
   | `feat!:` / `BREAKING CHANGE:` | major — but minor while the version is `0.x` |
   | only `docs`, `chore`, `ci`, `test`, `style`, `build`, `refactor` | no release |

   It prepends the version's section to [`CHANGELOG.md`](../CHANGELOG.md) (features, fixes, performance, other changes, each linked to its commit), sets the version in `apps/desktop/package.json` and `apps/web/package.json`, commits `chore(release): vX.Y.Z [skip ci]`, tags it and pushes. The very first release uses the version already in `apps/desktop/package.json`.
2. **Windows build.** The tagged commit is built on `windows-latest`: web build, `prepare-web`, `scripts/dist.mjs` → `Kavero-X.Y.Z-win-x64.exe` (NSIS installer), its `.blockmap` and `latest.yml`.
3. **Publish.** A GitHub release `Kavero vX.Y.Z` is created with the changelog section as notes and the installer attached, and marked as the latest release.

Pushes that only change Markdown, `docs/`, `skills/` or issue templates don't start it at all.

**Run it by hand** (Actions → Release (Windows) → Run workflow) to force a `patch`, `minor` or `major` bump, or to publish a prerelease: a label such as `beta` gives `0.4.0-beta.1`, then `0.4.0-beta.2`; prereleases aren't marked as latest.

**Preview locally** what the next release would be — nothing is changed without `--write`:

```bash
bun scripts/release.ts
bun scripts/release.ts --bump minor --pre beta
```

**Branch protection.** The workflow pushes the release commit and tag with `GITHUB_TOKEN`. If `master` is protected, add a `RELEASE_TOKEN` secret (a fine-grained personal access token with *Contents: read and write* on this repository) or allow GitHub Actions to bypass the rule. With `RELEASE_TOKEN`, the pushed tag also starts `desktop.yml`, which adds macOS and Linux installers to the same release.

### Signing secrets (all optional)

Without these secrets, builds are unsigned: `CSC_IDENTITY_AUTO_DISCOVERY=false`, and macOS builds use `identity: null`. Unsigned builds trigger SmartScreen on Windows and Gatekeeper on macOS. In that case users must right-click → Open on macOS, or run `xattr -dr com.apple.quarantine Kavero.app`.

| Secret | Used for |
| --- | --- |
| `CSC_LINK` | macOS Developer ID Application certificate (`.p12`, base64 or URL). On Windows it is the fallback when `WIN_CSC_LINK` is unset. |
| `CSC_KEY_PASSWORD` | Password for `CSC_LINK` |
| `APPLE_ID` | Apple ID for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for that Apple ID |
| `APPLE_TEAM_ID` | Developer team ID. Notarization runs only when a certificate and all three `APPLE_*` secrets are set. |
| `WIN_CSC_LINK` | Windows code-signing certificate (`.pfx`, base64 or URL) |
| `WIN_CSC_KEY_PASSWORD` | Password for `WIN_CSC_LINK` |

`scripts/dist.mjs` writes `latest*.yml` update metadata for `GITHUB_REPOSITORY` when that variable is set, as it is in Actions. It never uploads anything. The release job publishes the files.

## Current limitations and next steps

- **No auto-update yet.** The update metadata (`latest*.yml`) is already produced and attached to releases, so the next step is to add `electron-updater` to the main process.
- **No stdio MCP companion UI yet.** This is the intended next step: a main-process service that spawns local MCP servers (stdio) and exposes them to the web app over a narrow, explicit IPC bridge in the preload.
- **Exports need a system Chrome.** See above.
- **macOS is arm64 only.** Windows and Linux are x64 only.
- **Local catalogs are tied to the port.** They live in the app's own browser profile, under the local origin, so changing `KAVERO_PORT` hides them until the port is changed back. Export `.kavero` files before moving machines.
- **The bundled server only binds to `127.0.0.1`.** That is fine for exports, which load `/render` on the same origin. Published sites served from the desktop app are only reachable from that machine.
