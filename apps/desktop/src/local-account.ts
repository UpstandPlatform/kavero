import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { userInfo } from "node:os";
import { join } from "node:path";

import { safeStorage, type Session } from "electron";

/**
 * Desktop local mode has one account, created on first launch and signed in
 * automatically, so the app opens straight to the dashboard: no sign-up or sign-in
 * screens. It's a normal Kavero account on the embedded database (and its first
 * user, so it is the admin), which keeps workspaces, API tokens and the MCP
 * endpoint working exactly as on a server.
 *
 * Its password is random and never shown; it's stored encrypted with the OS
 * (DPAPI on Windows, Keychain on macOS, libsecret on Linux) in the data folder.
 */
const FILE = "local-account.json";
export const LOCAL_EMAIL = "me@kavero.local";

type Stored = { email: string; secret: string; encrypted: boolean };

function readPassword(userDataDir: string): string | null {
  const file = join(userDataDir, FILE);
  if (!existsSync(file)) return null;
  try {
    const s = JSON.parse(readFileSync(file, "utf8")) as Stored;
    return s.encrypted ? safeStorage.decryptString(Buffer.from(s.secret, "base64")) : s.secret;
  } catch {
    return null;
  }
}

function writePassword(userDataDir: string, password: string) {
  const encrypted = safeStorage.isEncryptionAvailable();
  const data: Stored = { email: LOCAL_EMAIL, encrypted, secret: encrypted ? safeStorage.encryptString(password).toString("base64") : password };
  mkdirSync(userDataDir, { recursive: true });
  writeFileSync(join(userDataDir, FILE), JSON.stringify(data, null, 2), { mode: 0o600 });
}

function post(url: string, path: string, body: unknown): Promise<{ status: number; cookies: string[]; body: string }> {
  const target = new URL(path, url);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(target, {
      method: "POST",
      // Better Auth checks the Origin against BETTER_AUTH_URL (the app's own URL).
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload), origin: new URL(url).origin },
      timeout: 30_000,
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, cookies: res.headers["set-cookie"] ?? [], body: text }));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(payload);
  });
}

/** Signs in the local account (creating it on first launch) and puts the session cookie in the app's browser session. */
export async function signInLocalAccount(opts: { url: string; userDataDir: string; session: Session }): Promise<void> {
  let password = readPassword(opts.userDataDir);
  let res = password ? await post(opts.url, "/api/auth/sign-in/email", { email: LOCAL_EMAIL, password, rememberMe: true }) : null;

  if (!res || res.status === 401 || res.status === 400) {
    // First launch (or the password file was lost on a fresh database): create the account.
    password = randomBytes(32).toString("base64url");
    const name = (() => {
      try {
        return userInfo().username || "Me";
      } catch {
        return "Me";
      }
    })();
    res = await post(opts.url, "/api/auth/sign-up/email", { email: LOCAL_EMAIL, password, name, rememberMe: true });
    if (res.status !== 200) {
      throw new Error(`Couldn't create the local account (HTTP ${res.status}). If you reset the data folder's local-account.json, delete the "database" folder too. ${res.body.slice(0, 200)}`);
    }
    writePassword(opts.userDataDir, password);
  } else if (res.status !== 200) {
    throw new Error(`Couldn't sign in to the local account (HTTP ${res.status}): ${res.body.slice(0, 200)}`);
  }

  for (const raw of res.cookies) {
    const [pair, ...attrs] = raw.split(";").map((p) => p.trim());
    const eq = pair!.indexOf("=");
    const name = pair!.slice(0, eq);
    const value = pair!.slice(eq + 1);
    const maxAge = attrs.find((a) => /^max-age=/i.test(a));
    await opts.session.cookies.set({
      url: opts.url,
      name,
      value,
      path: "/",
      httpOnly: attrs.some((a) => /^httponly$/i.test(a)),
      sameSite: "lax",
      expirationDate: maxAge ? Date.now() / 1000 + Number(maxAge.split("=")[1]) : undefined,
    });
  }
}
