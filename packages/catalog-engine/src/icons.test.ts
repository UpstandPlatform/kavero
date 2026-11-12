import { expect, test } from "bun:test";

import { buildIconIndex, catalogElementSchema, createIconElementInput, iconSvgMarkup, kebabIconName, searchIcons } from "./index";

const alarm = [["circle", { cx: "12", cy: "13", r: "8" }], ["path", { d: "M12 9v4l2 2", key: "abc" }]] as const;
const icons = {
  AlarmClock: alarm,
  AlarmClockAlias: alarm,
  Clock: [["circle", { cx: "12", cy: "12", r: "10" }]],
  ArrowUp: [["path", { d: "m5 12 7-7 7 7" }]],
  Grid2x2: [["rect", { x: "3", y: "3", width: "18", height: "18", rx: "2" }]],
  Evil: [["script", { src: "x" }], ["path", { onload: "alert(1)" }]],
} as const;

test("icon index groups aliases, normalises names and drops unsafe shapes", () => {
  const index = buildIconIndex(icons as never);
  expect(index.map((entry) => entry.name)).toEqual(["alarm-clock", "arrow-up", "clock", "grid-2x2"]);
  expect(index[0]!.aliases).toEqual(["alarm-clock-alias"]);
  expect(index[0]!.nodes[1]).toEqual(["path", { d: "M12 9v4l2 2" }]);
  expect(kebabIconName("AlarmClockCheck")).toBe("alarm-clock-check");
});

test("icon search ranks exact and prefix matches first and requires every word", () => {
  const index = buildIconIndex(icons as never);
  expect(searchIcons(index, "clock").map((entry) => entry.name)).toEqual(["clock", "alarm-clock"]);
  expect(searchIcons(index, "alarm clock")[0]!.name).toBe("alarm-clock");
  expect(searchIcons(index, "alias").map((entry) => entry.name)).toEqual(["alarm-clock"]);
  expect(searchIcons(index, "arrow down")).toEqual([]);
  expect(searchIcons(index, "  ").length).toBe(index.length);
});

test("inserted icons are valid catalog elements that render to standalone SVG", () => {
  const [entry] = buildIconIndex(icons as never);
  const input = createIconElementInput(entry!, { slideWidth: 1000, slideHeight: 500, size: 120, color: "token:primary", strokeWidth: 1.5 });
  expect(input.position).toEqual({ x: 440, y: 190, width: 120, height: 120, rotation: 0 });
  const element = catalogElementSchema.parse({ ...input, id: "el_icon" });
  expect(element).toMatchObject({ type: "icon", content: { name: "alarm-clock", library: "lucide" }, style: { color: "token:primary", strokeWidth: 1.5 } });
  expect(catalogElementSchema.safeParse({ ...input, id: "el_bad", content: { ...input.content, nodes: [["path", { d: "M0 0\"/><script>" }]] } }).success).toBe(false);
  const svg = iconSvgMarkup(input.content.nodes, { color: "#ff0000" });
  expect(svg).toContain('stroke="#ff0000"');
  expect(svg).toContain('<circle cx="12" cy="13" r="8"/>');
});
