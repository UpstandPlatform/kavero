import { join } from "node:path";

import { app, BrowserWindow, Menu, dialog, nativeTheme, session, shell, type WebContents, type WebPreferences } from "electron";

import { findChrome } from "./chrome";
import { signInLocalAccount } from "./local-account";
import { buildMenu } from "./menu";
import { splashPage, unreachablePage } from "./pages";
import { startBundledServer, waitForHttp, type BundledServer } from "./server";
import { checkForUpdates, setupUpdater } from "./updater";

const isDev = !app.isPackaged;
const isSmoke = process.env["KAVERO_SMOKE"] === "1" || process.argv.includes("--smoke");
const DEV_URL = "http://localhost:3001";

// Keep dev data (and the single-instance lock) apart from an installed Kavero.
if (isDev) app.setPath("userData", join(app.getPath("appData"), "Kavero (dev)"));

let mainWindow: BrowserWindow | null = null;
let server: BundledServer | null = null;
let appUrl = "";
let appOrigin = "";
let splash: BrowserWindow | null = null;
/** kavero:// link received before the app finished starting (e.g. it launched the app). */
let pendingLink: string | null = process.argv.find((a) => a.startsWith("kavero://")) ?? null;
// From the app folder (the asar in installed builds), not __dirname: main.js is bundled.
const ICON = join(app.getAppPath(), "assets", "icon.png");
const themeBackground = () => (nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff");

function log(...args: unknown[]) {
  console.log("[kavero]", ...args);
}

function isAppUrl(url: string): boolean {
  try {
    return new URL(url).origin === appOrigin;
  } catch {
    return false;
  }
}

function openExternally(url: string) {
  try {
    const { protocol } = new URL(url);
    if (protocol === "https:" || protocol === "http:" || protocol === "mailto:") void shell.openExternal(url);
  } catch {
    // ignore malformed URLs
  }
}

const webPreferences: WebPreferences = {
  preload: join(app.getAppPath(), "dist", "preload.js"),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webviewTag: false,
  spellcheck: true,
  additionalArguments: [`--kavero-version=${app.getVersion()}`],
};

/** Navigation/new-window policy, applied to every WebContents the app creates. */
function hardenWebContents(contents: WebContents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) {
      // e.g. a published-site preview opened in a new tab: keep it in-app with the same locked-down prefs.
      return { action: "allow", overrideBrowserWindowOptions: { width: 1280, height: 800, webPreferences } };
    }
    openExternally(url);
    return { action: "deny" };
  });
  const guard = (event: Electron.Event, url: string) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openExternally(url);
  };
  contents.on("will-navigate", guard);
  contents.on("will-redirect", guard);
  contents.on("will-attach-webview", (event) => event.preventDefault());
}

/**
 * kavero://editor/<catalog id> (and kavero://dashboard, kavero://settings) — links that MCP
 * agents hand out in local mode, opened here because this app is the signed-in one.
 */
function deepLinkPath(link: string): string | null {
  try {
    const u = new URL(link);
    if (u.protocol !== "kavero:") return null;
    const parts = [u.hostname, ...u.pathname.split("/")].filter(Boolean).map(decodeURIComponent);
    if (parts[0] === "editor" && parts[1] && /^[\w-]{1,100}$/.test(parts[1])) return `/editor/${encodeURIComponent(parts[1])}`;
    if (parts[0] === "dashboard" || parts[0] === "settings" || parts[0] === "admin") return `/${parts[0]}`;
  } catch {
    // ignore malformed links
  }
  return null;
}

function openDeepLink(link: string) {
  const path = deepLinkPath(link);
  if (!path) return;
  if (!mainWindow || !appUrl) {
    pendingLink = link;
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  void mainWindow.loadURL(new URL(path, appUrl).toString());
}

/** A small branded window while the server starts, so launching shows something at once. */
function showSplash() {
  splash = new BrowserWindow({
    width: 480,
    height: 300,
    frame: false,
    resizable: false,
    movable: true,
    center: true,
    show: false,
    skipTaskbar: false,
    title: "Kavero",
    icon: ICON,
    backgroundColor: themeBackground(),
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
  });
  splash.once("ready-to-show", () => splash?.show());
  splash.on("closed", () => (splash = null));
  void splash.loadURL(splashPage({ version: app.getVersion() }));
}

function closeSplash() {
  if (splash && !splash.isDestroyed()) splash.close();
  splash = null;
}

async function loadApp(win: BrowserWindow) {
  try {
    // Open on the catalogs dashboard; the landing page is for the website.
    await win.loadURL(new URL("/dashboard", appUrl).toString());
  } catch (error) {
    // did-fail-load handles the fallback page; ERR_ABORTED (-3) is a superseded navigation.
    if (!String(error).includes("ERR_ABORTED")) log("load failed:", String(error));
  }
}

let retrying = false;
async function retryUntilReachable(win: BrowserWindow) {
  if (retrying) return;
  retrying = true;
  try {
    for (;;) {
      if (win.isDestroyed()) return;
      try {
        await waitForHttp(appUrl, 2_000);
        break;
      } catch {
        // keep waiting
      }
    }
    if (!win.isDestroyed()) await loadApp(win);
  } finally {
    retrying = false;
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: "Kavero",
    show: false,
    icon: ICON,
    backgroundColor: themeBackground(),
    webPreferences,
  });

  win.once("ready-to-show", () => {
    closeSplash();
    if (!isSmoke) win.show();
  });

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || !isAppUrl(validatedURL)) return;
    log(`could not load ${validatedURL}: ${errorDescription} (${errorCode})`);
    if (isSmoke) {
      console.error(`[kavero] SMOKE FAIL: ${errorDescription} (${errorCode})`);
      exitApp(1);
      return;
    }
    void win.loadURL(unreachablePage({ url: appUrl, detail: `${errorDescription} (${errorCode})`, dev: isDev }));
    void retryUntilReachable(win);
  });

  if (isSmoke) {
    win.webContents.on("did-finish-load", async () => {
      const url = win.webContents.getURL();
      if (!isAppUrl(url)) return;
      const bridge = await win.webContents
        .executeJavaScript("JSON.stringify(window.kaveroDesktop ?? null)")
        .catch(() => "error");
      const nodeLeak = await win.webContents.executeJavaScript("typeof require").catch(() => "error");
      log(`SMOKE OK url=${url} title=${JSON.stringify(win.webContents.getTitle())} kaveroDesktop=${bridge} typeof require=${nodeLeak}`);
      exitApp(0);
    });
  }

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  return win;
}

function stopServer() {
  if (server) {
    server.stop();
    server = null;
  }
}

/** app.exit() skips the quit events, so stop the server child explicitly. */
function exitApp(code: number) {
  stopServer();
  app.exit(code);
}

async function start() {
  Menu.setApplicationMenu(buildMenu({ dev: isDev, checkForUpdates: () => void checkForUpdates(true) }));
  if (!isSmoke) showSplash();

  // Deny permission prompts (camera, geolocation, notifications…) except what the app needs.
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(isAppUrl(contents.getURL()) && (permission === "fullscreen" || permission === "clipboard-sanitized-write"));
  });

  const configuredUrl = process.env["KAVERO_URL"];
  if (configuredUrl || isDev) {
    appUrl = configuredUrl || DEV_URL;
  } else {
    try {
      server = await startBundledServer({ resourcesDir: process.resourcesPath, userDataDir: app.getPath("userData") });
      appUrl = server.url;
      log(`bundled server ready at ${appUrl}${server.localMode ? " (local mode: embedded database, automatic local account)" : ""}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[kavero] could not start the bundled server:", message);
      closeSplash();
      if (isSmoke) exitApp(1);
      else {
        dialog.showErrorBox(
          "Kavero could not start",
          `${message}\n\nDetails are in logs/server.log in:\n${app.getPath("userData")}`,
        );
        app.quit();
      }
      return;
    }
  }
  appOrigin = new URL(appUrl).origin;
  if (isDev) log(`dev mode: loading ${appUrl}; Chrome for exports: ${findChrome() ?? "not found"}`);

  // Local mode: sign in the automatic local account before the first page loads.
  const localMode = !!server?.localMode || process.env["KAVERO_LOCAL_MODE"] === "1";
  if (localMode) {
    webPreferences.additionalArguments = [...(webPreferences.additionalArguments ?? []), "--kavero-local=1"];
    try {
      await signInLocalAccount({ url: appUrl, userDataDir: app.getPath("userData"), session: session.defaultSession });
      log("signed in to the local account");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[kavero] local account:", message);
      if (!isSmoke) dialog.showErrorBox("Kavero couldn't open your local account", `${message}\n\nDetails are in logs/server.log in:\n${app.getPath("userData")}`);
    }
  }

  setupUpdater({ isAppUrl, log });

  mainWindow = createWindow();
  if (isSmoke) {
    setTimeout(() => {
      console.error("[kavero] SMOKE FAIL: timed out");
      exitApp(1);
    }, 90_000).unref();
  }
  await loadApp(mainWindow);
  if (pendingLink) {
    const link = pendingLink;
    pendingLink = null;
    openDeepLink(link);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const link = argv.find((a) => a.startsWith("kavero://"));
    if (link) return openDeepLink(link);
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on("web-contents-created", (_event, contents) => hardenWebContents(contents));

  if (process.platform === "win32") app.setAppUserModelId("app.kavero.desktop");
  // kavero:// links (installed builds only, so a dev build never takes them over).
  if (app.isPackaged) app.setAsDefaultProtocolClient("kavero");
  app.on("open-url", (event, url) => {
    event.preventDefault();
    openDeepLink(url);
  });

  app.whenReady().then(start, (error) => {
    console.error(error);
    exitApp(1);
  });

  app.on("activate", () => {
    // macOS: re-open a window when the dock icon is clicked.
    if (!mainWindow && appUrl && app.isReady()) {
      mainWindow = createWindow();
      void loadApp(mainWindow);
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("will-quit", stopServer);
  process.on("exit", stopServer);
}
