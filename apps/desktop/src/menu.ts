import { app, Menu, shell, type MenuItemConstructorOptions } from "electron";

export function buildMenu(opts: { dev: boolean }): Menu {
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

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" } as MenuItemConstructorOptions] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    { label: "View", submenu: view },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "Open Data Folder",
          click: () => void shell.openPath(app.getPath("userData")),
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}
