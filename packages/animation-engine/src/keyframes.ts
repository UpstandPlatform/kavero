import type { ElementAnimation, Keyframe, KeyframeProperty } from "@Kavero/catalog-engine";

import { ease } from "./easing";

/** A time after every animation has finished; looping animations show their resting state here. */
export const SETTLED_MS = 1e9;

/** Resting value of each keyframe property (no change to the element). */
export const KEYFRAME_DEFAULTS: Readonly<Record<KeyframeProperty, number>> = {
  x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, drawProgress: 1,
};

const PROPERTIES = Object.keys(KEYFRAME_DEFAULTS) as KeyframeProperty[];

export type KeyframeValues = Record<KeyframeProperty, number>;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Keyframes in offset order (stable for equal offsets). */
export function sortKeyframes<T extends Pick<Keyframe, "offset">>(keyframes: readonly T[]): T[] {
  return keyframes.map((keyframe, index) => ({ keyframe, index }))
    .sort((a, b) => a.keyframe.offset - b.keyframe.offset || a.index - b.index)
    .map(({ keyframe }) => keyframe);
}

/**
 * Value of every keyframe property at progress p (0..1).
 *
 * Each property is interpolated only between the keyframes that set it, like CSS
 * @keyframes: before the first such keyframe it starts from its resting value at
 * offset 0, after the last one it returns to the resting value at offset 1. The
 * easing of a keyframe applies to the stretch from it to the next keyframe.
 */
export function sampleKeyframes(keyframes: readonly Keyframe[], p: number): KeyframeValues {
  const sorted = sortKeyframes(keyframes);
  const out = { ...KEYFRAME_DEFAULTS };
  for (const property of PROPERTIES) {
    const track = sorted.filter((k) => k[property] !== undefined).map((k) => ({ offset: k.offset, value: k[property]!, easing: k.easing }));
    if (!track.length) continue;
    if (track[0]!.offset > 0) track.unshift({ offset: 0, value: KEYFRAME_DEFAULTS[property], easing: "linear" });
    if (track[track.length - 1]!.offset < 1) track.push({ offset: 1, value: KEYFRAME_DEFAULTS[property], easing: "linear" });
    if (p <= track[0]!.offset) { out[property] = track[0]!.value; continue; }
    if (p >= track[track.length - 1]!.offset) { out[property] = track[track.length - 1]!.value; continue; }
    let i = 0;
    while (i < track.length - 2 && p >= track[i + 1]!.offset) i += 1;
    const from = track[i]!, to = track[i + 1]!;
    const span = to.offset - from.offset;
    const local = span <= 0 ? 1 : (p - from.offset) / span;
    out[property] = lerp(from.value, to.value, ease(from.easing, local));
  }
  return out;
}

export interface IterationState {
  /** Progress inside the current iteration after applying the play direction, 0..1 (before easing). */
  p: number;
  /** Zero-based iteration. */
  iteration: number;
  /** False before the start and after the last iteration. */
  active: boolean;
}

/**
 * Where a repeating animation is at `elapsed` ms after its start. `alternate`
 * plays odd iterations backwards. Looping animations run until `settled`, where
 * they rest at the end of an iteration.
 */
export function iterationAt(elapsed: number, a: Pick<ElementAnimation, "durationMs" | "iterations" | "loop" | "playDirection">, settled = false): IterationState {
  const duration = Math.max(1, a.durationMs);
  const alternate = a.playDirection === "alternate";
  const count = Math.max(1, a.iterations ?? 1);
  if (elapsed <= 0) return { p: 0, iteration: 0, active: false };
  if ((a.loop && settled) || (!a.loop && elapsed >= duration * count)) {
    const iteration = a.loop ? 0 : count - 1;
    return { p: alternate && iteration % 2 === 1 ? 0 : 1, iteration, active: false };
  }
  const iteration = Math.floor(elapsed / duration);
  const local = (elapsed - iteration * duration) / duration;
  return { p: alternate && iteration % 2 === 1 ? 1 - local : local, iteration, active: true };
}

/** How long an animation occupies the timeline (repeats and fill fades included). Loops count one pass. */
export function animationSpanMs(a: Pick<ElementAnimation, "category" | "preset" | "durationMs" | "iterations" | "loop" | "fillAfterDraw">): number {
  if (a.category === "keyframes" || a.category === "emphasis") return a.durationMs * (a.loop ? 1 : Math.max(1, a.iterations ?? 1));
  if ((a.preset === "draw" || a.preset === "erase") && a.fillAfterDraw) return a.durationMs + fillFadeMs(a.durationMs);
  return a.durationMs;
}

/** Duration of the fill fade that follows a draw (or precedes an erase). */
export function fillFadeMs(durationMs: number): number {
  return Math.round(Math.min(600, Math.max(150, durationMs * 0.4)));
}

export interface DrawProgress {
  /** Visible fraction of the stroke, 0..1. */
  draw: number;
  /** Which end the visible part is attached to. */
  anchor: "start" | "end";
  /** Fill opacity multiplier, 0..1. */
  fill: number;
}

/**
 * Stroke reveal of a draw (entrance) or erase (exit) animation at `elapsed` ms.
 * Draw grows the stroke from the path start (or end, when reversed); erase
 * removes it in the same direction, so the line appears to travel off the path.
 */
export function drawProgressAt(elapsed: number, a: Pick<ElementAnimation, "category" | "preset" | "durationMs" | "easing" | "reverse" | "fillAfterDraw">): DrawProgress {
  const erase = a.preset === "erase" || (a.preset === "draw" && a.category === "exit");
  const fade = a.fillAfterDraw ? fillFadeMs(a.durationMs) : 0;
  const duration = Math.max(1, a.durationMs);
  if (!erase) {
    const e = elapsed <= 0 ? 0 : ease(a.easing, elapsed / duration);
    const fill = a.fillAfterDraw ? (elapsed <= duration ? 0 : ease("ease-out", (elapsed - duration) / Math.max(1, fade))) : e;
    return { draw: e, anchor: a.reverse ? "end" : "start", fill };
  }
  const fill = a.fillAfterDraw ? 1 - ease("ease-in", elapsed / Math.max(1, fade)) : 1 - (elapsed <= 0 ? 0 : ease(a.easing, elapsed / duration));
  const strokeElapsed = elapsed - fade;
  const e = strokeElapsed <= 0 ? 0 : ease(a.easing, strokeElapsed / duration);
  return { draw: 1 - e, anchor: a.reverse ? "start" : "end", fill: elapsed <= 0 ? 1 : fill };
}
