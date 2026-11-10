/**
 * Renders Kavero's icons and installer artwork from assets/icon.svg with headless
 * Chrome (the same browser the exports use), so every size is pixel-exact.
 *
 *   bun scripts/make-icons.ts
 *
 * Writes (commit the results):
 *   apps/desktop/assets/icon.png                 1024×1024 app icon (macOS/Linux; electron-builder makes .icns)
 *   apps/desktop/assets/icon.ico                 Windows icon, 16–256 px
 *   apps/desktop/assets/installerSidebar.bmp     NSIS welcome/finish pages (164×314)
 *   apps/desktop/assets/uninstallerSidebar.bmp
 *   apps/desktop/assets/installerHeader.bmp      NSIS inner pages (150×57)
 *   apps/web/src/app/favicon.ico, icon.svg, apple-icon.png
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { launchBrowser } from "../../../packages/export-chromium/src/browser";

const desktop = join(import.meta.dir, "..");
const web = join(desktop, "..", "web", "src", "app");
const svg = readFileSync(join(desktop, "assets", "icon.svg"), "utf8");
const svgUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
// Inter (the app's UI font) via the UI package, which depends on @fontsource-variable/inter.
const require = createRequire(join(desktop, "..", "..", "packages", "ui", "package.json"));
const inter = readFileSync(join(require.resolve("@fontsource-variable/inter/package.json"), "..", "files", "inter-latin-wght-normal.woff2")).toString("base64");

const browser = await launchBrowser();
const page = await browser.newPage();

async function render(html: string, width: number, height: number): Promise<Buffer> {
  await page.setViewportSize({ width, height });
  await page.setContent(`<!doctype html><html><head><style>
    @font-face { font-family: Inter; src: url(data:font/woff2;base64,${inter}) format("woff2"); font-weight: 100 900; }
    html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; background: transparent; font-family: Inter, sans-serif; -webkit-font-smoothing: antialiased; }
  </style></head><body>${html}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  return page.screenshot({ type: "png", omitBackground: true });
}

const icon = (size: number) => render(`<img src="${svgUrl}" width="${size}" height="${size}" style="display:block">`, size, size);

/** ICO with PNG-compressed entries (Windows Vista+). */
function ico(pngs: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4); // planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

/** 24-bit BMP (what NSIS needs) from an opaque screenshot. */
async function bmp(png: Buffer, width: number, height: number): Promise<Buffer> {
  // Decode the PNG in the page: draw it on a canvas and read the pixels back.
  const rgba: number[] = await page.evaluate(async ({ src, w, h }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    return Array.from(ctx.getImageData(0, 0, w, h).data);
  }, { src: `data:image/png;base64,${png.toString("base64")}`, w: width, h: height });
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const out = Buffer.alloc(54 + rowSize * height);
  out.write("BM", 0);
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(width, 18);
  out.writeInt32LE(height, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(rowSize * height, 34);
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * rowSize; // bottom-up
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      out[row + x * 3] = rgba[i + 2]!;
      out[row + x * 3 + 1] = rgba[i + 1]!;
      out[row + x * 3 + 2] = rgba[i]!;
    }
  }
  return out;
}

const logo = (size: number, extra = "") =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="display:block;${extra}"><rect x="2" y="6" width="15" height="12" rx="3" fill="#fafafa" fill-opacity=".32"/><rect x="7" y="3" width="15" height="12" rx="3" fill="#fafafa"/><path d="M12 6.5v5M12 9l3.2-2.5M12 9l3.2 2.5" stroke="#171717" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>`;

try {
  // App icons
  const png1024 = await icon(1024);
  writeFileSync(join(desktop, "assets", "icon.png"), png1024);
  const sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
  // One at a time: all renders share one page.
  const entries: { size: number; data: Buffer }[] = [];
  for (const size of sizes) entries.push({ size, data: await icon(size) });
  writeFileSync(join(desktop, "assets", "icon.ico"), ico(entries));

  // NSIS welcome/finish sidebar: dark panel, logo, wordmark.
  const sidebar = await render(`
    <div style="width:164px;height:314px;background:linear-gradient(180deg,#262626,#0a0a0a);color:#fafafa;box-sizing:border-box;padding:28px 18px;display:flex;flex-direction:column">
      ${logo(48)}
      <div style="margin-top:14px;font-size:24px;font-weight:650;letter-spacing:-0.02em">Kavero</div>
      <div style="margin-top:6px;font-size:11.5px;line-height:1.45;color:#a3a3a3">From product data to beautiful experiences.</div>
      <div style="margin-top:auto;font-size:10px;color:#737373">Catalogs · Presentations · Websites</div>
    </div>`, 164, 314);
  const sidebarBmp = await bmp(sidebar, 164, 314);
  writeFileSync(join(desktop, "assets", "installerSidebar.bmp"), sidebarBmp);
  writeFileSync(join(desktop, "assets", "uninstallerSidebar.bmp"), sidebarBmp);

  // NSIS inner-page header (right-aligned logo on white, like Windows dialogs).
  const header = await render(`
    <div style="width:150px;height:57px;background:#ffffff;display:flex;align-items:center;justify-content:flex-end;gap:8px;padding-right:12px;box-sizing:border-box;color:#171717">
      <div style="font-size:16px;font-weight:650;letter-spacing:-0.02em">Kavero</div>
      <div style="background:#171717;border-radius:8px;padding:5px">${logo(26)}</div>
    </div>`, 150, 57);
  writeFileSync(join(desktop, "assets", "installerHeader.bmp"), await bmp(header, 150, 57));

  // Web app favicon set (Next.js picks these up from src/app).
  writeFileSync(join(web, "favicon.ico"), ico(entries.filter((e) => [16, 32, 48].includes(e.size))));
  writeFileSync(join(web, "icon.svg"), svg);
  writeFileSync(join(web, "apple-icon.png"), await icon(180));
  console.log("icons written");
} finally {
  await browser.close();
}
