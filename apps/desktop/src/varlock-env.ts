import { readFileSync } from "node:fs";

/**
 * The web app reads its config through varlock (`apps/web/.env.schema`). A deployed
 * Next server normally gets a resolved env from `varlock/auto-load`, which shells out to
 * the varlock CLI (a Node script) — not available on end-user machines. varlock also
 * accepts a pre-resolved env blob in `__VARLOCK_ENV`, so the desktop app builds that
 * blob itself from the bundled schema plus the resolved values.
 *
 * Only the decorators the blob needs are interpreted (sensitivity, boolean/number
 * coercion, defaults). Validation is the desktop app's job (see main.ts).
 */
type SchemaItem = { key: string; sensitive: boolean; type?: string; defaultValue?: string };

export function parseEnvSchema(source: string): SchemaItem[] {
  const items: SchemaItem[] = [];
  let defaultSensitive = false;
  let decorators: string[] = [];
  let inHeader = true;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("#")) {
      if (inHeader && /^#\s*---/.test(line)) {
        inHeader = false;
        decorators = [];
        continue;
      }
      if (inHeader && /@defaultSensitive=true/.test(line)) defaultSensitive = true;
      decorators.push(line);
      continue;
    }
    if (!line) {
      decorators = [];
      continue;
    }
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    inHeader = false;
    const tags = decorators.join(" ");
    const type = /@type=([a-z]+)/.exec(tags)?.[1];
    let sensitive = defaultSensitive;
    if (/@public\b/.test(tags)) sensitive = false;
    if (/@sensitive\b(?!=false)/.test(tags)) sensitive = true;
    const defaultValue = (match[2] ?? "").replace(/^["']|["']$/g, "");
    items.push({ key: match[1]!, sensitive, type, defaultValue: defaultValue || undefined });
    decorators = [];
  }
  return items;
}

function coerce(value: string, type: string | undefined): string | number | boolean {
  if (type === "boolean") return /^(1|true|yes|on)$/i.test(value);
  if (type === "number") {
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  return value;
}

/** Builds a varlock `json-full` env blob (format v1) for the bundled web server. */
export function buildVarlockEnvBlob(schemaPath: string, env: Record<string, string | undefined>): string {
  let items: SchemaItem[];
  try {
    items = parseEnvSchema(readFileSync(schemaPath, "utf8"));
  } catch {
    // Schema missing: expose the values we know about, all treated as sensitive.
    items = Object.keys(env).map((key) => ({ key, sensitive: true }));
  }
  const config: Record<string, { value?: string | number | boolean; isSensitive: boolean }> = {};
  for (const item of items) {
    const raw = env[item.key] ?? item.defaultValue;
    config[item.key] = {
      value: raw === undefined || raw === "" ? undefined : coerce(raw, item.type),
      isSensitive: item.sensitive,
    };
  }
  return JSON.stringify({
    blobFormatVersion: 1,
    basePath: "",
    sources: [],
    config,
    // Same defaults `varlock load` emits for this schema.
    settings: {
      redact: { console: true },
      redactLogs: true,
      preventLeaks: true,
      encryptInjectedEnv: false,
      disableProcessEnvInjection: false,
      injectUndefinedAsEmpty: false,
      proxyEgress: "permissive",
    },
    overrideKeys: [],
  });
}
