import { expect, test } from "bun:test";

import { revealDash, traceDash } from "./path-dash";

/** Visible stroke interval [from, to] for a dash pattern "dash gap" with the given offset, clipped to [0, length]. */
function visible(length: number, pattern: { strokeDasharray: string; strokeDashoffset: number }): [number, number] | null {
  const [dash, gap] = pattern.strokeDasharray.split(" ").map(Number) as [number, number];
  const period = dash + gap;
  for (let k = -2; k <= 2; k += 1) {
    const start = -pattern.strokeDashoffset + k * period;
    const from = Math.max(0, start), to = Math.min(length, start + dash);
    if (to > from + 1e-9) return [from, to];
  }
  return null;
}

test("draw reveals the stroke from the start (or end) in proportion to progress", () => {
  const L = 200;
  expect(visible(L, revealDash(L, 0, "start"))).toBeNull();
  const half = visible(L, revealDash(L, 0.5, "start"))!;
  expect(half[0]).toBe(0);
  expect(half[1]).toBeGreaterThan(L * 0.5);
  expect(half[1]).toBeLessThan(L * 0.53);
  expect(visible(L, revealDash(L, 1, "start"))).toEqual([0, L]);
  const fromEnd = visible(L, revealDash(L, 0.25, "end"))!;
  expect(fromEnd[1]).toBe(L);
  expect(fromEnd[0]).toBeGreaterThan(L * 0.72);
});

test("the trace dash travels from before the start to past the end", () => {
  const L = 100;
  expect(visible(L, traceDash(L, 0, 2))).toBeNull();
  const middle = visible(L, traceDash(L, 0.5, 2))!;
  expect(middle[1] - middle[0]).toBeCloseTo(15);
  expect((middle[0] + middle[1]) / 2).toBeCloseTo(50, 0);
  expect(visible(L, traceDash(L, 1, 2))).toBeNull();
});
