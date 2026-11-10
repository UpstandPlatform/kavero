import { app, Menu, shell, type MenuItemConstructorOptions } from "electron";

export function buildMenu(opts: { dev: boolean; checkForUpdates: () => void }): Menu {
  const isMac = process.platform === "darwin";

  const view: MenuItemConstructorOptions[] = [
    ...(opts.dev
      ? ([{ role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" }, { type: "separator" }] as MenuItemConstructorOptions[])
      : []),
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" },
  ];

  const updates: MenuItemConstructorOptions = { label: "Check for Updates…", click: opts.checkForUpdates };
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{ label: app.name, submenu: [{ role: "about" }, updates, { type: "separator" }, { role: "services" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }] } as MenuItemConstructorOptions]
      : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    { label: "View", submenu: view },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        ...(isMac ? [] : [updates, { type: "separator" } as MenuItemConstructorOptions]),
        {
          label: "Open Data Folder",
          click: () => void shell.openPath(app.getPath("userData")),
        },
        {
          label: "Releases and Changelog",
          click: () => void shell.openExternal("https://github.com/UpstandPlatform/Kavero/releases"),
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}
