function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The header logo (two stacked slides with a K), as in the web app. */
const LOGO = `<svg viewBox="0 0 24 24" width="56" height="56" aria-hidden="true"><rect x="2" y="6" width="15" height="12" rx="3" fill="currentColor" fill-opacity=".3"/><rect x="7" y="3" width="15" height="12" rx="3" fill="currentColor"/><path d="M12 6.5v5M12 9l3.2-2.5M12 9l3.2 2.5" stroke="var(--logo-k)" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>`;

/** Colors and type from the web app's theme (shadcn neutral, Inter → Segoe UI / system). */
const BASE_CSS = `
  :root { color-scheme: light dark; --bg:#ffffff; --fg:#171717; --muted:#737373; --card:#ffffff; --border:#e5e5e5; --accent:#171717; --accent-fg:#fafafa; --logo-k:#fafafa; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0a0a0a; --fg:#fafafa; --muted:#a3a3a3; --card:#171717; --border:#262626; --accent:#fafafa; --accent-fg:#171717; --logo-k:#171717; } }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 "Inter", "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif; -webkit-font-smoothing: antialiased; user-select: none; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand svg { color: var(--fg); }
  .wordmark { font-size: 26px; font-weight: 650; letter-spacing: -0.02em; }
`;

const page = (title: string, css: string, body: string) =>
  `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>${BASE_CSS}${css}</style></head><body>${body}</body></html>`)}`;

/** Shown in a small window while the local server starts (a few seconds on first launch). */
export function splashPage(opts: { version: string }): string {
  return page(
    "Kavero",
    `
    body { display: grid; place-items: center; -webkit-app-region: drag; border: 1px solid var(--border); }
    main { width: 100%; padding: 0 40px; }
    .tagline { margin: 10px 0 28px; color: var(--muted); }
    .bar { height: 3px; border-radius: 3px; background: var(--border); overflow: hidden; }
    .bar::after { content: ""; display: block; width: 35%; height: 100%; border-radius: 3px; background: var(--fg); animation: slide 1.2s ease-in-out infinite; }
    @keyframes slide { from { transform: translateX(-100%); } to { transform: translateX(290%); } }
    @media (prefers-reduced-motion: reduce) { .bar::after { animation: none; width: 100%; opacity: .4; } }
    footer { position: fixed; left: 40px; right: 40px; bottom: 18px; display: flex; justify-content: space-between; color: var(--muted); font-size: 12px; }
  `,
    `<main>
      <div class="brand">${LOGO}<span class="wordmark">Kavero</span></div>
      <p class="tagline">From product data to beautiful experiences.</p>
      <div class="bar" role="progressbar" aria-label="Starting Kavero"></div>
    </main>
    <footer><span>Starting…</span><span>v${escapeHtml(opts.version)}</span></footer>`,
  );
}

/** Friendly "can't reach the server" page; the main process also retries in the background. */
export function unreachablePage(opts: { url: string; detail: string; dev: boolean }): string {
  const url = escapeHtml(opts.url);
  const hint = opts.dev
    ? `Start the web app with <code>bun run dev:web</code> (or set <code>KAVERO_URL</code>), then try again.`
    : `Kavero's built-in server didn't answer. If this keeps happening, check <code>logs/server.log</code> (Help → Open Data Folder).`;
  return page(
    "Kavero — waiting for the server",
    `
    body { display: grid; place-items: center; }
    main { width: min(460px, calc(100% - 32px)); padding: 32px; background: var(--card); border: 1px solid var(--border); border-radius: 16px; }
    .brand svg { width: 36px; height: 36px; }
    .wordmark { font-size: 20px; }
    h1 { font-size: 18px; font-weight: 600; margin: 24px 0 6px; letter-spacing: -0.01em; }
    p { margin: 0 0 10px; color: var(--muted); }
    code { font: 12.5px ui-monospace, "Cascadia Code", Consolas, monospace; color: var(--fg); }
    .row { display: flex; align-items: center; gap: 12px; margin-top: 20px; }
    a.button { padding: 8px 14px; border-radius: 8px; background: var(--accent); color: var(--accent-fg); text-decoration: none; font-weight: 500; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #f59e0b; animation: pulse 1.4s ease-in-out infinite; }
    @keyframes pulse { 50% { opacity: .3; } }
    small { display: block; margin-top: 20px; padding-top: 12px; border-top: 1px solid var(--border); color: var(--muted); font-size: 12px; word-break: break-all; }
  `,
    `<main>
      <div class="brand">${LOGO}<span class="wordmark">Kavero</span></div>
      <h1>Can’t reach Kavero yet</h1>
      <p>${hint}</p>
      <div class="row"><a class="button" href="${url}">Try again</a><span class="dot"></span><span style="color:var(--muted)">Retrying automatically…</span></div>
      <small>${url} — ${escapeHtml(opts.detail)}</small>
    </main>`,
  );
}
