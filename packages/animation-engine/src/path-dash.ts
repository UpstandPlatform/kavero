/**
 * Stroke dash patterns behind the path draw/erase and trace animations. Renderers
 * apply them as SVG stroke-dasharray / stroke-dashoffset on a path whose length
 * was measured with `pathLength` from the catalog engine.
 */

export interface StrokeDash {
  strokeDasharray: string;
  strokeDashoffset: number;
}

/** Dash pattern that reveals `draw` (0..1) of a stroke `length` px long, attached to its start or its end. */
export function revealDash(length: number, draw: number, anchor: "start" | "end"): StrokeDash {
  // A little extra so the measured length (flattened curves) never falls short of the real one.
  const full = length * 1.02 + 2;
  const hidden = full * (1 - Math.max(0, Math.min(1, draw)));
  return { strokeDasharray: `${full} ${full}`, strokeDashoffset: anchor === "start" ? hidden : -hidden };
}

/** Dash pattern of the "trace" highlight at `phase` (0..1): a short dash entering at the start and leaving past the end. */
export function traceDash(length: number, phase: number, strokeWidth: number): StrokeDash {
  const segment = Math.max(length * 0.15, strokeWidth * 2, 4);
  const start = -segment + Math.max(0, Math.min(1, phase)) * (length + segment);
  return { strokeDasharray: `${segment} ${length * 1.02 + segment + 2}`, strokeDashoffset: -start };
}
