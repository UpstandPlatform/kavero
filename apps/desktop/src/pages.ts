function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Friendly "can't reach the server" page; the main process also retries in the background. */
export function unreachablePage(opts: { url: string; detail: string; dev: boolean }): string {
  const url = escapeHtml(opts.url);
  const hint = opts.dev
    ? `Start the web app with <code>bun run dev:web</code> (or set <code>KAVERO_URL</code>), then try again.`
    : `The built-in Kavero server could not be reached. Check the log in the Kavero data folder (Help → Open Data Folder).`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Kavero — waiting for server</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
  :root { color-scheme: light dark; --bg:#f7f7f8; --fg:#18181b; --muted:#71717a; --card:#fff; --border:#e4e4e7; --accent:#18181b; --accent-fg:#fff; }
  @media (prefers-color-scheme: dark) { :root { --bg:#09090b; --fg:#fafafa; --muted:#a1a1aa; --card:#18181b; --border:#27272a; --accent:#fafafa; --accent-fg:#09090b; } }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--fg); font:15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width:440px; margin:16px; padding:32px; background:var(--card); border:1px solid var(--border); border-radius:12px; }
  h1 { font-size:20px; margin:0 0 8px; }
  p { margin:0 0 12px; color:var(--muted); }
  code { font-size:13px; }
  a.button { display:inline-block; margin-top:8px; padding:8px 16px; border-radius:8px; background:var(--accent); color:var(--accent-fg); text-decoration:none; font-weight:500; }
  small { display:block; margin-top:16px; color:var(--muted); word-break:break-all; }
</style></head>
<body><main>
  <h1>Can’t reach Kavero yet</h1>
  <p>${hint}</p>
  <p>Retrying automatically…</p>
  <a class="button" href="${url}">Try again</a>
  <small>${url} — ${escapeHtml(opts.detail)}</small>
</main></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
