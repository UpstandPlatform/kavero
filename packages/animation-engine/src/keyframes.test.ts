import { expect, test } from "bun:test";
import { createBlankSlide, type CatalogSlide, type Keyframe } from "@Kavero/catalog-engine";

import {
  animationSpanMs, drawProgressAt, ease, elementStateAt, fillFadeMs, iterationAt, sampleKeyframes, scheduleSlide,
  SETTLED_MS, slideDurationMs, slideHasLoopingAnimation,
} from "./index";

const anim = (over: Record<string, unknown>) => ({ id: Math.random().toString(), category: "entrance", preset: "draw", trigger: "on-enter", startMs: 0, durationMs: 1000, delayMs: 0, easing: "linear", ...over }) as never;

function pathSlide(animations: unknown[]): CatalogSlide {
  const slide = createBlankSlide();
  slide.elements.push({
    id: "p", type: "path", zIndex: 0, locked: false, hidden: false, opacity: 1,
    position: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
    content: { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], closed: false },
    style: { stroke: "#000", strokeWidth: 4, lineCap: "round", lineJoin: "round", dash: [] },
    animations: animations as never, effects: [],
  });
  return slide;
}

const kf = (offset: number, values: Partial<Keyframe>): Keyframe => ({ offset, easing: "linear", ...values });

test("draw reveals the stroke from the start with the chosen easing", () => {
  const linear = drawProgressAt(250, anim({}));
  expect(linear.draw).toBeCloseTo(0.25);
  expect(linear.anchor).toBe("start");
  const easeIn = drawProgressAt(500, anim({ easing: "ease-in" }));
  expect(easeIn.draw).toBeCloseTo(ease("ease-in", 0.5)); // 0.125: slow start
  expect(easeIn.draw).toBeLessThan(0.5);
  expect(drawProgressAt(-10, anim({})).draw).toBe(0);
  expect(drawProgressAt(5000, anim({})).draw).toBe(1);
});

test("reversed draw grows from the end; erase removes the stroke in drawing order", () => {
  expect(drawProgressAt(500, anim({ reverse: true })).anchor).toBe("end");
  const erase = drawProgressAt(250, anim({ category: "exit", preset: "erase" }));
  expect(erase.draw).toBeCloseTo(0.75);
  expect(erase.anchor).toBe("end");
  expect(drawProgressAt(2000, anim({ category: "exit", preset: "erase" })).draw).toBe(0);
});

test("fill fades in after the stroke finishes", () => {
  const a = anim({ fillAfterDraw: true });
  const fade = fillFadeMs(1000);
  expect(fade).toBe(400);
  expect(animationSpanMs(a)).toBe(1400);
  expect(drawProgressAt(900, a).fill).toBe(0);
  expect(drawProgressAt(1000 + fade / 2, a).fill).toBeGreaterThan(0);
  expect(drawProgressAt(1000 + fade, a).fill).toBe(1);
  // Erase: the fill fades out first, then the stroke goes.
  const e = anim({ category: "exit", preset: "erase", fillAfterDraw: true });
  expect(drawProgressAt(fade, e).fill).toBe(0);
  expect(drawProgressAt(fade, e).draw).toBe(1);
});

test("draw entrance keeps the path hidden before it starts and schedules the fill fade", () => {
  const slide = pathSlide([anim({ startMs: 500, fillAfterDraw: true })]);
  const schedule = scheduleSlide(slide);
  expect(schedule[0]!.endMs).toBe(500 + 1400);
  expect(elementStateAt(schedule, "p", 0).draw).toBe(0);
  expect(elementStateAt(schedule, "p", 1000).draw).toBeCloseTo(0.5);
  expect(elementStateAt(schedule, "p", 3000).draw).toBe(1);
  expect(elementStateAt(schedule, "p", 3000).fill).toBe(1);
});

test("trace runs a dash along the path and loops until the slide ends", () => {
  const slide = pathSlide([anim({ category: "emphasis", preset: "trace", loop: true })]);
  const schedule = scheduleSlide(slide);
  expect(slideHasLoopingAnimation(slide)).toBe(true);
  expect(elementStateAt(schedule, "p", 250).trace).toBeCloseTo(0.25);
  expect(elementStateAt(schedule, "p", 2250).trace).toBeCloseTo(0.25);
  expect(elementStateAt(schedule, "p", SETTLED_MS).trace).toBeNull();
  const reversed = scheduleSlide(pathSlide([anim({ category: "emphasis", preset: "trace", reverse: true })]));
  expect(elementStateAt(reversed, "p", 250).trace).toBeCloseTo(0.75);
});

test("keyframes interpolate each property with the easing of the segment it starts", () => {
  const frames = [kf(0, { x: 0, opacity: 0, easing: "ease-in" }), kf(0.5, { x: 100, opacity: 1 }), kf(1, { x: 0 })];
  const at25 = sampleKeyframes(frames, 0.25);
  expect(at25.x).toBeCloseTo(100 * ease("ease-in", 0.5));
  expect(at25.opacity).toBeCloseTo(ease("ease-in", 0.5));
  const at75 = sampleKeyframes(frames, 0.75);
  expect(at75.x).toBeCloseTo(50); // linear second segment
  expect(at75.opacity).toBe(1); // last opacity keyframe holds... then returns to rest at offset 1
  expect(sampleKeyframes(frames, 1).opacity).toBe(1);
  // Untouched properties stay at rest.
  expect(at25.scale).toBe(1);
  expect(at25.drawProgress).toBe(1);
});

test("keyframe properties missing at the ends start and finish at rest", () => {
  const frames = [kf(0.5, { scale: 2 })];
  expect(sampleKeyframes(frames, 0).scale).toBe(1);
  expect(sampleKeyframes(frames, 0.25).scale).toBeCloseTo(1.5);
  expect(sampleKeyframes(frames, 0.5).scale).toBe(2);
  expect(sampleKeyframes(frames, 1).scale).toBe(1);
  // Unsorted input is handled.
  expect(sampleKeyframes([kf(1, { y: 10 }), kf(0, { y: 0 })], 0.5).y).toBeCloseTo(5);
});

test("iterations and alternate direction", () => {
  const a = { durationMs: 1000, iterations: 3, playDirection: "alternate" as const };
  expect(iterationAt(250, a)).toEqual({ p: 0.25, iteration: 0, active: true });
  expect(iterationAt(1250, a).p).toBeCloseTo(0.75); // second pass runs backwards
  expect(iterationAt(2250, a).p).toBeCloseTo(0.25);
  expect(iterationAt(5000, a)).toEqual({ p: 1, iteration: 2, active: false });
  expect(iterationAt(5000, { durationMs: 1000, iterations: 2, playDirection: "alternate" }).p).toBe(0);
  expect(iterationAt(-5, a).active).toBe(false);
  expect(iterationAt(10_500, { durationMs: 1000, loop: true }).p).toBeCloseTo(0.5);
  expect(iterationAt(10_500, { durationMs: 1000, loop: true }, true).active).toBe(false);
});

test("keyframe animations hold their first frame before starting and repeat with iterations", () => {
  const a = anim({ category: "keyframes", preset: "custom", startMs: 1000, iterations: 2, keyframes: [kf(0, { y: 0, opacity: 0 }), kf(1, { y: -100, opacity: 1, drawProgress: 0.5 })] });
  const slide = pathSlide([a]);
  const schedule = scheduleSlide(slide);
  expect(schedule[0]!.endMs).toBe(3000);
  expect(elementStateAt(schedule, "p", 0).opacity).toBe(0);
  expect(elementStateAt(schedule, "p", 1500).y).toBeCloseTo(-50);
  expect(elementStateAt(schedule, "p", 2500).y).toBeCloseTo(-50); // second iteration restarts
  expect(elementStateAt(schedule, "p", 2500).draw).toBeCloseTo(0.75);
  expect(elementStateAt(schedule, "p", 9000).y).toBe(-100);
  expect(slideDurationMs(slide)).toBe(4500);
});

test("standard presets still work on paths", () => {
  const schedule = scheduleSlide(pathSlide([anim({ preset: "fade" }), anim({ category: "emphasis", preset: "pulse", trigger: "after-previous", iterations: 2 })]));
  expect(elementStateAt(schedule, "p", 500).opacity).toBeCloseTo(0.5);
  expect(elementStateAt(schedule, "p", 500).draw).toBe(1);
  expect(schedule[1]!.endMs).toBe(3000);
  expect(elementStateAt(schedule, "p", 1500).scale).toBeCloseTo(1.12);
  expect(elementStateAt(schedule, "p", 2500).scale).toBeCloseTo(1.12);
});
