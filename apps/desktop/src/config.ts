import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Name of the optional user config file in `app.getPath("userData")`. */
export const USER_ENV_FILE = "kavero.env";

/**
 * Minimal dotenv parser: `KEY=value` lines, `#` comments, optional `export `,
 * single/double quotes (double quotes support \n escapes). No interpolation.
 */
export function parseDotenv(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!;
    let value = match[2] ?? "";
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\"/g, '"');
    } else {
      // strip trailing inline comment (" # ...")
      const hash = value.search(/\s#/);
      if (hash >= 0) value = value.slice(0, hash).trimEnd();
    }
    out[key] = value;
  }
  return out;
}

/** Reads `<userData>/kavero.env` if present. Empty values are dropped. */
export function readUserEnv(userDataDir: string): Record<string, string> {
  const file = join(userDataDir, USER_ENV_FILE);
  if (!existsSync(file)) return {};
  try {
    const parsed = parseDotenv(readFileSync(file, "utf8"));
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== ""));
  } catch (error) {
    console.error(`[kavero] could not read ${file}:`, error);
    return {};
  }
}

/** Returns a persisted random secret (≥ 32 chars), creating it on first use. */
export function getOrCreateAuthSecret(userDataDir: string): string {
  const file = join(userDataDir, "auth-secret");
  try {
    const existing = readFileSync(file, "utf8").trim();
    if (existing.length >= 32) return existing;
  } catch {
    // not created yet
  }
  const secret = randomBytes(48).toString("base64url");
  mkdirSync(userDataDir, { recursive: true });
  writeFileSync(file, secret, { encoding: "utf8", mode: 0o600 });
  return secret;
}

type DesktopState = { port?: number };

export function readState(userDataDir: string): DesktopState {
  try {
    return JSON.parse(readFileSync(join(userDataDir, "desktop-state.json"), "utf8")) as DesktopState;
  } catch {
    return {};
  }
}

export function writeState(userDataDir: string, state: DesktopState): void {
  try {
    mkdirSync(userDataDir, { recursive: true });
    writeFileSync(join(userDataDir, "desktop-state.json"), JSON.stringify(state, null, 2));
  } catch (error) {
    console.error("[kavero] could not persist desktop state:", error);
  }
}
