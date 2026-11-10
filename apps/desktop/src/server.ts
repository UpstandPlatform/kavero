import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { join } from "node:path";

import { findChrome } from "./chrome";
import { getOrCreateAuthSecret, readState, readUserEnv, writeState } from "./config";
import { buildVarlockEnvBlob } from "./varlock-env";

/** Default port for the bundled server. Kept stable across launches because browser
 * storage (IndexedDB, where local catalogs live) is scoped to the origin, port included. */
const DEFAULT_PORT = 41731;


export type BundledServer = {
  url: string;
  child: ChildProcess;
  /** No DATABASE_URL configured: embedded database and one automatic local account. */
  localMode: boolean;
  stop: () => void;
};

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
}

function randomFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function choosePort(userDataDir: string, configured: string | undefined): Promise<number> {
  if (configured) {
    const port = Number(configured);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`Invalid KAVERO_PORT: ${configured}`);
    if (!(await isPortFree(port))) throw new Error(`KAVERO_PORT ${port} is already in use.`);
    return port;
  }
  const state = readState(userDataDir);
  const preferred = state.port ?? DEFAULT_PORT;
  if (await isPortFree(preferred)) {
    if (state.port !== preferred) writeState(userDataDir, { ...state, port: preferred });
    return preferred;
  }
  // Preferred port is taken: use another one for this session only, so the next launch
  // goes back to the usual origin (and its local catalogs).
  console.warn(`[kavero] port ${preferred} is busy; using a temporary port. Local catalogs saved now live under that origin.`);
  return randomFreePort();
}

/** Resolves once anything answers HTTP on the URL (any status), or rejects on timeout / child exit. */
export function waitForHttp(url: string, timeoutMs: number, child?: ChildProcess): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    let exited = false;
    child?.once("exit", (code) => {
      exited = true;
      reject(new Error(`Kavero server exited during startup (code ${code}).`));
    });
    const attempt = () => {
      if (exited) return;
      const req = request(url, { method: "HEAD", timeout: 2000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error(`Kavero server did not start within ${timeoutMs / 1000}s.`));
        else setTimeout(attempt, 250);
      });
      req.end();
    };
    attempt();
  });
}

/**
 * Starts the Next standalone server bundled at `<resources>/web` with Electron's own
 * Node runtime (ELECTRON_RUN_AS_NODE) and waits until it answers.
 */
export async function startBundledServer(opts: { resourcesDir: string; userDataDir: string }): Promise<BundledServer> {
  const webDir = join(opts.resourcesDir, "web", "apps", "web");
  const serverJs = join(webDir, "server.js");
  if (!existsSync(serverJs)) throw new Error(`Bundled web server not found at ${serverJs}`);

  const userEnv = readUserEnv(opts.userDataDir);
  const port = await choosePort(opts.userDataDir, userEnv["KAVERO_PORT"] ?? process.env["KAVERO_PORT"]);
  const url = `http://127.0.0.1:${port}`;
  const localMode = !(userEnv["DATABASE_URL"] ?? process.env["DATABASE_URL"]);

  const storageDir = join(opts.userDataDir, "storage");
  mkdirSync(storageDir, { recursive: true });
  const chrome = userEnv["KAVERO_CHROME_PATH"] ?? findChrome();

  // Precedence: kavero.env > process env > desktop defaults.
  // Local mode: Postgres embedded in the server process (PGlite), stored in the data folder.
  const databaseDir = join(opts.userDataDir, "database");
  const appEnv: Record<string, string | undefined> = {
    DATABASE_URL: `pglite:${databaseDir}`,
    BETTER_AUTH_SECRET: getOrCreateAuthSecret(opts.userDataDir),
    KAVERO_STORAGE_DIR: storageDir,
    KAVERO_CHROME_PATH: chrome,
    ...pickDefined(process.env, ["DATABASE_URL", "BETTER_AUTH_SECRET", "KAVERO_STORAGE_DIR", "KAVERO_CHROME_PATH"]),
    ...userEnv,
    NODE_ENV: "production",
    // Auth must match the origin the window actually loads.
    BETTER_AUTH_URL: url,
    KAVERO_LOCAL_MODE: localMode ? "1" : "0",
    // Keep the database (embedded or configured) on the app's schema after every update.
    KAVERO_AUTO_MIGRATE: "1",
    KAVERO_MIGRATIONS_DIR: join(webDir, "migrations"),
  };
  if ((appEnv["BETTER_AUTH_SECRET"]?.length ?? 0) < 32) {
    throw new Error("BETTER_AUTH_SECRET in kavero.env must be at least 32 characters.");
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...appEnv,
    ELECTRON_RUN_AS_NODE: "1",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    NEXT_TELEMETRY_DISABLED: "1",
    __VARLOCK_ENV: buildVarlockEnvBlob(join(webDir, ".env.schema"), { ...process.env, ...appEnv }),
  };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];

  const logDir = join(opts.userDataDir, "logs");
  mkdirSync(logDir, { recursive: true });
  const log = createWriteStream(join(logDir, "server.log"), { flags: "a" });
  log.write(`\n--- ${new Date().toISOString()} starting ${serverJs} on ${url} (local mode: ${localMode}) ---\n`);

  const child = spawn(process.execPath, [serverJs], {
    cwd: webDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });
  child.on("exit", (code, signal) => log.write(`--- server exited (code ${code}, signal ${signal}) ---\n`));

  const stop = () => {
    if (child.exitCode === null && !child.killed) child.kill();
  };

  try {
    await waitForHttp(url, 60_000, child);
  } catch (error) {
    stop();
    throw error;
  }
  return { url, child, localMode, stop };
}

function pickDefined(source: NodeJS.ProcessEnv, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = source[key];
    if (value) out[key] = value;
  }
  return out;
}
