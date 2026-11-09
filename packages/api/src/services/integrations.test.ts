import { expect, test } from "bun:test";

import { extractProducts, mapProduct } from "./product-extract";
import { assertPublicUrl, isPrivateAddress } from "./safe-fetch";
import { SecretBox } from "./secret-box";
import { hashPassword, slugify, validateSlug, verifyPassword } from "./publication-service";

test("extracts products from common shapes", () => {
  const shopify = { data: { products: { edges: [{ node: { id: "gid://1", title: "Bag", description: "<p>Leather</p>", priceRange: { minVariantPrice: { amount: "640.00", currencyCode: "eur" } }, featuredImage: { url: "https://cdn.test/bag.jpg" }, productType: "Bags" } }] } } };
  const [p] = extractProducts({ content: [{ type: "text", text: JSON.stringify(shopify) }] });
  expect(p).toMatchObject({ name: "Bag", description: "Leather", price: 640, currency: "EUR", imageUrl: "https://cdn.test/bag.jpg", category: "Bags" });

  const woo = [{ id: 7, name: "Belt", regular_price: "1,200.50", images: [{ src: "https://x.test/b.png" }], sku: "B-1" }];
  expect(extractProducts({ structuredContent: { items: woo } })[0]).toMatchObject({ id: "7", name: "Belt", price: 1200.5, sku: "B-1", imageUrl: "https://x.test/b.png" });
  expect(extractProducts({ content: [{ type: "text", text: "not json" }] })).toEqual([]);
  expect(mapProduct({ foo: 1 })).toBeNull();
});

test("private address detection", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1"]) expect(isPrivateAddress(ip)).toBe(true);
  for (const ip of ["8.8.8.8", "172.32.0.1", "2606:4700::1"]) expect(isPrivateAddress(ip)).toBe(false);
});

test("URL guard: loopback only in dev, metadata never", async () => {
  await expect(assertPublicUrl("http://127.0.0.1:4555/mcp")).rejects.toThrow("private");
  expect((await assertPublicUrl("http://127.0.0.1:4555/mcp", { allowLocal: true })).port).toBe("4555");
  await expect(assertPublicUrl("http://169.254.169.254/latest", { allowLocal: true })).rejects.toThrow("private");
  await expect(assertPublicUrl("http://10.0.0.5/", { allowLocal: true })).rejects.toThrow("private");
  await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow("http");
  await expect(assertPublicUrl("https://user:pw@example.com")).rejects.toThrow("credentials");
});

test("secret box round trip and tamper detection", () => {
  const box = new SecretBox("x".repeat(40));
  const sealed = box.seal("s3cret-token");
  expect(sealed).not.toContain("s3cret");
  expect(box.open(sealed)).toBe("s3cret-token");
  expect(() => box.open(sealed.slice(0, -2) + "AA")).toThrow();
  expect(() => new SecretBox("y".repeat(40)).open(sealed)).toThrow();
});

test("slugs and passwords", async () => {
  expect(validateSlug("summer-2027")).toBeNull();
  expect(validateSlug("admin")).not.toBeNull();
  expect(validateSlug("a")).not.toBeNull();
  expect(slugify("Été Collection 2027!")).toBe("ete-collection-2027");
  const h = await hashPassword("open-sesame");
  expect(await verifyPassword("open-sesame", h)).toBe(true);
  expect(await verifyPassword("nope", h)).toBe(false);
});

test("image dimensions from headers", async () => {
  const { imageSize } = await import("./image-size");
  const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
  expect(imageSize(png)).toEqual({ width: 1, height: 1 });
  const gif = Uint8Array.from(atob("R0lGODlhAwACAIAAAP///wAAACH5BAEAAAAALAAAAAADAAIAAAICjF8AOw=="), (c) => c.charCodeAt(0));
  expect(imageSize(gif)).toEqual({ width: 3, height: 2 });
  // Minimal JPEG: SOI + SOF0 (height 50, width 80)
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x32, 0x00, 0x50, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  expect(imageSize(jpg)).toEqual({ width: 80, height: 50 });
  expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull();
});
