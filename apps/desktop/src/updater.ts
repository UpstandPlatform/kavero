import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { app, BrowserWindow, dialog, ipcMain, type WebContents } from "electron";
import electronUpdater, { type UpdateInfo } from "electron-updater";

/**
 * In-app updates from GitHub Releases (UpstandPlatform/Kavero): the release
 * workflow uploads the installer plus latest.yml, which electron-updater reads.
 *
 * - Checks shortly after launch and every 4 hours; nothing downloads by itself.
 * - The web app shows a banner (via the preload bridge): Download → Restart to update.
 * - Help → Check for Updates… runs a check with native dialogs.
 * Windows (NSIS) and Linux AppImage update in place; elsewhere the banner links to the release page.
 */
const { autoUpdater } = electronUpdater;
export const REPO = { owner: "UpstandPlatform", repo: "Kavero" };
const RELEASES = `https://github.com/${REPO.owner}/${REPO.repo}/releases`;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

export type UpdateStatus =
  | { state: "idle" | "checking" | "not-available" }
  | { state: "available"; version: string; notes?: string; releaseUrl: string }
  | { state: "downloading"; version: string; percent: number; releaseUrl: string }
  | { state: "downloaded"; version: string; releaseUrl: string }
  | { state: "error"; message: string; releaseUrl?: string };

let status: UpdateStatus = { state: "idle" };
let started = false;
let manual = false;
let available: UpdateInfo | null = null;

const releaseUrl = (version: string) => `${RELEASES}/tag/v${version}`;
const notesText = (info: UpdateInfo) =>
  typeof info.releaseNotes === "string" ? info.releaseNotes.replace(/<[^>]+>/g, "").trim().slice(0, 2000) : undefined;

/** Updates only work from installed builds that support it (or when forced for testing). */
export function canUpdate(): boolean {
  if (process.env["KAVERO_UPDATE_DEV"] === "1") return true;
  if (!app.isPackaged) return false;
  if (process.platform === "linux") return !!process.env["APPIMAGE"];
  return true;
}

function broadcast(next: UpdateStatus) {
  status = next;
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send("kavero:update-status", status);
}

/** Only the app's own pages may drive the updater. */
function fromApp(sender: WebContents, isAppUrl: (url: string) => boolean) {
  return isAppUrl(sender.getURL());
}

export function setupUpdater(opts: { isAppUrl: (url: string) => boolean; log: (...args: unknown[]) => void }) {
  ipcMain.handle("kavero:update-status", (e) => (fromApp(e.sender, opts.isAppUrl) ? status : { state: "idle" }));
  ipcMain.handle("kavero:update-check", async (e) => {
    // From the app menu: show "up to date" / errors too.
    if (fromApp(e.sender, opts.isAppUrl)) await checkForUpdates(true);
  });
  ipcMain.handle("kavero:update-download", async (e) => {
    if (!fromApp(e.sender, opts.isAppUrl) || !available) return;
    if (process.platform === "darwin" && !process.env["KAVERO_UPDATE_DEV"]) {
      // Unsigned macOS builds can't update in place: open the release page instead.
      const { shell } = await import("electron");
      await shell.openExternal(releaseUrl(available.version));
      return;
    }
    await autoUpdater.downloadUpdate().catch((err: Error) => broadcast({ state: "error", message: err.message, releaseUrl: releaseUrl(available!.version) }));
  });
  ipcMain.handle("kavero:update-install", (e) => {
    if (fromApp(e.sender, opts.isAppUrl) && status.state === "downloaded") setImmediate(() => autoUpdater.quitAndInstall(false, true));
  });

  if (!canUpdate()) return;
  started = true;

  // First (setting updateConfigPath resets the feed). Installers ship resources/app-update.yml (the Windows updater reads it before installing).
  // Unpacked and dev builds don't: write the same feed description to the data folder.
  if (!existsSync(join(process.resourcesPath, "app-update.yml"))) {
    const file = join(app.getPath("userData"), "app-update.yml");
    writeFileSync(file, `provider: github\nowner: ${REPO.owner}\nrepo: ${REPO.repo}\nupdaterCacheDirName: kavero-updater\n`);
    autoUpdater.updateConfigPath = file;
  }
  // KAVERO_UPDATE_TOKEN: a read-only GitHub token, only for testing updates while the
  // repository is private. Public releases need no token; never ship one in a build.
  const token = process.env["KAVERO_UPDATE_TOKEN"];
  autoUpdater.setFeedURL({ provider: "github", owner: REPO.owner, repo: REPO.repo, releaseType: "release", ...(token ? { private: true, token } : {}) });
  autoUpdater.forceDevUpdateConfig = process.env["KAVERO_UPDATE_DEV"] === "1";
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = /-/.test(app.getVersion());
  autoUpdater.logger = { info: (m: unknown) => opts.log("[update]", m), warn: (m: unknown) => opts.log("[update]", m), error: (m: unknown) => opts.log("[update] error", m), debug: () => undefined };

  autoUpdater.on("checking-for-update", () => broadcast({ state: "checking" }));
  autoUpdater.on("update-not-available", () => {
    broadcast({ state: "not-available" });
    if (manual) void dialog.showMessageBox({ type: "info", title: "Kavero", message: "You're up to date", detail: `Kavero ${app.getVersion()} is the latest version.` });
  });
  autoUpdater.on("update-available", (info) => {
    available = info;
    broadcast({ state: "available", version: info.version, notes: notesText(info), releaseUrl: releaseUrl(info.version) });
    if (manual) void promptDownload(info);
  });
  autoUpdater.on("download-progress", (p) => {
    if (available) broadcast({ state: "downloading", version: available.version, percent: Math.round(p.percent), releaseUrl: releaseUrl(available.version) });
  });
  autoUpdater.on("update-downloaded", (info) => {
    broadcast({ state: "downloaded", version: info.version, releaseUrl: releaseUrl(info.version) });
    if (manual) void promptRestart(info.version);
  });
  autoUpdater.on("error", (err) => {
    opts.log("[update] failed:", err.message);
    const message = /\b404\b/.test(err.message)
      ? "No published releases were found (the repository may be private)."
      : /ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|net::/i.test(err.message)
        ? "Couldn't reach GitHub. Check your internet connection."
        : "Couldn't check for updates.";
    broadcast({ state: "error", message, releaseUrl: RELEASES });
    if (manual) void dialog.showMessageBox({ type: "warning", title: "Kavero", message: "Couldn't check for updates", detail: `${message}\n\n${RELEASES}` });
  });

  setTimeout(() => void checkForUpdates(false), 15_000).unref();
  setInterval(() => void checkForUpdates(false), CHECK_EVERY_MS).unref();
}

export async function checkForUpdates(interactive: boolean) {
  if (!started) {
    if (interactive) {
      await dialog.showMessageBox({
        type: "info",
        title: "Kavero",
        message: "Updates aren't available in this build",
        detail: app.isPackaged ? `Download the latest version from ${RELEASES}` : "This is a development build.",
      });
    }
    return;
  }
  manual = interactive;
  try {
    if (status.state === "downloaded" && interactive) return void promptRestart(status.version);
    await autoUpdater.checkForUpdates();
  } catch {
    // reported through the "error" event
  } finally {
    // Events for this check fire before checkForUpdates resolves.
    setTimeout(() => (manual = false), 1000);
  }
}

async function promptDownload(info: UpdateInfo) {
  const { response } = await dialog.showMessageBox({
    type: "info",
    title: "Kavero",
    message: `Kavero ${info.version} is available`,
    detail: `You have ${app.getVersion()}. Download it now? You can keep working while it downloads.`,
    buttons: ["Download", "Later"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) await autoUpdater.downloadUpdate();
}

async function promptRestart(version: string) {
  const { response } = await dialog.showMessageBox({
    type: "info",
    title: "Kavero",
    message: `Kavero ${version} is ready`,
    detail: "Restart now to finish updating. Your work is saved.",
    buttons: ["Restart now", "Later"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) autoUpdater.quitAndInstall(false, true);
}
