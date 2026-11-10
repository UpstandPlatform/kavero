// Sandboxed preload: only `electron` (contextBridge/ipcRenderer) is available, no Node APIs.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? "";

type Status = { state: string; [key: string]: unknown };

contextBridge.exposeInMainWorld("kaveroDesktop", {
  version: arg("kavero-version"),
  platform: process.platform,
  /** The app's own local server with one automatic account (no sign-in screens). */
  localMode: arg("kavero-local") === "1",
  updates: {
    status: (): Promise<Status> => ipcRenderer.invoke("kavero:update-status"),
    onStatus: (listener: (status: Status) => void) => {
      const handler = (_e: IpcRendererEvent, status: Status) => listener(status);
      ipcRenderer.on("kavero:update-status", handler);
      return () => void ipcRenderer.removeListener("kavero:update-status", handler);
    },
    check: (): Promise<void> => ipcRenderer.invoke("kavero:update-check"),
    download: (): Promise<void> => ipcRenderer.invoke("kavero:update-download"),
    install: (): Promise<void> => ipcRenderer.invoke("kavero:update-install"),
  },
});
