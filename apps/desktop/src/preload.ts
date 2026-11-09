// Sandboxed preload: only `electron` (contextBridge/ipcRenderer) is available, no Node APIs.
import { contextBridge } from "electron";

const versionArg = process.argv.find((arg) => arg.startsWith("--kavero-version="));

contextBridge.exposeInMainWorld("kaveroDesktop", {
  version: versionArg ? versionArg.slice("--kavero-version=".length) : "",
  platform: process.platform,
});
