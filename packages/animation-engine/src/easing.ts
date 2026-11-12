import type { ElementAnimation } from "@Kavero/catalog-engine";

export type Easing = ElementAnimation["easing"];

/** Every easing preset, in the order the editor lists them. */
export const EASINGS: readonly Easing[] = ["linear", "ease-in", "ease-out", "ease-in-out", "spring"];

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

export function ease(easing: Easing, t: number): number {
  t = clamp01(t);
  switch (easing) {
    case "linear": return t;
    case "ease-in": return t * t * t;
    case "ease-out": return 1 - (1 - t) ** 3;
    case "ease-in-out": return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    // Damped spring that settles at 1, with a small overshoot.
    case "spring": return t === 1 ? 1 : 1 - Math.exp(-6 * t) * Math.cos(10 * t);
  }
}
