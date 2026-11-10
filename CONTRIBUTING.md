# Contributing to Kavero

Thanks for helping make Kavero better! Bug reports, ideas, templates, translations, docs and code are all welcome.

- **Questions and ideas:** open a [feature request](https://github.com/UpstandPlatform/kavero/issues/new?template=feature_request.yml) or start with an issue before large changes, so we can agree on the approach first.
- **Bugs:** use the [bug report](https://github.com/UpstandPlatform/kavero/issues/new?template=bug_report.yml) template.
- **Security problems:** please **don't** open a public issue. Report them privately through [GitHub security advisories](https://github.com/UpstandPlatform/kavero/security/advisories/new).

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).

## Development setup

You need [Bun](https://bun.sh) 1.4+, Docker (for Postgres) and Chrome or Chromium (for PDF, JPG and video exports).

```bash
git clone https://github.com/UpstandPlatform/kavero.git
cd kavero
bun install
cp apps/web/.env.example apps/web/.env   # set BETTER_AUTH_SECRET to 32+ random characters
bun run db:start                          # Postgres on localhost:5436
bun run db:migrate
bun run dev:web                           # http://localhost:3001
```

The first account you sign up with becomes the server admin. See [docs/deployment.md](docs/deployment.md) for every environment variable and [docs/architecture.md](docs/architecture.md) for how the packages fit together.

## Where things live

| Area | Path |
| --- | --- |
| Web app (dashboard, editor, published sites, API routes) | `apps/web` |
| Desktop app (Electron) | `apps/desktop` |
| Document schema, validation, templates | `packages/catalog-engine` |
| Editor commands and undo/redo | `packages/editor-core` |
| Slide renderer and player | `packages/renderer` |
| Animations, transitions, Morph | `packages/animation-engine` |
| tRPC routers and services | `packages/api` |
| MCP tools | `packages/mcp-server` |
| Exports | `packages/export-chromium`, `packages/export-pptx` |
| Database schema and migrations | `packages/db` |
| Agent skills | `skills/` |

## Making a change

1. Fork the repository and create a branch from `master` (`fix/zoom-on-safari`, `feat/csv-import`).
2. Keep the change focused: one fix or feature per pull request.
3. Add or update tests next to the code (`*.test.ts`, run with `bun test`). User-facing changes should update the docs in `docs/`.
4. Database changes: edit the schema in `packages/db/src/schema`, then run `bun run db:generate` and commit the generated migration.
5. Run the checks below, then open a pull request and fill in the template.

### Checks

```bash
bun run check-types   # TypeScript across all packages
bun run test          # unit tests
bun run build         # production build
```

The end-to-end suites in `packages/mcp-server/e2e/` (and `packages/auth/e2e/`) run against a local dev server and database. Run the ones related to your change; each file explains its setup.

CI runs type checks, tests and a production build on every pull request.

### Style

- TypeScript everywhere, strict mode. Validate untrusted input with Zod at the edges (API, MCP, imports).
- Match the surrounding code: naming, file layout, formatting. Prefer small, readable functions over clever ones.
- Comments explain *why*, briefly. UI text is short, plain and specific.
- Anything that renders slides must stay deterministic: the editor preview, published sites, HTML export and video share the same renderer.
- Support right-to-left languages: use logical properties (`start`/`end`) rather than `left`/`right` in layout.

### Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/). Release versions and the [changelog](CHANGELOG.md) are generated from them:

| Prefix | Use for | Version bump |
| --- | --- | --- |
| `feat:` | A new feature | minor |
| `fix:` | A bug fix | patch |
| `perf:`, `refactor:`, `docs:`, `test:`, `build:`, `ci:`, `chore:` | Everything else | patch |
| `feat!:` or a `BREAKING CHANGE:` footer | Incompatible changes | major |

Examples: `feat(editor): add a Layers panel`, `fix(sync): keep cloud link after a failed upload`.

## Templates and translations

- New catalog templates go in `packages/catalog-engine/src/templates.ts`. Add one for a real use case, use theme colors and fonts (not fixed values), and check it in the editor, PDF and PowerPoint export.
- When adding UI text, keep it in plain English sentences that are easy to translate.

## Code of conduct

Be kind and constructive. Assume good intent, focus on the work, and help newcomers. Harassment or personal attacks aren't tolerated; maintainers may remove comments or contributors that break this.
