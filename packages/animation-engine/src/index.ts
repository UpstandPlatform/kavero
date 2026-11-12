import type { CatalogDocument, CatalogElement, CatalogSlide, ElementAnimation, SlideTransition } from "@Kavero/catalog-engine";

import { ease, type Easing } from "./easing";
import { animationSpanMs, drawProgressAt, iterationAt, sampleKeyframes, SETTLED_MS } from "./keyframes";

export * from "./morph";
export * from "./easing";
export * from "./keyframes";
export * from "./path-dash";

/**
 * Deterministic animation runtime. Everything is a pure function of time, so the
 * editor preview, the published site and frame-by-frame video rendering all
 * produce identical results (the same idea Remotion uses).
 */

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---------- Element animation schedule ----------

export interface ScheduledAnimation {
  elementId: string;
  animation: ElementAnimation;
  startMs: number;
  endMs: number;
  clickIndex?: number;
  paragraphIndex?: number;
}

/**
 * Resolve triggers into absolute times within a slide. Explicit sequence order is
 * respected, with stacking order kept for older catalogs. Timed playback treats
 * each click trigger as the next step in the animation sequence.
 */
export function scheduleSlide(slide: CatalogSlide): ScheduledAnimation[] {
  const out: ScheduledAnimation[] = [];
  let prevStart = 0;
  let prevEnd = 0;
  let clickIndex = 0;
  const animations = slide.elements.flatMap((element) => element.animations.map((animation, index) => ({
    element,
    animation,
    fallback: element.zIndex * 100 + index,
  }))).sort((a, b) => (a.animation.order ?? a.fallback) - (b.animation.order ?? b.fallback));
  for (const { element: el, animation: a } of animations) {
    const paragraphCount = a.byParagraph && el.type === "text" ? Math.max(1, el.content.paragraphs.length) : 1;
    for (let paragraphIndex = 0; paragraphIndex < paragraphCount; paragraphIndex += 1) {
      let start: number;
      const trigger = paragraphCount > 1 && paragraphIndex > 0 && a.trigger === "on-click" ? "on-click" : a.trigger;
      if (trigger === "with-previous") start = prevStart + a.delayMs;
      else if (trigger === "after-previous" || trigger === "on-click") start = prevEnd + a.delayMs;
      else start = a.startMs + a.delayMs + (paragraphCount > 1 ? paragraphIndex * (a.durationMs + a.delayMs) : 0);
      if (trigger === "on-click") clickIndex += 1;
      const s: ScheduledAnimation = {
        elementId: el.id,
        animation: a,
        startMs: start,
        endMs: start + animationSpanMs(a),
        ...(trigger === "on-click" ? { clickIndex } : {}),
        ...(paragraphCount > 1 ? { paragraphIndex } : {}),
      };
      out.push(s);
      prevStart = s.startMs;
      prevEnd = Math.max(prevEnd, s.endMs);
    }
  }
  return out;
}

/** The next timeline boundary that must wait for a presenter click. */
export function nextClickStart(schedule: readonly ScheduledAnimation[], completedClickSteps: number): number | undefined {
  return schedule
    .filter((animation) => animation.clickIndex === completedClickSteps + 1)
    .reduce<number | undefined>((next, animation) => next === undefined ? animation.startMs : Math.min(next, animation.startMs), undefined);
}

/** Keep click-triggered animations hidden until the presenter advances the step. */
export function gateClickTimeline(schedule: readonly ScheduledAnimation[], elapsedMs: number, completedClickSteps: number): number {
  const next = nextClickStart(schedule, completedClickSteps);
  return next === undefined ? elapsedMs : Math.min(elapsedMs, next);
}

export const DEFAULT_SLIDE_MS = 4000;

/** How long a slide stays on screen in playback/video. */
export function slideDurationMs(slide: CatalogSlide): number {
  const lastAnim = Math.max(0, ...scheduleSlide(slide).map((s) => s.endMs));
  if (slide.durationMs) return Math.max(slide.durationMs, lastAnim + (lastAnim > 0 ? 250 : 0));
  return Math.max(DEFAULT_SLIDE_MS, lastAnim + 1500);
}

/** True when an animation on the slide keeps repeating until the slide ends, so playback must keep rendering frames. */
export function slideHasLoopingAnimation(slide: CatalogSlide): boolean {
  return slide.elements.some((element) => !element.hidden && element.animations.some((a) => a.loop && (a.category === "emphasis" || a.category === "keyframes")));
}

// ---------- Element state at time t ----------

export interface VisualState {
  opacity: number;
  x: number; // px offset
  y: number;
  scale: number;
  rotate: number; // deg
  blur: number; // px
  /** Paths: visible fraction of the stroke (draw/erase/keyframe drawProgress). */
  draw: number;
  /** Paths: which end the visible stroke is attached to. */
  drawAnchor: "start" | "end";
  /** Paths: fill opacity multiplier. */
  fill: number;
  /** Paths: position (0..1) of the trace dash running along the stroke, when tracing. */
  trace: number | null;
}

export const IDENTITY: VisualState = { opacity: 1, x: 0, y: 0, scale: 1, rotate: 0, blur: 0, draw: 1, drawAnchor: "start", fill: 1, trace: null };

function dirVector(dir: ElementAnimation["direction"], distance: number) {
  switch (dir ?? "up") {
    case "left": return { x: -distance, y: 0 };
    case "right": return { x: distance, y: 0 };
    case "down": return { x: 0, y: distance };
    case "up": return { x: 0, y: -distance };
  }
}

/** The "hidden" end of an entrance (start) or exit (end). */
function offState(a: ElementAnimation): Partial<VisualState> {
  switch (a.preset) {
    case "appear":
    case "fade": return { opacity: 0 };
    case "slide": {
      // Entrances come in from the opposite side of where they're heading.
      const v = dirVector(a.direction, 120);
      return a.category === "entrance" ? { opacity: 0, x: -v.x, y: -v.y } : { opacity: 0, x: v.x, y: v.y };
    }
    case "scale":
    case "zoom": return { opacity: 0, scale: 0.3 };
    case "grow": return { opacity: 0, scale: 0.1 };
    case "shrink": return { opacity: 0, scale: 1.5 };
    case "bounce": return { opacity: 0, scale: 0.3 };
    case "rotate":
    case "spin": return { opacity: 0, rotate: -180, scale: 0.8 };
    case "flip": return { opacity: 0, rotate: -90, scale: 0.75 };
    case "rise": return { opacity: 0, y: 80 };
    case "blur": return { opacity: 0, blur: 24 };
    case "float": return { opacity: 0, y: 40 };
    default: return { opacity: 0 };
  }
}

function mix(from: Partial<VisualState>, to: Partial<VisualState>, t: number): VisualState {
  const f = { ...IDENTITY, ...from };
  const g = { ...IDENTITY, ...to };
  return {
    ...IDENTITY,
    opacity: lerp(f.opacity, g.opacity, t), x: lerp(f.x, g.x, t), y: lerp(f.y, g.y, t),
    scale: lerp(f.scale, g.scale, t), rotate: lerp(f.rotate, g.rotate, t), blur: lerp(f.blur, g.blur, t),
  };
}

function compose(a: VisualState, b: VisualState): VisualState {
  return {
    opacity: a.opacity * b.opacity, x: a.x + b.x, y: a.y + b.y, scale: a.scale * b.scale, rotate: a.rotate + b.rotate, blur: a.blur + b.blur,
    draw: a.draw * b.draw,
    // The animation that is actually hiding part of the stroke decides which end stays visible.
    drawAnchor: b.draw < 1 ? b.drawAnchor : a.drawAnchor,
    fill: a.fill * b.fill,
    trace: b.trace ?? a.trace,
  };
}

const isPathPreset = (a: ElementAnimation) => a.preset === "draw" || a.preset === "erase" || a.preset === "trace";

function animationState(s: ScheduledAnimation, t: number): VisualState {
  const a = s.animation;
  const elapsed = t - s.startMs;
  const settled = t >= SETTLED_MS;
  const raw = elapsed / Math.max(1, a.durationMs);
  const p = clamp01(raw);
  const easing: Easing = a.preset === "bounce" && a.easing === "ease-out" ? "spring" : a.easing;
  const e = ease(easing, p);

  if (a.category === "keyframes") {
    // Before the start the first keyframe holds and after the end the last one does (CSS fill-mode: both).
    const it = iterationAt(elapsed, a, settled);
    const v = sampleKeyframes(a.keyframes ?? [], it.p);
    return { ...IDENTITY, x: v.x, y: v.y, scale: v.scale, rotate: v.rotation, opacity: v.opacity, draw: v.drawProgress, drawAnchor: a.reverse ? "end" : "start" };
  }

  if (isPathPreset(a) && a.category !== "motion-path") {
    if (a.preset === "trace") {
      const it = iterationAt(elapsed, a, settled);
      if (!it.active) return IDENTITY;
      const phase = ease(a.easing, it.p);
      return { ...IDENTITY, trace: a.reverse ? 1 - phase : phase };
    }
    const d = drawProgressAt(elapsed, a);
    return { ...IDENTITY, draw: d.draw, drawAnchor: d.anchor, fill: d.fill };
  }

  switch (a.category) {
    case "entrance":
      return raw <= 0 ? mix(offState(a), {}, 0) : mix(offState(a), {}, e);
    case "exit":
      return raw <= 0 ? IDENTITY : mix({}, offState(a), e);
    case "emphasis": {
      // Emphasis effects can repeat (iterations, loop) and alternate.
      const it = iterationAt(elapsed, a, settled);
      if (!it.active) return IDENTITY;
      const q = it.p;
      const eq = ease(easing, q);
      const wave = Math.sin(q * Math.PI); // 0 → 1 → 0
      switch (a.preset) {
        case "pulse": return { ...IDENTITY, scale: 1 + 0.12 * wave };
        case "bounce": return { ...IDENTITY, y: -Math.abs(Math.sin(q * Math.PI * 3)) * 40 * (1 - q) };
        case "float": return { ...IDENTITY, y: -20 * Math.sin(q * Math.PI * 2) };
        case "rotate":
        case "spin": return { ...IDENTITY, rotate: 360 * eq };
        case "flip": return { ...IDENTITY, rotate: 180 * Math.sin(q * Math.PI) };
        case "grow": return { ...IDENTITY, scale: 1 + 0.24 * wave };
        case "shrink": return { ...IDENTITY, scale: 1 - 0.18 * wave };
        case "blur": return { ...IDENTITY, blur: 8 * wave };
        case "fade": return { ...IDENTITY, opacity: 1 - 0.6 * wave };
        default: return { ...IDENTITY, scale: 1 + 0.08 * wave };
      }
    }
    case "motion-path": {
      const pts = a.path?.length ? [{ x: 0, y: 0 }, ...a.path] : [{ x: 0, y: 0 }, { x: 200, y: 0 }];
      const seg = e * (pts.length - 1);
      const i = Math.min(pts.length - 2, Math.floor(seg));
      const f = seg - i;
      return { ...IDENTITY, x: lerp(pts[i]!.x, pts[i + 1]!.x, f), y: lerp(pts[i]!.y, pts[i + 1]!.y, f) };
    }
  }
}

/** Combined visual state of one element at slide-local time t (ms). */
export function elementStateAt(schedule: ScheduledAnimation[], elementId: string, t: number, paragraphIndex?: number): VisualState {
  let state = IDENTITY;
  const elementAnimations = schedule.filter((animation) => animation.elementId === elementId
    && (paragraphIndex === undefined ? animation.paragraphIndex === undefined : animation.paragraphIndex === paragraphIndex));
  const firstEntrance = elementAnimations.find((animation) => animation.animation.category === "entrance");
  for (const s of schedule) {
    if (s.elementId !== elementId) continue;
    if (!elementAnimations.includes(s)) continue;
    if (s.animation.category === "entrance" && t < s.startMs) {
      const earlierEntranceHasStarted = elementAnimations.some((previous) =>
        previous.animation.category === "entrance" && previous !== s && previous.startMs < s.startMs && t >= previous.startMs,
      );
      if (earlierEntranceHasStarted || s !== firstEntrance) continue;
    }
    state = compose(state, animationState(s, t));
  }
  return state;
}

export function stateToCss(s: VisualState): { opacity?: number; transform?: string; filter?: string } {
  const parts: string[] = [];
  if (s.x || s.y) parts.push(`translate(${s.x.toFixed(2)}px, ${s.y.toFixed(2)}px)`);
  if (s.rotate) parts.push(`rotate(${s.rotate.toFixed(2)}deg)`);
  if (s.scale !== 1) parts.push(`scale(${s.scale.toFixed(4)})`);
  return {
    opacity: s.opacity === 1 ? undefined : Math.max(0, Math.min(1, s.opacity)),
    transform: parts.length ? parts.join(" ") : undefined,
    filter: s.blur > 0.01 ? `blur(${s.blur.toFixed(2)}px)` : undefined,
  };
}

// ---------- Catalog timeline and slide transitions ----------

export interface TimelineSegment {
  slideIndex: number;
  startMs: number;
  endMs: number;
  /** Transition that plays at the start of this slide (overlapping the previous slide's end). */
  transition?: SlideTransition;
}

export interface Timeline {
  segments: TimelineSegment[];
  totalMs: number;
}

export function buildTimeline(doc: CatalogDocument): Timeline {
  let t = 0;
  const segments = doc.slides.map((slide, i) => {
    const transition = i > 0 && slide.transition && slide.transition.type !== "none" ? slide.transition : undefined;
    const d = Math.max(slideDurationMs(slide), transition ? transition.delayMs + transition.durationMs : 0);
    const seg = { slideIndex: i, startMs: t, endMs: t + d, transition };
    t += d;
    return seg;
  });
  return { segments, totalMs: t };
}

export interface Frame {
  /** Slide shown at this moment and its local time. */
  current: { slideIndex: number; localMs: number };
  /** Outgoing slide while a transition is running. */
  previous?: { slideIndex: number; localMs: number };
  transition?: { type: SlideTransition["type"]; progress: number; direction: SlideTransition["direction"] };
}

export function frameAt(timeline: Timeline, t: number): Frame {
  const { segments } = timeline;
  t = Math.max(0, Math.min(t, Math.max(0, timeline.totalMs - 1)));
  const i = Math.max(0, segments.findIndex((s) => t >= s.startMs && t < s.endMs));
  const seg = segments[i]!;
  const localMs = t - seg.startMs;
  const tr = seg.transition;
  // Transitions run during the first part of the incoming slide.
  const trMs = tr ? tr.delayMs + tr.durationMs : 0;
  if (tr && localMs < trMs && i > 0) {
    const prev = segments[i - 1]!;
    const progress = ease(tr.easing, (localMs - tr.delayMs) / Math.max(1, tr.durationMs));
    return {
      current: { slideIndex: i, localMs },
      previous: { slideIndex: i - 1, localMs: prev.endMs - prev.startMs - 1 },
      transition: { type: tr.type, progress, direction: tr.direction },
    };
  }
  return { current: { slideIndex: i, localMs } };
}

export interface LayerStyle {
  opacity?: number;
  transform?: string;
  clipPath?: string;
  zIndex?: number;
}

/** CSS for the outgoing and incoming slide layers at transition progress p (0→1). */
export function transitionStyles(type: SlideTransition["type"], p: number, direction: SlideTransition["direction"] = "left"): { outgoing: LayerStyle; incoming: LayerStyle } {
  const sign = direction === "right" || direction === "down" ? 1 : -1;
  const axis = direction === "up" || direction === "down" ? "Y" : "X";
  const pct = (v: number) => `translate${axis}(${(v * 100).toFixed(3)}%)`;
  switch (type) {
    case "fade":
    case "morph": // the slide layers cross-fade; matched elements are drawn by MorphView
      return { outgoing: { opacity: 1 }, incoming: { opacity: p, zIndex: 1 } };
    case "slide":
      return { outgoing: {}, incoming: { transform: pct(-sign * (1 - p)), zIndex: 1 } };
    case "push":
      return { outgoing: { transform: pct(sign * p) }, incoming: { transform: pct(-sign * (1 - p)), zIndex: 1 } };
    case "zoom":
      return { outgoing: { opacity: 1 - p, transform: `scale(${1 + 0.15 * p})` }, incoming: { opacity: p, transform: `scale(${0.85 + 0.15 * p})`, zIndex: 1 } };
    case "wipe": {
      const r = ((1 - p) * 100).toFixed(3);
      const clip = { left: `inset(0 0 0 ${r}%)`, right: `inset(0 ${r}% 0 0)`, up: `inset(${r}% 0 0 0)`, down: `inset(0 0 ${r}% 0)` }[direction ?? "left"];
      return { outgoing: {}, incoming: { clipPath: clip, zIndex: 1 } };
    }
    case "flip":
      {
        const axis = direction === "up" || direction === "down" ? "X" : "Y";
      return p < 0.5
        ? { outgoing: { transform: `perspective(2000px) rotate${axis}(${(p * 180).toFixed(2)}deg)`, zIndex: 1 }, incoming: { opacity: 0 } }
        : { outgoing: { opacity: 0 }, incoming: { transform: `perspective(2000px) rotate${axis}(${((p - 1) * 180).toFixed(2)}deg)`, zIndex: 1 } };
      }
    case "none":
      return { outgoing: { opacity: 0 }, incoming: {} };
  }
}

export function elementHasAnimations(el: CatalogElement) {
  return el.animations.length > 0;
}
