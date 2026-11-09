import { existsSync } from "node:fs";
import { join } from "node:path";

/** Common Chrome / Edge / Chromium install locations, per OS (mirrors packages/export-chromium). */
function candidates(): string[] {
  switch (process.platform) {
    case "win32": {
      const roots = [process.env["PROGRAMFILES"], process.env["PROGRAMFILES(X86)"], process.env["LOCALAPPDATA"]]
        .concat(["C:/Program Files", "C:/Program Files (x86)"])
        .filter((p): p is string => !!p);
      const rel = [
        "Google/Chrome/Application/chrome.exe",
        "Microsoft/Edge/Application/msedge.exe",
        "Chromium/Application/chrome.exe",
      ];
      return roots.flatMap((root) => rel.map((r) => join(root, r)));
    }
    case "darwin": {
      const apps = [
        "Google Chrome.app/Contents/MacOS/Google Chrome",
        "Chromium.app/Contents/MacOS/Chromium",
        "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      ];
      const roots = ["/Applications", join(process.env["HOME"] ?? "", "Applications")];
      return roots.flatMap((root) => apps.map((a) => join(root, a)));
    }
    default:
      return [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/snap/bin/chromium",
        "/usr/bin/microsoft-edge",
      ];
  }
}

/** Returns a Chrome/Chromium/Edge executable for PDF/video export, or undefined if none is installed. */
export function findChrome(): string | undefined {
  const configured = process.env["KAVERO_CHROME_PATH"];
  if (configured && existsSync(configured)) return configured;
  return candidates().find((p) => existsSync(p));
}
