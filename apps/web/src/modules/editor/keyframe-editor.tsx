"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Delete02Icon, RecordIcon } from "@hugeicons/core-free-icons";
import { sampleKeyframes, sortKeyframes } from "@Kavero/animation-engine";
import { KEYFRAME_PROPERTIES, type CatalogElement, type ElementAnimation, type ElementPosition, type Keyframe, type KeyframeProperty } from "@Kavero/catalog-engine";
import type { EditorCommand } from "@Kavero/editor-core";
import { Button } from "@Kavero/ui/components/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@Kavero/ui/components/input-group";
import { SimpleSelect } from "@Kavero/ui/components/simple-select";
import { TooltipHint } from "@Kavero/ui/components/tooltip";
import { useEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from "react";

const PROPERTY_LABELS: Record<KeyframeProperty, { label: string; suffix?: string; min?: number; max?: number; step: number; scale?: number }> = {
  x: { label: "X", suffix: "px", step: 1 },
  y: { label: "Y", suffix: "px", step: 1 },
  scale: { label: "Scale", suffix: "%", min: 0, max: 10_000, step: 5, scale: 100 },
  rotation: { label: "Rotate", suffix: "°", step: 5 },
  opacity: { label: "Opacity", suffix: "%", min: 0, max: 100, step: 5, scale: 100 },
  drawProgress: { label: "Drawn", suffix: "%", min: 0, max: 100, step: 5, scale: 100 },
};

const EASINGS = [
  { value: "linear", label: "Linear" }, { value: "ease-in", label: "Ease in" },
  { value: "ease-out", label: "Ease out" }, { value: "ease-in-out", label: "Ease in and out" },
  { value: "spring", label: "Spring" },
];

const round = (v: number, digits = 3) => Math.round(v * 10 ** digits) / 10 ** digits;

/** Default keyframes for a new keyframes animation: draw a path in, or rise and fade anything else in. */
export function defaultKeyframes(element: CatalogElement): Omit<Keyframe, "id">[] {
  return element.type === "path"
    ? [{ offset: 0, drawProgress: 0, easing: "ease-in-out" }, { offset: 1, drawProgress: 1, easing: "linear" }]
    : [{ offset: 0, opacity: 0, y: 40, easing: "ease-out" }, { offset: 1, opacity: 1, y: 0, easing: "linear" }];
}

/** Number field where empty means "not set by this keyframe". */
function OptionalNumber({ label, value, onCommit, suffix, min, max, step, scale = 1 }: {
  label: string; value: number | undefined; onCommit: (value: number | undefined) => void; suffix?: string; min?: number; max?: number; step: number; scale?: number;
}) {
  const shown = value === undefined ? "" : String(round(value * scale, 2));
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const commit = () => {
    if (draft.trim() === "") { if (value !== undefined) onCommit(undefined); return; }
    let parsed = Number(draft);
    if (!Number.isFinite(parsed)) return setDraft(shown);
    if (min !== undefined) parsed = Math.max(min, parsed);
    if (max !== undefined) parsed = Math.min(max, parsed);
    const next = round(parsed / scale, 4);
    setDraft(String(round(next * scale, 2)));
    if (next !== value) onCommit(next);
  };
  return (
    <label className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <InputGroup>
        <InputGroupInput type="number" inputMode="decimal" placeholder="—" aria-label={`Keyframe ${label}`} value={draft} step={step}
          onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()} className="h-7 text-xs tabular-nums" />
        {suffix && <InputGroupAddon align="inline-end">{suffix}</InputGroupAddon>}
      </InputGroup>
    </label>
  );
}

/**
 * Keyframe editing for one "keyframes" animation: a track with a draggable
 * diamond per keyframe and a playhead, buttons to add and record keyframes, and
 * fields for the selected keyframe. Every change is one undoable command.
 */
export function KeyframeEditor({ element, animation, run }: {
  element: CatalogElement;
  animation: ElementAnimation;
  run: (command: EditorCommand) => unknown;
}) {
  const keyframes = sortKeyframes(animation.keyframes ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(keyframes[0]?.id ?? null);
  const [playhead, setPlayhead] = useState(0.5);
  const [dragging, setDragging] = useState<{ id: string; offset: number } | null>(null);
  const track = useRef<HTMLDivElement>(null);
  // The element's resting state when editing started; "Record" measures changes against it.
  const rest = useRef<{ position: ElementPosition; opacity: number }>({ position: element.position, opacity: element.opacity });
  useEffect(() => { rest.current = { position: element.position, opacity: element.opacity }; }, [element.id, animation.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = keyframes.find((keyframe) => keyframe.id === selectedId) ?? null;
  const properties = KEYFRAME_PROPERTIES.filter((property) => property !== "drawProgress" || element.type === "path");
  const base = { elementId: element.id, animationId: animation.id };

  const offsetAt = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return 0;
    // The track runs start → end in reading order, so mirror it for right-to-left pages.
    const ltr = (clientX - r.left) / r.width;
    const rtl = getComputedStyle(track.current!).direction === "rtl";
    return round(Math.min(1, Math.max(0, rtl ? 1 - ltr : ltr)));
  };

  function addAt(offset: number) {
    // A new keyframe starts from the values the animation has at that moment, so nothing jumps.
    const sampled = sampleKeyframes(keyframes, offset);
    const used = properties.filter((property) => keyframes.some((keyframe) => keyframe[property] !== undefined));
    const keyframe: Omit<Keyframe, "id"> = { offset, easing: "ease-in-out" };
    for (const property of used) keyframe[property] = round(sampled[property], 4);
    const result = run({ type: "animation.addKeyframe", ...base, keyframe }) as { createdIds?: string[] } | undefined;
    if (result?.createdIds?.[0]) setSelectedId(result.createdIds[0]);
  }

  /** Turn how the element was moved, resized, rotated or faded on the slide into a keyframe at the playhead, then put it back. */
  function record() {
    const from = rest.current;
    const now = element;
    const p0 = from.position, p1 = now.position;
    const values: Partial<Keyframe> = {
      x: round(p1.x + p1.width / 2 - (p0.x + p0.width / 2), 2),
      y: round(p1.y + p1.height / 2 - (p0.y + p0.height / 2), 2),
      scale: round(p0.width > 0 && p0.height > 0 ? (p1.width / p0.width + p1.height / p0.height) / 2 : 1, 4),
      rotation: round(p1.rotation - p0.rotation, 2),
      opacity: round(from.opacity > 0 ? Math.min(1, now.opacity / from.opacity) : 1, 4),
    };
    const existing = keyframes.find((keyframe) => Math.abs(keyframe.offset - playhead) < 0.005);
    const restore: EditorCommand[] = [
      ...(JSON.stringify(p0) !== JSON.stringify(p1) ? [{ type: "element.move" as const, elementId: element.id, position: p0 }] : []),
      ...(from.opacity !== now.opacity ? [{ type: "element.update" as const, elementId: element.id, changes: { opacity: from.opacity } }] : []),
    ];
    const keyframeCommand: EditorCommand = existing?.id
      ? { type: "animation.updateKeyframe", ...base, keyframeId: existing.id, changes: values }
      : { type: "animation.addKeyframe", ...base, keyframe: { offset: playhead, easing: "ease-in-out", ...values } };
    const result = run({ type: "batch", label: "Record keyframe", commands: [keyframeCommand, ...restore] }) as { createdIds?: string[] } | undefined;
    setSelectedId(existing?.id ?? result?.createdIds?.[0] ?? null);
  }

  function onDiamondDown(event: RPointerEvent<HTMLButtonElement>, keyframe: Keyframe) {
    if (event.button !== 0) return;
    event.stopPropagation();
    setSelectedId(keyframe.id ?? null);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging({ id: keyframe.id!, offset: keyframe.offset });
  }

  function onDiamondMove(event: RPointerEvent<HTMLButtonElement>) {
    if (!dragging) return;
    setDragging({ ...dragging, offset: offsetAt(event.clientX) });
  }

  function onDiamondUp() {
    if (!dragging) return;
    const keyframe = keyframes.find((k) => k.id === dragging.id);
    setDragging(null);
    if (keyframe && keyframe.offset !== dragging.offset) run({ type: "animation.updateKeyframe", ...base, keyframeId: dragging.id, changes: { offset: dragging.offset } });
  }

  function onDiamondKey(event: RKeyboardEvent<HTMLButtonElement>, keyframe: Keyframe) {
    const step = event.shiftKey ? 0.1 : 0.01;
    const forward = getComputedStyle(event.currentTarget).direction === "rtl" ? "ArrowLeft" : "ArrowRight";
    const back = forward === "ArrowRight" ? "ArrowLeft" : "ArrowRight";
    if (event.key === forward || event.key === back) {
      event.preventDefault();
      const offset = round(Math.min(1, Math.max(0, keyframe.offset + (event.key === forward ? step : -step))));
      run({ type: "animation.updateKeyframe", ...base, keyframeId: keyframe.id!, changes: { offset } });
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      run({ type: "animation.removeKeyframe", ...base, keyframeId: keyframe.id! });
    }
  }

  const durationS = animation.durationMs / 1000;
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>0 s</span>
        <span>Playhead {(playhead * durationS).toFixed(2)} s</span>
        <span>{durationS.toFixed(1)} s</span>
      </div>
      <div
        ref={track}
        role="group"
        aria-label="Keyframe track: click to move the playhead, drag diamonds to retime keyframes"
        className="relative h-8 cursor-pointer rounded-md border bg-background"
        onPointerDown={(event) => { if (event.button === 0) setPlayhead(offsetAt(event.clientX)); }}
      >
        <span aria-hidden className="absolute inset-x-2 top-1/2 h-px -translate-y-1/2 bg-border" />
        <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-primary" style={{ insetInlineStart: `${playhead * 100}%` }} />
        {keyframes.map((keyframe, index) => {
          const offset = dragging && dragging.id === keyframe.id ? dragging.offset : keyframe.offset;
          const isSelected = keyframe.id === selectedId;
          return (
            <button
              key={keyframe.id ?? index}
              type="button"
              aria-label={`Keyframe ${index + 1} at ${Math.round(offset * 100)}%`}
              aria-pressed={isSelected}
              title="Drag to retime · arrows nudge · Delete removes"
              onPointerDown={(event) => onDiamondDown(event, keyframe)}
              onPointerMove={onDiamondMove}
              onPointerUp={onDiamondUp}
              onPointerCancel={onDiamondUp}
              onKeyDown={(event) => onDiamondKey(event, keyframe)}
              onClick={(event) => event.stopPropagation()}
              className={`absolute top-1/2 size-3 -translate-y-1/2 rotate-45 border outline-offset-2 rtl:translate-x-1/2 ltr:-translate-x-1/2 ${isSelected ? "border-primary bg-primary" : "border-foreground/60 bg-background hover:bg-muted"}`}
              style={{ insetInlineStart: `${offset * 100}%`, cursor: "ew-resize", touchAction: "none" }}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-1">
        <Button size="xs" variant="outline" onClick={() => addAt(playhead)}><HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />Add at playhead</Button>
        <TooltipHint content="Move, resize, rotate or fade the element on the slide, then record: the change becomes a keyframe at the playhead and the element returns to its resting state.">
          <Button size="xs" variant="outline" onClick={record}><HugeiconsIcon icon={RecordIcon} data-icon="inline-start" />Record current state</Button>
        </TooltipHint>
        <Button size="xs" variant="ghost" disabled={!selected} aria-label="Remove selected keyframe" onClick={() => selected?.id && run({ type: "animation.removeKeyframe", ...base, keyframeId: selected.id })}>
          <HugeiconsIcon icon={Delete02Icon} />
        </Button>
      </div>
      {selected ? (
        <div className="grid gap-1.5 rounded-md border bg-background p-2">
          <OptionalNumber label="At" value={selected.offset} suffix="%" min={0} max={100} step={1} scale={100}
            onCommit={(offset) => offset !== undefined && run({ type: "animation.updateKeyframe", ...base, keyframeId: selected.id!, changes: { offset } })} />
          {properties.map((property) => {
            const meta = PROPERTY_LABELS[property];
            return (
              <OptionalNumber key={property} label={meta.label} value={selected[property]} suffix={meta.suffix} min={meta.min} max={meta.max} step={meta.step} scale={meta.scale}
                onCommit={(value) => run({ type: "animation.updateKeyframe", ...base, keyframeId: selected.id!, changes: { [property]: value } })} />
            );
          })}
          <label className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-2 text-xs">
            <span className="text-muted-foreground">To next</span>
            <SimpleSelect size="sm" aria-label="Easing to the next keyframe" value={selected.easing} options={EASINGS}
              onValueChange={(easing) => run({ type: "animation.updateKeyframe", ...base, keyframeId: selected.id!, changes: { easing: easing as Keyframe["easing"] } })} />
          </label>
          <p className="text-[10px] leading-relaxed text-muted-foreground">Leave a field empty to let that property flow between the keyframes around it. X and Y are offsets from where the element sits on the slide.</p>
        </div>
      ) : <p className="text-[11px] text-muted-foreground">Select a keyframe diamond to edit it.</p>}
    </div>
  );
}
