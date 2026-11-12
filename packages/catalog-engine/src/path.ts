/**
 * Vector path geometry shared by the schema, renderer, exporters and editor.
 *
 * A path is a list of anchors in the element's own box, normalized so (0, 0) is
 * its top-left corner and (1, 1) its bottom-right corner (an SVG viewBox of
 * "0 0 1 1"). Each anchor can carry bezier handles stored as offsets from the
 * anchor in the same units, so moving an anchor carries its handles along and
 * resizing the element scales the drawing with it.
 */

export interface PathVec {
  x: number;
  y: number;
}

export interface PathAnchor extends PathVec {
  /** Incoming handle, relative to the anchor. */
  in?: PathVec;
  /** Outgoing handle, relative to the anchor. */
  out?: PathVec;
  /** "smooth" keeps both handles on one line (mirrored while editing); "corner" lets them move freely. */
  kind?: "corner" | "smooth";
}

/** One cubic bezier segment in absolute coordinates. */
export interface CubicSegment {
  p0: PathVec;
  c1: PathVec;
  c2: PathVec;
  p3: PathVec;
}

const add = (a: PathVec, b: PathVec | undefined): PathVec => (b ? { x: a.x + b.x, y: a.y + b.y } : { x: a.x, y: a.y });

/** Cubic segments between consecutive anchors (and back to the first one when closed). Coordinates are scaled by w × h. */
export function pathSegments(points: readonly PathAnchor[], closed: boolean, w = 1, h = 1): CubicSegment[] {
  const scale = (p: PathVec): PathVec => ({ x: p.x * w, y: p.y * h });
  const segments: CubicSegment[] = [];
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    segments.push({ p0: scale(a), c1: scale(add(a, a.out)), c2: scale(add(b, b.in)), p3: scale(b) });
  }
  return segments;
}

const isStraight = (s: CubicSegment) =>
  s.c1.x === s.p0.x && s.c1.y === s.p0.y && s.c2.x === s.p3.x && s.c2.y === s.p3.y;

const num = (v: number) => (Math.round(v * 1000) / 1000).toString();

/** SVG path data for the anchors inside a w × h box (pixels by default, or 1 × 1 for the normalized space). */
export function pathToSvgD(points: readonly PathAnchor[], closed: boolean, w = 1, h = 1): string {
  if (!points.length) return "";
  const first = points[0]!;
  const parts = [`M${num(first.x * w)} ${num(first.y * h)}`];
  for (const s of pathSegments(points, closed, w, h)) {
    parts.push(isStraight(s)
      ? `L${num(s.p3.x)} ${num(s.p3.y)}`
      : `C${num(s.c1.x)} ${num(s.c1.y)} ${num(s.c2.x)} ${num(s.c2.y)} ${num(s.p3.x)} ${num(s.p3.y)}`);
  }
  if (closed) parts.push("Z");
  return parts.join(" ");
}

/** Point on a cubic segment at parameter t. */
export function cubicPoint(s: CubicSegment, t: number): PathVec {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return {
    x: a * s.p0.x + b * s.c1.x + c * s.c2.x + d * s.p3.x,
    y: a * s.p0.y + b * s.c1.y + c * s.c2.y + d * s.p3.y,
  };
}

/** Arc length of one segment, measured by flattening it into short chords. */
export function segmentLength(s: CubicSegment, samples = 48): number {
  if (isStraight(s)) return Math.hypot(s.p3.x - s.p0.x, s.p3.y - s.p0.y);
  let length = 0;
  let previous = s.p0;
  for (let i = 1; i <= samples; i += 1) {
    const point = cubicPoint(s, i / samples);
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  return length;
}

/** Total stroke length of a path drawn in a w × h box (pixels). Drives the draw/erase/trace animations. */
export function pathLength(points: readonly PathAnchor[], closed: boolean, w = 1, h = 1): number {
  return pathSegments(points, closed, w, h).reduce((sum, segment) => sum + segmentLength(segment), 0);
}

/** Tight bounds of the drawn curve (not of the handles), sampling each segment. */
export function pathBounds(points: readonly PathAnchor[], closed: boolean, w = 1, h = 1): { x: number; y: number; width: number; height: number } {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const include = (p: PathVec) => {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  };
  include({ x: points[0]!.x * w, y: points[0]!.y * h });
  for (const s of pathSegments(points, closed, w, h)) {
    if (isStraight(s)) { include(s.p3); continue; }
    for (let i = 1; i <= 32; i += 1) include(cubicPoint(s, i / 32));
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Fit anchors given in absolute pixels (e.g. drawn with the pen tool) into a box:
 * returns that box and the anchors normalized to it. Degenerate (flat) paths
 * get a 1 px axis so normalization stays finite.
 */
export function normalizePath(points: readonly PathAnchor[], closed: boolean): { box: { x: number; y: number; width: number; height: number }; points: PathAnchor[] } {
  const b = pathBounds(points, closed);
  const width = Math.max(1, b.width);
  const height = Math.max(1, b.height);
  const scale = (p: PathVec | undefined) => (p ? { x: round6(p.x / width), y: round6(p.y / height) } : undefined);
  return {
    box: { x: b.x, y: b.y, width, height },
    points: points.map((p) => clean({
      x: round6((p.x - b.x) / width),
      y: round6((p.y - b.y) / height),
      in: scale(p.in),
      out: scale(p.out),
      kind: p.kind,
    })),
  };
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

function clean(p: PathAnchor): PathAnchor {
  const out: PathAnchor = { x: p.x, y: p.y };
  if (p.in && (p.in.x || p.in.y)) out.in = p.in;
  if (p.out && (p.out.x || p.out.y)) out.out = p.out;
  if (p.kind) out.kind = p.kind;
  return out;
}

/** Convert normalized anchors to absolute pixels inside a w × h box (handles stay relative). */
export function denormalizePath(points: readonly PathAnchor[], w: number, h: number): PathAnchor[] {
  return points.map((p) => clean({
    x: p.x * w,
    y: p.y * h,
    in: p.in ? { x: p.in.x * w, y: p.in.y * h } : undefined,
    out: p.out ? { x: p.out.x * w, y: p.out.y * h } : undefined,
    kind: p.kind,
  }));
}

// ---------- SVG path data import ----------

const TOKEN = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;

/**
 * Parse SVG path data (M, L, H, V, C, S, Q, T, A, Z, absolute or relative) into
 * anchors in the path's own coordinates. Only the first subpath is kept;
 * quadratic curves are raised to cubic and arcs are approximated by straight lines.
 */
export function parseSvgPath(d: string): { points: PathAnchor[]; closed: boolean } {
  const tokens = [...d.matchAll(TOKEN)].map((m) => m[1] ?? Number(m[2]));
  const points: PathAnchor[] = [];
  let closed = false;
  let i = 0;
  let command = "";
  let cx = 0, cy = 0; // current point
  let lastControl: PathVec | null = null; // reflected by S/T
  let lastQuad: PathVec | null = null;
  let started = false;
  const nextNumber = () => {
    const v = tokens[i];
    if (typeof v !== "number") throw new Error("Invalid SVG path data");
    i += 1;
    return v;
  };
  const cubicTo = (c1: PathVec, c2: PathVec, end: PathVec) => {
    const prev = points[points.length - 1]!;
    prev.out = { x: c1.x - prev.x, y: c1.y - prev.y };
    points.push({ x: end.x, y: end.y, in: { x: c2.x - end.x, y: c2.y - end.y } });
    cx = end.x; cy = end.y;
  };
  const lineTo = (end: PathVec) => {
    points.push({ x: end.x, y: end.y });
    cx = end.x; cy = end.y;
  };
  while (i < tokens.length) {
    const t = tokens[i];
    if (typeof t === "string") { command = t; i += 1; }
    else if (!command) throw new Error("SVG path data must start with a command");
    const rel = command === command.toLowerCase();
    const C = command.toUpperCase();
    if (C === "Z") {
      if (!started) throw new Error("SVG path data must start with M");
      closed = true;
      break;
    }
    if (C === "M") {
      if (started) break; // only the first subpath
      const x = nextNumber(), y = nextNumber();
      cx = rel ? cx + x : x; cy = rel ? cy + y : y;
      points.push({ x: cx, y: cy });
      started = true;
      command = rel ? "l" : "L"; // implicit lineto after moveto
      lastControl = lastQuad = null;
      continue;
    }
    if (!started) throw new Error("SVG path data must start with M");
    switch (C) {
      case "L": { const x = nextNumber(), y = nextNumber(); lineTo(rel ? { x: cx + x, y: cy + y } : { x, y }); lastControl = lastQuad = null; break; }
      case "H": { const x = nextNumber(); lineTo({ x: rel ? cx + x : x, y: cy }); lastControl = lastQuad = null; break; }
      case "V": { const y = nextNumber(); lineTo({ x: cx, y: rel ? cy + y : y }); lastControl = lastQuad = null; break; }
      case "C": {
        const v = [nextNumber(), nextNumber(), nextNumber(), nextNumber(), nextNumber(), nextNumber()];
        const o = rel ? { x: cx, y: cy } : { x: 0, y: 0 };
        const c2 = { x: o.x + v[2]!, y: o.y + v[3]! };
        cubicTo({ x: o.x + v[0]!, y: o.y + v[1]! }, c2, { x: o.x + v[4]!, y: o.y + v[5]! });
        lastControl = c2; lastQuad = null;
        break;
      }
      case "S": {
        const v = [nextNumber(), nextNumber(), nextNumber(), nextNumber()];
        const o = rel ? { x: cx, y: cy } : { x: 0, y: 0 };
        const c1 = lastControl ? { x: 2 * cx - lastControl.x, y: 2 * cy - lastControl.y } : { x: cx, y: cy };
        const c2 = { x: o.x + v[0]!, y: o.y + v[1]! };
        cubicTo(c1, c2, { x: o.x + v[2]!, y: o.y + v[3]! });
        lastControl = c2; lastQuad = null;
        break;
      }
      case "Q":
      case "T": {
        const o = rel ? { x: cx, y: cy } : { x: 0, y: 0 };
        let q: PathVec;
        if (C === "Q") q = { x: o.x + nextNumber(), y: o.y + nextNumber() };
        else q = lastQuad ? { x: 2 * cx - lastQuad.x, y: 2 * cy - lastQuad.y } : { x: cx, y: cy };
        const end = { x: o.x + nextNumber(), y: o.y + nextNumber() };
        const start = { x: cx, y: cy };
        // Degree elevation: a quadratic is a cubic with controls 2/3 of the way to q.
        cubicTo({ x: start.x + (2 / 3) * (q.x - start.x), y: start.y + (2 / 3) * (q.y - start.y) }, { x: end.x + (2 / 3) * (q.x - end.x), y: end.y + (2 / 3) * (q.y - end.y) }, end);
        lastQuad = q; lastControl = null;
        break;
      }
      case "A": {
        for (let k = 0; k < 5; k += 1) nextNumber();
        const x = nextNumber(), y = nextNumber();
        lineTo(rel ? { x: cx + x, y: cy + y } : { x, y });
        lastControl = lastQuad = null;
        break;
      }
      default: throw new Error(`Unsupported SVG path command "${command}"`);
    }
  }
  // A closing segment back onto the first anchor is implied by `closed`.
  if (closed && points.length > 2) {
    const first = points[0]!, last = points[points.length - 1]!;
    if (Math.abs(first.x - last.x) < 1e-9 && Math.abs(first.y - last.y) < 1e-9) {
      if (last.in) first.in = last.in;
      points.pop();
    }
  }
  return { points: points.map(clean), closed };
}

/**
 * Turn SVG path data into normalized anchors. With a viewBox the anchors keep
 * their place inside it; without one the drawing is fitted to its own bounds.
 */
export function svgPathToAnchors(d: string, viewBox?: { x?: number; y?: number; width: number; height: number }): { points: PathAnchor[]; closed: boolean } {
  const parsed = parseSvgPath(d);
  if (!viewBox) {
    const { points } = normalizePath(parsed.points, parsed.closed);
    return { points, closed: parsed.closed };
  }
  const vx = viewBox.x ?? 0, vy = viewBox.y ?? 0;
  const w = Math.max(1e-9, viewBox.width), h = Math.max(1e-9, viewBox.height);
  return {
    closed: parsed.closed,
    points: parsed.points.map((p) => clean({
      x: round6((p.x - vx) / w),
      y: round6((p.y - vy) / h),
      in: p.in ? { x: round6(p.in.x / w), y: round6(p.in.y / h) } : undefined,
      out: p.out ? { x: round6(p.out.x / w), y: round6(p.out.y / h) } : undefined,
    })),
  };
}

/**
 * Mirror one handle of a smooth anchor so both stay on one line.
 * `keepLength` keeps the opposite handle's own length (Illustrator's default);
 * otherwise it mirrors exactly (symmetric).
 */
export function mirrorHandle(handle: PathVec, opposite: PathVec | undefined, keepLength = true): PathVec {
  const length = Math.hypot(handle.x, handle.y);
  if (!keepLength || !opposite || length === 0) return { x: -handle.x, y: -handle.y };
  const other = Math.hypot(opposite.x, opposite.y);
  return { x: (-handle.x / length) * other, y: (-handle.y / length) * other };
}
