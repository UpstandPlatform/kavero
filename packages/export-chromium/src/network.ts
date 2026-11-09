import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { isPrivateAddress } from "@Kavero/catalog-engine";
import type { Browser, BrowserContextOptions, Page } from "playwright-core";

const FONT_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

async function isPublicHost(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return !isPrivateAddress(host);
  const addresses = await lookup(host, { all: true }).catch(() => []);
  return addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a.address));
}

/**
 * A page for rendering user documents that may only load from the app itself,
 * data:/blob: URLs, Google Fonts and public https hosts. Documents can name
 * arbitrary URLs (video sources, CSS in HTML blocks), so without this headless
 * Chrome on the server could be pointed at internal services.
 * (Chrome resolves hosts again itself, so this narrows rather than fully closes DNS rebinding.)
 */
export async function openRenderPage(browser: Browser, appUrl: string, options: BrowserContextOptions = {}): Promise<Page> {
  const app = new URL(appUrl).origin;
  const page = await browser.newPage(options);
  const verdicts = new Map<string, Promise<boolean>>();
  await page.route("**/*", async (route) => {
    let url: URL;
    try {
      url = new URL(route.request().url());
    } catch {
      return route.abort("blockedbyclient").catch(() => undefined);
    }
    let allowed = url.origin === app || url.protocol === "data:" || url.protocol === "blob:";
    if (!allowed && url.protocol === "https:") {
      if (FONT_HOSTS.has(url.hostname)) allowed = true;
      else {
        let verdict = verdicts.get(url.hostname);
        if (!verdict) verdicts.set(url.hostname, (verdict = isPublicHost(url.hostname)));
        allowed = await verdict;
      }
    }
    // The page may close while a request is pending; nothing to do then.
    await (allowed ? route.continue() : route.abort("blockedbyclient")).catch(() => undefined);
  });
  await page.goto(`${app}/render`, { waitUntil: "networkidle" });
  return page;
}
