import { expect, test } from "bun:test";
import { createCatalog, createBlankSlide, type CatalogSlide } from "@Kavero/catalog-engine";
import { buildTimeline, elementStateAt, frameAt, scheduleSlide, slideDurationMs, transitionStyles } from "./index";

const anim = (over: Record<string, unknown>) => ({ id: Math.random().toString(), category: "entrance", preset: "fade", trigger: "on-enter", startMs: 0, durationMs: 1000, delayMs: 0, easing: "linear", ...over }) as never;

function slideWith(anims: unknown[][]): CatalogSlide {
  const s = createBlankSlide();
  anims.forEach((a, i) => s.elements.push({
    id: `e${i}`, type: "shape", zIndex: i, locked: false, hidden: false, opacity: 1,
    position: { x: 0, y: 0, width: 10, height: 10, rotation: 0 }, content: { shape: "rect" },
    style: { fill: "#000", strokeWidth: 0, borderRadius: 0 }, animations: a as never, effects: [],
  }));
  return s;
}

test("triggers resolve to absolute times", () => {
  const s = slideWith([[anim({})], [anim({ trigger: "after-previous", delayMs: 200 })], [anim({ trigger: "with-previous" })]]);
  const sched = scheduleSlide(s);
  expect(sched.map((x) => x.startMs)).toEqual([0, 1200, 1200]);
  expect(slideDurationMs(s)).toBe(4000);
});

test("entrance fade interpolates and holds", () => {
  const s = slideWith([[anim({ startMs: 500 })]]);
  const sched = scheduleSlide(s);
  expect(elementStateAt(sched, "e0", 0).opacity).toBe(0);
  expect(elementStateAt(sched, "e0", 1000).opacity).toBeCloseTo(0.5);
  expect(elementStateAt(sched, "e0", 3000).opacity).toBe(1);
});

test("exit hides after finishing", () => {
  const sched = scheduleSlide(slideWith([[anim({ category: "exit", preset: "scale" })]]));
  expect(elementStateAt(sched, "e0", 0).opacity).toBe(1);
  expect(elementStateAt(sched, "e0", 1000).opacity).toBe(0);
});

test("timeline and transitions", () => {
  const doc = createCatalog({ title: "T" });
  doc.slides.push({ ...createBlankSlide(), transition: { type: "push", durationMs: 1000, delayMs: 0, easing: "linear" } });
  const tl = buildTimeline(doc);
  expect(tl.totalMs).toBe(8000);
  const f = frameAt(tl, 4500);
  expect(f.current.slideIndex).toBe(1);
  expect(f.previous?.slideIndex).toBe(0);
  expect(f.transition?.progress).toBeCloseTo(0.5);
  expect(frameAt(tl, 5500).transition).toBeUndefined();
  expect(transitionStyles("push", 0.5, "left").incoming.transform).toBe("translateX(50.000%)");
});
