import { expect, test } from "bun:test";

import { EXAMPLE_DECKS } from "./examples";
import { parseCatalogDocument } from "./validation";

test("there are four example decks with unique keys", () => {
  expect(EXAMPLE_DECKS.map((d) => d.key)).toEqual(["kavero", "openrive", "upstand", "dgrunner"]);
});

for (const deck of EXAMPLE_DECKS) {
  test(`${deck.key}: a valid 6-slide deck that fits the page`, () => {
    const doc = deck.build();
    const parsed = parseCatalogDocument(doc);
    expect(parsed.ok).toBe(true);
    expect(doc.slides.map((s) => s.name)).toEqual(["Cover", "Overview", "Features", "How it works", "Quick start", "Closing"]);
    const elements = doc.slides.flatMap((s) => s.elements);
    // Ids are unique across the document.
    expect(new Set(elements.map((e) => e.id)).size).toBe(elements.length);
    // Text and buttons stay inside the page (decorative circles may bleed off the edge).
    for (const el of elements.filter((e) => e.type === "text" || e.type === "button")) {
      const p = el.position;
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x + p.width).toBeLessThanOrEqual(doc.settings.width);
      expect(p.y + p.height).toBeLessThanOrEqual(doc.settings.height);
    }
    // Buttons link to the project over https.
    const buttons = elements.filter((e) => e.type === "button");
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b.type === "button" && b.content.href.startsWith("https://")).toBe(true);
  });

  test(`${deck.key}: the overview morphs from the cover`, () => {
    const [cover, overview] = deck.build().slides;
    expect(overview!.transition?.type).toBe("morph");
    const keys = (els: NonNullable<typeof cover>["elements"]) => new Set(els.map((e) => e.morphKey).filter(Boolean));
    const shared = [...keys(cover!.elements)].filter((k) => keys(overview!.elements).has(k));
    expect(shared).toEqual(expect.arrayContaining(["title", "orb", "kicker"]));
  });
}

test("every build is a fresh document", () => {
  const a = EXAMPLE_DECKS[0]!.build();
  const b = EXAMPLE_DECKS[0]!.build();
  expect(a.id).not.toBe(b.id);
  expect(a.slides[0]!.id).not.toBe(b.slides[0]!.id);
});
