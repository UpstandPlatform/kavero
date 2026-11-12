import { expect, test } from "bun:test";

import { createCatalog } from "./document";
import { normalizePath, parseSvgPath, pathBounds, pathLength, pathToSvgD, svgPathToAnchors, mirrorHandle, denormalizePath } from "./path";
import { catalogElementSchema, elementAnimationSchema, pathElementSchema } from "./schema";
import { checkExportCompatibility, parseCatalogDocument } from "./validation";

const base = { id: "p1", position: { x: 0, y: 0, width: 200, height: 100, rotation: 0 } };

test("path elements validate with sensible defaults", () => {
  const el = pathElementSchema.parse({ ...base, type: "path", content: { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } });
  expect(el.style).toEqual({ stroke: "token:text", strokeWidth: 4, lineCap: "round", lineJoin: "round", dash: [] });
  expect(el.content.closed).toBe(false);
  expect(el.animations).toEqual([]);
});

test("path elements reject bad geometry and styles", () => {
  const bad = (content: unknown, style: unknown = {}) => catalogElementSchema.safeParse({ ...base, type: "path", content, style }).success;
  expect(bad({ points: [{ x: 0, y: 0 }] })).toBe(false); // needs two points
  expect(bad({ points: [{ x: 0, y: Number.NaN }, { x: 1, y: 1 }] })).toBe(false);
  expect(bad({ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, { strokeWidth: -1 })).toBe(false);
  expect(bad({ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, { lineCap: "pointy" })).toBe(false);
  expect(bad({ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, { dash: [1, 2, 3, 4, 5, 6, 7, 8, 9] })).toBe(false);
  expect(bad({ d: "not a path" })).toBe(false);
  expect(bad({ points: [{ x: 0, y: 0, kind: "smooth", in: { x: -0.1, y: 0 }, out: { x: 0.1, y: 0 } }, { x: 1, y: 1 }] }, { fill: "token:accent", dash: [8, 4] })).toBe(true);
});

test("catalogs with paths and path animations round-trip through validation", () => {
  const doc = createCatalog({ title: "Paths" });
  doc.slides[0]!.elements.push(pathElementSchema.parse({
    ...base, type: "path", content: { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
    animations: [
      { id: "a1", category: "entrance", preset: "draw", easing: "ease-in", reverse: true, fillAfterDraw: true },
      { id: "a2", category: "keyframes", preset: "custom", loop: true, playDirection: "alternate", keyframes: [{ offset: 0, drawProgress: 0 }, { offset: 1, drawProgress: 1, easing: "ease-in-out" }] },
    ],
  }));
  const parsed = parseCatalogDocument(JSON.parse(JSON.stringify(doc)));
  expect(parsed.ok).toBe(true);
  expect(checkExportCompatibility(doc, "pptx").some((issue) => issue.message.includes("PowerPoint"))).toBe(true);
});

test("animation schema validates keyframes and repeat options", () => {
  const ok = (value: Record<string, unknown>) => elementAnimationSchema.safeParse({ id: "a", category: "keyframes", preset: "custom", ...value }).success;
  expect(ok({ keyframes: [{ offset: 0.5, x: 10 }] })).toBe(true);
  expect(ok({ keyframes: [{ offset: 1.5 }] })).toBe(false);
  expect(ok({ keyframes: [{ offset: 0, drawProgress: 2 }] })).toBe(false);
  expect(ok({ iterations: 0 })).toBe(false);
  expect(ok({ playDirection: "sideways" })).toBe(false);
  expect(elementAnimationSchema.parse({ id: "a", category: "keyframes", preset: "custom", keyframes: [{ offset: 0 }] }).keyframes![0]!.easing).toBe("linear");
});

test("path length is measured in pixels for the element size", () => {
  const line = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  expect(pathLength(line, false, 300, 400)).toBeCloseTo(500);
  const square = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  expect(pathLength(square, true, 100, 100)).toBeCloseTo(400);
  expect(pathLength(square, false, 100, 100)).toBeCloseTo(300);
  // A quarter circle drawn with the standard cubic approximation (k ≈ 0.5523).
  const k = 0.5523;
  const arc = [{ x: 0, y: 0, out: { x: k, y: 0 } }, { x: 1, y: 1, in: { x: 0, y: -k } }];
  expect(pathLength(arc, false, 100, 100)).toBeCloseTo((Math.PI / 2) * 100, 0);
});

test("svg path data output uses lines for straight segments and curves otherwise", () => {
  expect(pathToSvgD([{ x: 0, y: 0 }, { x: 1, y: 0.5 }], true, 200, 100)).toBe("M0 0 L200 50 L0 0 Z");
  expect(pathToSvgD([{ x: 0, y: 0, out: { x: 0.5, y: 0 } }, { x: 1, y: 1 }], false, 10, 10)).toBe("M0 0 C5 0 10 10 10 10");
});

test("normalizing a drawn path fits it to its own box", () => {
  const drawn = [{ x: 100, y: 200 }, { x: 300, y: 250, in: { x: -50, y: 0 } }];
  const { box, points } = normalizePath(drawn, false);
  expect(box).toEqual({ x: 100, y: 200, width: 200, height: 50 });
  expect(points).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1, in: { x: -0.25, y: 0 } }]);
  expect(denormalizePath(points, box.width, box.height)[1]).toEqual({ x: 200, y: 50, in: { x: -50, y: 0 } });
  // Horizontal lines get a 1px tall box instead of dividing by zero.
  expect(normalizePath([{ x: 0, y: 5 }, { x: 10, y: 5 }], false).box.height).toBe(1);
  // Curves bulging out of their anchors are included in the bounds.
  const bulge = pathBounds([{ x: 0, y: 0, out: { x: 0, y: -1 } }, { x: 1, y: 0, in: { x: 0, y: -1 } }], false);
  expect(bulge.y).toBeCloseTo(-0.75);
});

test("svg path import handles relative, shorthand and quadratic commands", () => {
  const parsed = parseSvgPath("m10 10 h80 v80 q -40 20 -80 0 z");
  expect(parsed.closed).toBe(true);
  expect(parsed.points.map(({ x, y }) => [x, y])).toEqual([[10, 10], [90, 10], [90, 90], [10, 90]]);
  expect(parsed.points[3]!.in).toBeDefined();
  const s = parseSvgPath("M0 0 C10 0 20 10 20 20 S30 40 40 40");
  expect(s.points).toHaveLength(3);
  expect(s.points[1]!.out).toEqual({ x: 0, y: 10 }); // reflected control point
  expect(() => parseSvgPath("L10 10")).toThrow();
  const fitted = svgPathToAnchors("M50 50 L150 100");
  expect(fitted.points).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
});

test("mirrored handles stay on one line", () => {
  expect(mirrorHandle({ x: 3, y: 4 }, undefined)).toEqual({ x: -3, y: -4 });
  const kept = mirrorHandle({ x: 3, y: 4 }, { x: -10, y: 0 });
  expect(Math.hypot(kept.x, kept.y)).toBeCloseTo(10);
  expect(kept.x / kept.y).toBeCloseTo(0.75);
  expect(mirrorHandle({ x: 3, y: 4 }, { x: -10, y: 0 }, false)).toEqual({ x: -3, y: -4 });
});
