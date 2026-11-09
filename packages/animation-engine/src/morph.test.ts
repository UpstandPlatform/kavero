import { expect, test } from "bun:test";
import { createBlankSlide, type CatalogElement, type CatalogSlide } from "@Kavero/catalog-engine";

import { matchMorph, morphElement, parseColor } from "./morph";

const shape = (id: string, over: Partial<CatalogElement> = {}): CatalogElement => ({
  id, type: "shape", zIndex: 0, locked: false, hidden: false, opacity: 1, animations: [],
  position: { x: 0, y: 0, width: 100, height: 100, rotation: 0 }, content: { shape: "rect" },
  style: { fill: "#000000", strokeWidth: 0, borderRadius: 0 }, ...over,
}) as CatalogElement;

const text = (id: string, t: string, over: Partial<CatalogElement> = {}): CatalogElement => ({
  id, type: "text", zIndex: 0, locked: false, hidden: false, opacity: 1, animations: [],
  position: { x: 0, y: 0, width: 400, height: 80, rotation: 0 }, content: { paragraphs: [[{ text: t }]] },
  style: { fontFamily: "token:body", fontSize: 24, fontWeight: 400, lineHeight: 1.2, letterSpacing: 0, align: "start", color: "#000000", decoration: "none", italic: false, direction: "auto" }, ...over,
}) as CatalogElement;

const slide = (els: CatalogElement[]): CatalogSlide => ({ ...createBlankSlide(), elements: els });
const ids = (pairs: [CatalogElement, CatalogElement][]) => pairs.map(([a, b]) => `${a.id}>${b.id}`);

test("copies match by morphKey in both directions", () => {
  const a = slide([shape("a1"), shape("a2")]);
  const b = slide([shape("b1", { morphKey: "a2" }), shape("b2", { morphKey: "a1" })]);
  expect(ids(matchMorph(a, b)).sort()).toEqual(["a1>b2", "a2>b1"]);
  expect(ids(matchMorph(b, a)).sort()).toEqual(["b1>a2", "b2>a1"]);
});

test("copies of copies still match", () => {
  const a = slide([shape("x", { morphKey: "orig" })]);
  const b = slide([shape("y", { morphKey: "orig" })]);
  expect(ids(matchMorph(a, b))).toEqual(["x>y"]);
});

test("same layer name and same unique content match; ambiguous content doesn't", () => {
  const a = slide([shape("s1", { name: "Hero" }), text("t1", "Summer"), shape("r1"), shape("r2")]);
  const b = slide([shape("s2", { name: "Hero", content: { shape: "ellipse" } as never }), text("t2", "Summer"), shape("r3")]);
  const pairs = ids(matchMorph(a, b));
  expect(pairs).toContain("s1>s2");
  expect(pairs).toContain("t1>t2");
  expect(pairs.some((p) => p.startsWith("r"))).toBe(false); // two rects on one side: not unique
});

test("different types and hidden elements never match", () => {
  const a = slide([shape("a", { name: "X" }), text("h", "Hi", { hidden: true })]);
  const b = slide([text("b", "Hi", { name: "X" })]);
  expect(matchMorph(a, b)).toEqual([]);
});

test("geometry, colors and font size interpolate", () => {
  const a = text("a", "Same", { position: { x: 0, y: 0, width: 100, height: 50, rotation: 350 }, opacity: 0.5 });
  const b = text("b", "Same", { position: { x: 200, y: 100, width: 300, height: 150, rotation: 10 } });
  (a as { style: { fontSize: number; color: string } }).style.color = "#000000";
  (b as { style: { fontSize: number; color: string } }).style = { ...(b as never as { style: object }).style, fontSize: 48, color: "#ffffff" } as never;
  const f = morphElement(a, b, 0.5);
  expect(f.to.position).toEqual({ x: 100, y: 50, width: 200, height: 100, rotation: 360 });
  expect(f.to.opacity).toBe(0.75);
  expect((f.to as { style: { fontSize: number } }).style.fontSize).toBe(36);
  expect((f.to as { style: { color: string } }).style.color).toBe("rgba(128, 128, 128, 1)");
  expect(f.from).toBeUndefined(); // same text: one element, no cross-fade
});

test("different content cross-fades inside the shared box", () => {
  const f = morphElement(text("a", "Old"), text("b", "New"), 0.25);
  expect(f.from?.content).toEqual({ paragraphs: [[{ text: "Old" }]] });
  expect(f.to.content).toEqual({ paragraphs: [[{ text: "New" }]] });
  expect(f.mix).toBe(0.25);
});

test("theme tokens resolve before mixing", () => {
  const a = shape("a", { style: { fill: "token:primary", strokeWidth: 0, borderRadius: 0 } } as never);
  const b = shape("b", { style: { fill: "#ffffff", strokeWidth: 0, borderRadius: 20 } } as never);
  const f = morphElement(a, b, 0.5, (v) => (v === "token:primary" ? "#000000" : v));
  expect((f.to as { style: { fill: string; borderRadius: number } }).style).toMatchObject({ fill: "rgba(128, 128, 128, 1)", borderRadius: 10 });
});

test("color parsing", () => {
  expect(parseColor("#f00")).toEqual([255, 0, 0, 1]);
  expect(parseColor("#00ff0080")?.[3]).toBeCloseTo(0.502, 2);
  expect(parseColor("rgba(1, 2, 3, 0.5)")).toEqual([1, 2, 3, 0.5]);
  expect(parseColor("var(--x)")).toBeNull();
});
