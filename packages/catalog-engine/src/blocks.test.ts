import { expect, test } from "bun:test";

import { catalogSlideSchema, createBlockSlide, PRESENTATION_BLOCKS } from "./index";

test("built-in presentation blocks create schema-valid slides with unique element ids", () => {
  for (const block of PRESENTATION_BLOCKS) {
    const slide = createBlockSlide(block.id, block.name, 1920, 1080);

    expect(catalogSlideSchema.safeParse(slide).success).toBe(true);
    expect(slide.elements.length).toBeGreaterThan(0);

    const ids = [slide.id, ...slide.elements.map((element) => element.id)];
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  }
});
