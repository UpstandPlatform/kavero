import { IDENTITY, revealDash, traceDash, type VisualState } from "@Kavero/animation-engine";
import { pathLength, pathToSvgD, type PathElement } from "@Kavero/catalog-engine";
import { useId, useMemo } from "react";

const EPSILON = 0.0005;

const noFill = (fill: string | undefined) => !fill || fill === "none" || fill === "transparent";

/**
 * A pen-tool path as SVG, drawn in the element's pixel box so stroke widths and
 * dashes keep their size when the element is resized. `state` carries the
 * draw/erase/trace progress from the animation engine.
 */
export function PathShape({ element, state = IDENTITY, color }: { element: PathElement; state?: VisualState; color: (value: string) => string }) {
  const { width, height } = element.position;
  const w = Math.max(width, 1), h = Math.max(height, 1);
  const { points, closed } = element.content;
  const s = element.style;
  const d = useMemo(() => pathToSvgD(points, closed, w, h), [points, closed, w, h]);
  const length = useMemo(() => pathLength(points, closed, w, h), [points, closed, w, h]);
  const maskId = `kv-path-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const stroke = s.strokeWidth > 0 && !noFill(s.stroke) ? color(s.stroke) : undefined;
  const fill = noFill(s.fill) ? undefined : color(s.fill!);
  const draw = state.draw;
  const partial = draw < 1 - EPSILON;
  const dash = s.dash.length && s.dash.some((v) => v > 0) ? s.dash.join(" ") : undefined;
  const strokeProps = {
    fill: "none", stroke, strokeWidth: s.strokeWidth, strokeLinecap: s.lineCap, strokeLinejoin: s.lineJoin, strokeMiterlimit: 10,
  } as const;
  const tracing = state.trace !== null && stroke;
  // A reveal over a dashed stroke goes through a mask so both dash patterns apply.
  const masked = partial && !!dash;
  const pad = s.strokeWidth * 2 + 8;
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: "block", overflow: "visible" }} aria-hidden>
      {masked && (
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" x={-pad} y={-pad} width={w + pad * 2} height={h + pad * 2}>
            <path d={d} fill="none" stroke="#fff" strokeWidth={s.strokeWidth + 2} strokeLinecap={s.lineCap} strokeLinejoin={s.lineJoin} {...revealDash(length, draw, state.drawAnchor)} />
          </mask>
        </defs>
      )}
      {fill && state.fill > EPSILON && <path d={d} fill={fill} fillOpacity={state.fill < 1 ? state.fill : undefined} stroke="none" />}
      {stroke && draw > EPSILON && (
        <path
          d={d}
          {...strokeProps}
          strokeOpacity={tracing ? 0.3 : undefined}
          strokeDasharray={masked ? dash : partial ? revealDash(length, draw, state.drawAnchor).strokeDasharray : dash}
          strokeDashoffset={!masked && partial ? revealDash(length, draw, state.drawAnchor).strokeDashoffset : undefined}
          mask={masked ? `url(#${maskId})` : undefined}
        />
      )}
      {tracing && draw > EPSILON && <path d={d} {...strokeProps} {...traceDash(length, state.trace!, s.strokeWidth)} />}
    </svg>
  );
}
