/**
 * Defense-in-depth cleanup for user HTML/CSS. The real security boundary is the
 * sandboxed iframe (no allow-scripts, no allow-same-origin); this keeps stored
 * documents free of executable content so every renderer and export is safe.
 * String-based so it runs the same in the browser, Bun and Node.
 */

const DROP_WITH_CONTENT = ["script", "style", "iframe", "object", "embed", "noscript", "template", "frameset", "frame", "applet"];
const DROP_TAG_ONLY = ["base", "meta", "link", "form", "input", "button", "textarea", "select", "portal"];
const URL_ATTRS = ["href", "src", "srcset", "poster", "xlink:href", "action", "formaction", "background"];

function isSafeUrl(raw: string): boolean {
  // Remove whitespace/control chars and entity tricks before checking the scheme.
  const v = raw.replace(/&#x?0*(9|10|13|a|d);?/gi, "").replace(/[\s\u0000-\u001f]+/g, "").toLowerCase();
  if (v.startsWith("data:")) return /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml);/.test(v);
  return !/^[a-z][a-z0-9+.-]*:/.test(v) || /^(https?|mailto|tel):/.test(v);
}

/** One pass of comment and dangerous-tag removal. */
function stripTags(input: string): string {
  let html = input.replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of DROP_WITH_CONTENT) {
    html = html.replace(new RegExp(String.raw`<${tag}\b[\s\S]*?<\/${tag}\s*>`, "gi"), "");
    html = html.replace(new RegExp(String.raw`<\/?${tag}\b[^>]*>`, "gi"), "");
  }
  for (const tag of DROP_TAG_ONLY) html = html.replace(new RegExp(String.raw`<\/?${tag}\b[^>]*>`, "gi"), "");
  return html;
}

export function sanitizeHtml(input: string): string {
  // Repeat until stable: one pass over "<scr<script>ipt>" would leave a new <script> behind.
  let html = input;
  for (let prev = ""; prev !== html; ) {
    prev = html;
    html = stripTags(html);
  }

  // Clean attributes inside every remaining tag.
  return html.replace(/<([a-z][a-z0-9-]*)(\s[^>]*?)?(\/?)>/gi, (_m, tag: string, attrs = "", selfClose: string) => {
    const kept: string[] = [];
    const re = /([^\s"'=<>`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    for (const a of attrs.matchAll(re)) {
      const name = a[1]!.toLowerCase();
      const value = a[2] ?? a[3] ?? a[4];
      if (name.startsWith("on") || name === "srcdoc" || name === "formaction") continue;
      if (URL_ATTRS.includes(name) && value !== undefined && !isSafeUrl(value)) continue;
      if (name === "style" && value !== undefined) {
        kept.push(`style="${sanitizeCss(value).replace(/"/g, "&quot;")}"`);
        continue;
      }
      kept.push(value === undefined ? name : `${name}="${value.replace(/"/g, "&quot;")}"`);
    }
    return `<${tag}${kept.length ? " " + kept.join(" ") : ""}${selfClose}>`;
  });
}

export function sanitizeCss(input: string): string {
  return input
    .replace(/<\/?style[^>]*>/gi, "")
    .replace(/@import[^;]*;?/gi, "")
    .replace(/expression\s*\(/gi, "")
    .replace(/behavior\s*:/gi, "")
    .replace(/-moz-binding\s*:/gi, "")
    // url( ... ) allowing one level of nested parentheses, e.g. url(javascript:alert(1)).
    .replace(/url\(((?:[^()]|\([^()]*\))*)\)/gi, (m, inner: string) => (isSafeUrl(inner.trim().replace(/^['"]|['"]$/g, "")) ? m : "none"));
}
