import { expect, test } from "bun:test";
import { createCatalog, type PathElement } from "@Kavero/catalog-engine";

import { Editor } from "./index";

function setup(rotation = 0) {
  const editor = new Editor(createCatalog({ title: "Paths" }), { coalesceMs: 0 });
  const slideId = editor.getState().activeSlideId;
  const [id] = editor.execute({
    type: "element.add", slideId,
    element: {
      type: "path", position: { x: 100, y: 100, width: 200, height: 100, rotation },
      content: { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
    } as never,
  }).createdIds;
  const path = () => editor.getDocument().slides[0]!.elements.find((element) => element.id === id) as PathElement;
  return { editor, id: id!, path };
}

test("path elements get stroke defaults", () => {
  const { path } = setup();
  expect(path().style).toMatchObject({ stroke: "token:text", strokeWidth: 4, lineCap: "round", lineJoin: "round", dash: [] });
  expect(path().style.fill).toBeUndefined();
  expect(path().content.closed).toBe(false);
});

test("inserting a point outside the box refits the element and keeps points in place", () => {
  const { editor, id, path } = setup();
  editor.execute({ type: "path.insertPoint", elementId: id, index: 2, point: { x: 1.5, y: 0 } });
  const p = path();
  // Box grows to the right: 200px wide box * 1.5 = 300px.
  expect(p.position).toMatchObject({ x: 100, y: 100, width: 300, height: 100 });
  expect(p.content.points.map(({ x, y }) => [x, y])).toEqual([[0, 0], [Math.round((2 / 3) * 1e6) / 1e6, 1], [1, 0]]);
  editor.undo();
  expect(path().content.points).toHaveLength(2);
  expect(path().position.width).toBe(200);
});

test("refitting a rotated path keeps its anchors on the slide", () => {
  const { editor, id, path } = setup(90);
  const before = path();
  // Anchor (1,1) of the rotated box sits at the slide position of the box's local bottom-right corner.
  const toSlide = (p: PathElement, x: number, y: number) => {
    const { x: bx, y: by, width: w, height: h, rotation } = p.position;
    const th = (rotation * Math.PI) / 180;
    const lx = x * w - w / 2, ly = y * h - h / 2;
    return { x: bx + w / 2 + lx * Math.cos(th) - ly * Math.sin(th), y: by + h / 2 + lx * Math.sin(th) + ly * Math.cos(th) };
  };
  const anchorBefore = toSlide(before, 0, 0);
  editor.execute({ type: "path.updatePoint", elementId: id, index: 1, changes: { x: 0.5, y: 0.5 } });
  const after = path();
  expect(after.position.width).toBeCloseTo(100);
  expect(after.position.height).toBeCloseTo(50);
  const anchorAfter = toSlide(after, after.content.points[0]!.x, after.content.points[0]!.y);
  expect(anchorAfter.x).toBeCloseTo(anchorBefore.x, 1);
  expect(anchorAfter.y).toBeCloseTo(anchorBefore.y, 1);
});

test("updating handles and deleting points", () => {
  const { editor, id, path } = setup();
  editor.execute({ type: "path.insertPoint", elementId: id, index: 1, point: { x: 0.5, y: 0.2, kind: "smooth", in: { x: -0.1, y: 0 }, out: { x: 0.1, y: 0 } } });
  expect(path().content.points[1]!.kind).toBe("smooth");
  editor.execute({ type: "path.updatePoint", elementId: id, index: 1, changes: { in: undefined, out: undefined, kind: undefined }, refit: false });
  expect(path().content.points[1]).toEqual({ x: 0.5, y: 0.2 });
  editor.execute({ type: "path.deletePoint", elementId: id, index: 1 });
  expect(path().content.points).toHaveLength(2);
  expect(() => editor.execute({ type: "path.deletePoint", elementId: id, index: 0 })).toThrow();
  editor.execute({ type: "path.setPoints", elementId: id, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }], closed: true });
  expect(path().content.closed).toBe(true);
  editor.undo();
  expect(path().content.closed).toBe(false);
});

test("path commands reject other elements and locked paths", () => {
  const { editor, id } = setup();
  const slideId = editor.getState().activeSlideId;
  const [textId] = editor.execute({ type: "element.add", slideId, element: { type: "text", position: { x: 0, y: 0, width: 10, height: 10, rotation: 0 }, content: { paragraphs: [] } } as never }).createdIds;
  expect(() => editor.execute({ type: "path.deletePoint", elementId: textId!, index: 0 })).toThrow("not a path");
  editor.execute({ type: "element.update", elementId: id, changes: { locked: true } });
  expect(() => editor.execute({ type: "path.insertPoint", elementId: id, index: 0, point: { x: 0, y: 0 } })).toThrow("locked");
});

test("SVG path data is converted to anchors", () => {
  const editor = new Editor(createCatalog({ title: "Svg" }), { coalesceMs: 0 });
  const slideId = editor.getState().activeSlideId;
  const [id] = editor.execute({
    type: "element.add", slideId,
    element: { type: "path", position: { x: 0, y: 0, width: 100, height: 100, rotation: 0 }, content: { d: "M10 10 C 40 0, 60 0, 90 10 L 90 90 Z", viewBox: { width: 100, height: 100 } } } as never,
  }).createdIds;
  const element = editor.getDocument().slides[0]!.elements.find((e) => e.id === id) as PathElement;
  expect(element.content.closed).toBe(true);
  expect(element.content.points).toHaveLength(3);
  expect(element.content.points[0]).toMatchObject({ x: 0.1, y: 0.1, out: { x: 0.3, y: -0.1 } });
});

test("keyframe commands keep keyframes sorted, with ids, and are undoable", () => {
  const { editor, id, path } = setup();
  const created = editor.execute({
    type: "element.addAnimation", elementId: id,
    animation: { category: "keyframes", preset: "custom", keyframes: [{ offset: 1, y: -40, easing: "linear" }, { offset: 0, y: 0, easing: "ease-in" }] },
  }).createdIds;
  const animationId = created[0]!;
  const keyframes = () => path().animations[0]!.keyframes!;
  expect(created).toHaveLength(3);
  expect(keyframes().map((k) => k.offset)).toEqual([0, 1]);
  expect(keyframes().every((k) => !!k.id)).toBe(true);

  const [kfId] = editor.execute({ type: "animation.addKeyframe", elementId: id, animationId, keyframe: { offset: 0.5, drawProgress: 0.5 } }).createdIds;
  expect(keyframes().map((k) => k.offset)).toEqual([0, 0.5, 1]);
  expect(keyframes()[1]!.easing).toBe("linear");

  editor.execute({ type: "animation.updateKeyframe", elementId: id, animationId, keyframeId: kfId!, changes: { offset: 0.9, easing: "ease-out", drawProgress: undefined, opacity: 0.4 } });
  expect(keyframes().map((k) => k.offset)).toEqual([0, 0.9, 1]);
  expect(keyframes()[1]).toMatchObject({ id: kfId, easing: "ease-out", opacity: 0.4 });
  expect(keyframes()[1]!.drawProgress).toBeUndefined();
  expect(() => editor.execute({ type: "animation.updateKeyframe", elementId: id, animationId, keyframeId: kfId!, changes: { offset: 2 } })).toThrow();

  editor.execute({ type: "animation.removeKeyframe", elementId: id, animationId, keyframeId: kfId! });
  expect(keyframes()).toHaveLength(2);
  editor.undo();
  expect(keyframes()).toHaveLength(3);
});

test("keyframes are only added to keyframes animations", () => {
  const { editor, id } = setup();
  const [animationId] = editor.execute({ type: "element.addAnimation", elementId: id, animation: { category: "entrance", preset: "draw" } }).createdIds;
  expect(() => editor.execute({ type: "animation.addKeyframe", elementId: id, animationId: animationId!, keyframe: { offset: 0.5 } })).toThrow();
});
