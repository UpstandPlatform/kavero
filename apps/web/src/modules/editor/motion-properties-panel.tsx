"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, ArrowDown01Icon, ArrowUp01Icon, Delete02Icon, DragDropVerticalIcon, PlayIcon } from "@hugeicons/core-free-icons";
import { matchMorph } from "@Kavero/animation-engine";
import type { CatalogDocument, CatalogSlide, ElementAnimation } from "@Kavero/catalog-engine";
import type { Editor, EditorCommand } from "@Kavero/editor-core";
import { Button } from "@Kavero/ui/components/button";
import { Checkbox } from "@Kavero/ui/components/checkbox";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@Kavero/ui/components/input-group";
import { SimpleSelect } from "@Kavero/ui/components/simple-select";
import { Slider } from "@Kavero/ui/components/slider";
import { useEffect, useState, type ReactNode } from "react";

import { useRun } from "./use-catalog-editor";

const TRANSITIONS = [
  { value: "none", label: "None" }, { value: "fade", label: "Fade" },
  { value: "slide", label: "Slide" }, { value: "push", label: "Push" },
  { value: "zoom", label: "Zoom" }, { value: "wipe", label: "Wipe" },
  { value: "flip", label: "Flip" }, { value: "morph", label: "Morph" },
];
const PRESETS: { value: ElementAnimation["preset"]; label: string }[] = [
  { value: "appear", label: "Appear" }, { value: "fade", label: "Fade in" },
  { value: "slide", label: "Fly in" }, { value: "rise", label: "Rise up" },
  { value: "zoom", label: "Zoom in" }, { value: "grow", label: "Grow" },
  { value: "bounce", label: "Bounce" }, { value: "spin", label: "Spin" },
  { value: "flip", label: "Flip" }, { value: "blur", label: "Blur" },
  { value: "float", label: "Float" }, { value: "pulse", label: "Pulse" },
  { value: "shrink", label: "Shrink" }, { value: "rotate", label: "Rotate" },
  { value: "scale", label: "Scale" },
];
const EASINGS = [
  { value: "linear", label: "Linear" }, { value: "ease-in", label: "Ease in" },
  { value: "ease-out", label: "Ease out" }, { value: "ease-in-out", label: "Ease in and out" },
  { value: "spring", label: "Spring" },
];
const DIRECTIONS = (["left", "right", "up", "down"] as const).map((value) => ({ value, label: value }));
const TRIGGERS = [
  { value: "on-click", label: "On click" }, { value: "after-previous", label: "After previous" },
  { value: "with-previous", label: "With previous" }, { value: "on-enter", label: "With slide" },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b px-3 py-3">
      <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2 text-xs"><span className="text-muted-foreground">{label}</span>{children}</label>;
}

function NumberField({ label, value, onCommit, min, max, step = 0.1 }: {
  label: string; value: number; onCommit: (value: number) => void; min: number; max: number; step?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) return setDraft(String(value));
    const next = Math.min(max, Math.max(min, parsed));
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  return (
    <label className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <InputGroup>
        <InputGroupInput type="number" value={draft} min={min} max={max} step={step} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()} className="h-7 text-xs tabular-nums" />
        <InputGroupAddon align="inline-end">s</InputGroupAddon>
      </InputGroup>
    </label>
  );
}

export function MotionPropertiesPanel({ editor, doc, slide, selection, onPlay }: {
  editor: Editor;
  doc: CatalogDocument;
  slide: CatalogSlide;
  selection: string[];
  onPlay: () => void;
}) {
  const run = useRun(editor);
  const [expandedAnimationId, setExpandedAnimationId] = useState<string | null>(null);
  const [draggedAnimation, setDraggedAnimation] = useState<{ id: string; over: number | null } | null>(null);
  const [category, setCategory] = useState<ElementAnimation["category"]>("entrance");
  const [preset, setPreset] = useState<ElementAnimation["preset"]>("fade");
  const [trigger, setTrigger] = useState<ElementAnimation["trigger"]>("on-click");
  const [direction, setDirection] = useState<NonNullable<ElementAnimation["direction"]>>("left");
  const [duration, setDuration] = useState(600);
  const [delay, setDelay] = useState(0);
  const [byParagraph, setByParagraph] = useState(false);
  const [newEasing, setNewEasing] = useState<ElementAnimation["easing"]>("ease-out");
  const [pathX, setPathX] = useState(200);
  const [pathY, setPathY] = useState(0);
  const [transitionDuration, setTransitionDuration] = useState(slide.transition?.durationMs ?? 500);
  useEffect(() => setTransitionDuration(slide.transition?.durationMs ?? 500), [slide.id, slide.transition?.durationMs]);

  const selected = slide.elements.filter((element) => selection.includes(element.id));
  const animations = slide.elements.flatMap((element) => element.animations.map((animation, index) => ({
    element,
    animation,
    fallback: element.zIndex * 100 + index,
  }))).sort((a, b) => (a.animation.order ?? a.fallback) - (b.animation.order ?? b.fallback));
  const transition = slide.transition;
  const transitionType = transition?.type ?? "none";
  const slideIndex = doc.slides.findIndex((candidate) => candidate.id === slide.id);
  const previousSlide = doc.slides[slideIndex - 1];
  const morphMatches = transition?.type === "morph" && previousSlide ? matchMorph(previousSlide, slide).length : 0;

  function updateTransition(changes: Partial<NonNullable<CatalogSlide["transition"]>>) {
    run({ type: "slide.setTransition", slideId: slide.id, transition: changes });
  }

  function updateAnimation(elementId: string, animationId: string, changes: Partial<ElementAnimation>) {
    run({ type: "element.updateAnimation", elementId, animationId, changes });
  }

  function reorderAnimation(toIndex: number) {
    if (!draggedAnimation) return;
    const fromIndex = animations.findIndex(({ animation }) => animation.id === draggedAnimation.id);
    const targetIndex = toIndex > fromIndex ? toIndex - 1 : toIndex;
    setDraggedAnimation(null);
    if (fromIndex < 0 || fromIndex === targetIndex) return;
    const { element, animation } = animations[fromIndex]!;
    run({ type: "element.setAnimationOrder", elementId: element.id, animationId: animation.id, toIndex: targetIndex });
  }

  function changeTransitionType(value: string) {
    if (value === "none") return run({ type: "slide.setTransition", slideId: slide.id, transition: null });
    run({ type: "slide.setTransition", slideId: slide.id, transition: { type: value as NonNullable<CatalogSlide["transition"]>["type"], durationMs: transition?.durationMs ?? 500 } });
  }

  function addAnimations() {
    const commands: EditorCommand[] = selected.map((element) => ({
      type: "element.addAnimation",
      elementId: element.id,
      animation: {
        category, preset: category === "motion-path" ? "custom" : preset, trigger,
        ...(preset === "slide" || preset === "rise" ? { direction } : {}),
        ...(category === "motion-path" ? { path: [{ x: pathX, y: pathY }] } : {}),
        durationMs: duration,
        delayMs: delay,
        easing: category === "exit" && newEasing === "ease-out" ? "ease-in" : newEasing,
        byParagraph: element.type === "text" && byParagraph,
      },
    }));
    run({ type: "batch", label: "Add object animation", commands });
  }

  return (
    <div>
      <Section title="Slide transition">
        <Field label="Effect">
          <SimpleSelect size="sm" aria-label="Slide transition" value={transitionType} onValueChange={changeTransitionType}
            options={TRANSITIONS} />
        </Field>
        {transition && transition.type !== "none" && (
          <>
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground"><span>Slow</span><span>{(transitionDuration / 1000).toFixed(2)} s</span><span>Fast</span></div>
              <Slider aria-label="Transition speed" min={100} max={2000} step={50} value={[transitionDuration]}
                onValueChange={(value) => setTransitionDuration(typeof value === "number" ? value : value[0] ?? transitionDuration)}
                onValueCommitted={(value) => updateTransition({ durationMs: typeof value === "number" ? value : value[0] ?? transitionDuration })} />
            </div>
            <div className="grid gap-2">
              {transition.type !== "fade" && transition.type !== "morph" && <Field label="Direction">
                <SimpleSelect size="sm" aria-label="Transition direction" value={transition.direction ?? "left"} onValueChange={(value) => updateTransition({ direction: value as NonNullable<CatalogSlide["transition"]>["direction"] })} options={DIRECTIONS} />
              </Field>}
              <Field label="Easing">
                <SimpleSelect size="sm" aria-label="Transition easing" value={transition.easing} onValueChange={(value) => updateTransition({ easing: value as NonNullable<CatalogSlide["transition"]>["easing"] })} options={EASINGS} />
              </Field>
              <NumberField label="Delay" value={(transition.delayMs ?? 0) / 1000} min={0} max={5} onCommit={(value) => updateTransition({ delayMs: Math.round(value * 1000) })} />
            </div>
            {transition.type === "morph" && <p className="text-[10px] leading-relaxed text-muted-foreground">{slideIndex === 0 ? "Morph runs when arriving from the previous slide; this is the first slide." : `${morphMatches} matching elements will move between slides. Duplicate slides or copy layers to increase the match count.`}</p>}
          </>
        )}
        <Button size="sm" variant="outline" disabled={doc.slides.length < 2} onClick={() => run({
          type: "batch",
          label: "Apply transition to all slides",
          commands: doc.slides.map((candidate) => ({ type: "slide.setTransition" as const, slideId: candidate.id, transition: transition ? { ...transition } : null })),
        })}>Apply to all slides</Button>
      </Section>

      <Section title="Object animations">
        {animations.length ? (
          <div className="grid gap-1.5">
            {animations.map(({ element, animation }, index) => {
              const expanded = expandedAnimationId === animation.id;
              const triggerLabel = animation.trigger === "on-click" ? "On click"
                : animation.trigger === "with-previous" ? "With previous"
                : animation.trigger === "after-previous" ? "After previous" : "With slide";
              return (
                <div
                  key={animation.id}
                  className={`relative overflow-hidden rounded-lg border bg-background transition-opacity ${draggedAnimation?.id === animation.id ? "opacity-45" : ""}`}
                  onDragOver={(event) => {
                    if (!draggedAnimation) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    const bounds = event.currentTarget.getBoundingClientRect();
                    const over = event.clientY < bounds.top + bounds.height / 2 ? index : index + 1;
                    if (draggedAnimation.over !== over) setDraggedAnimation({ ...draggedAnimation, over });
                  }}
                  onDrop={(event) => {
                    if (!draggedAnimation) return;
                    event.preventDefault();
                    const bounds = event.currentTarget.getBoundingClientRect();
                    reorderAnimation(event.clientY < bounds.top + bounds.height / 2 ? index : index + 1);
                  }}
                >
                  {draggedAnimation?.over === index && <span aria-hidden="true" className="pointer-events-none absolute inset-x-1 top-0 z-10 h-0.5 rounded bg-primary" />}
                  {draggedAnimation?.over === index + 1 && <span aria-hidden="true" className="pointer-events-none absolute inset-x-1 bottom-0 z-10 h-0.5 rounded bg-primary" />}
                  <div className="flex min-w-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title="Drag to reorder"
                      aria-label={`Drag to reorder animation ${index + 1}`}
                      draggable
                      className="ms-1 shrink-0 cursor-grab active:cursor-grabbing"
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", animation.id);
                        setDraggedAnimation({ id: animation.id, over: null });
                      }}
                      onDragEnd={() => setDraggedAnimation(null)}
                    ><HugeiconsIcon icon={DragDropVerticalIcon} /></Button>
                    <button type="button" aria-expanded={expanded} onClick={() => { setExpandedAnimationId(expanded ? null : animation.id); editor.select([element.id]); }}
                      className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-start text-xs hover:bg-muted/50">
                      <span className="w-4 shrink-0 text-muted-foreground tabular-nums">{index + 1}</span>
                      <span className="min-w-0 flex-1 truncate">{element.name || element.type} · {PRESETS.find((item) => item.value === animation.preset)?.label ?? animation.preset}</span>
                      <span className="shrink-0 text-muted-foreground">{triggerLabel}</span>
                    </button>
                    <div className="flex shrink-0 items-center pe-1">
                      <Button variant="ghost" size="icon-xs" title="Move animation up" disabled={index === 0} onClick={() => run({ type: "element.setAnimationOrder", elementId: element.id, animationId: animation.id, toIndex: index - 1 })}><HugeiconsIcon icon={ArrowUp01Icon} /></Button>
                      <Button variant="ghost" size="icon-xs" title="Move animation down" disabled={index === animations.length - 1} onClick={() => run({ type: "element.setAnimationOrder", elementId: element.id, animationId: animation.id, toIndex: index + 1 })}><HugeiconsIcon icon={ArrowDown01Icon} /></Button>
                      <Button variant="ghost" size="icon-xs" title="Remove animation" onClick={() => run({ type: "element.removeAnimation", elementId: element.id, animationId: animation.id })}><HugeiconsIcon icon={Delete02Icon} /></Button>
                    </div>
                  </div>
                  {expanded && <div className="grid gap-2 border-t bg-muted/20 p-2">
                    <div className="grid grid-cols-2 gap-2">
                      <SimpleSelect size="sm" aria-label="Animation category" value={animation.category}
                        onValueChange={(value) => updateAnimation(element.id, animation.id, { category: value as ElementAnimation["category"] })}
                        options={[{ value: "entrance", label: "Entrance" }, { value: "exit", label: "Exit" }, { value: "emphasis", label: "Emphasis" }, { value: "motion-path", label: "Motion path" }]} />
                      <SimpleSelect size="sm" aria-label="Animation effect" value={animation.preset} onValueChange={(value) => updateAnimation(element.id, animation.id, { preset: value as ElementAnimation["preset"] })} options={PRESETS} />
                      <SimpleSelect size="sm" aria-label="Animation start" value={animation.trigger} onValueChange={(value) => updateAnimation(element.id, animation.id, { trigger: value as ElementAnimation["trigger"] })} options={TRIGGERS} />
                      <SimpleSelect size="sm" aria-label="Animation direction" value={animation.direction ?? "left"} disabled={!(["slide", "rise"] as string[]).includes(animation.preset)}
                        onValueChange={(value) => updateAnimation(element.id, animation.id, { direction: value as ElementAnimation["direction"] })} options={DIRECTIONS} />
                      <NumberField label="Time" value={animation.durationMs / 1000} min={0.1} max={30} onCommit={(value) => updateAnimation(element.id, animation.id, { durationMs: Math.round(value * 1000) })} />
                      <NumberField label="Delay" value={animation.delayMs / 1000} min={0} max={30} onCommit={(value) => updateAnimation(element.id, animation.id, { delayMs: Math.round(value * 1000) })} />
                    </div>
                    <Field label="Easing"><SimpleSelect size="sm" aria-label="Animation easing" value={animation.easing} onValueChange={(value) => updateAnimation(element.id, animation.id, { easing: value as ElementAnimation["easing"] })} options={EASINGS} /></Field>
                    {animation.category === "motion-path" && <div className="grid grid-cols-2 gap-2">
                      <NumberField label="Path X" value={animation.path?.[animation.path.length - 1]?.x ?? 200} min={-10000} max={10000} step={10} onCommit={(value) => updateAnimation(element.id, animation.id, { path: [{ x: value, y: animation.path?.[animation.path.length - 1]?.y ?? 0 }] })} />
                      <NumberField label="Path Y" value={animation.path?.[animation.path.length - 1]?.y ?? 0} min={-10000} max={10000} step={10} onCommit={(value) => updateAnimation(element.id, animation.id, { path: [{ x: animation.path?.[animation.path.length - 1]?.x ?? 200, y: value }] })} />
                    </div>}
                    {element.type === "text" && <label className="flex items-center gap-2 text-xs"><Checkbox checked={animation.byParagraph} onCheckedChange={(checked) => updateAnimation(element.id, animation.id, { byParagraph: checked === true })} />By paragraph</label>}
                  </div>}
                </div>
              );
            })}
          </div>
        ) : <p className="text-[11px] text-muted-foreground">No object animations on this slide yet. Select one or more elements to add an animation.</p>}
        {selected.length > 0 && <>
          <p className="text-[10px] text-muted-foreground">Add to {selected.length === 1 ? selected[0]!.name || selected[0]!.type : `${selected.length} selected elements`}</p>
          <div className="grid grid-cols-2 gap-2">
            <SimpleSelect size="sm" aria-label="New animation category" value={category} onValueChange={(value) => setCategory(value as typeof category)} options={[{ value: "entrance", label: "Entrance" }, { value: "exit", label: "Exit" }, { value: "emphasis", label: "Emphasis" }, { value: "motion-path", label: "Motion path" }]} />
            <SimpleSelect size="sm" aria-label="New animation effect" value={preset} onValueChange={(value) => setPreset(value as ElementAnimation["preset"])} options={PRESETS} />
            <SimpleSelect size="sm" aria-label="New animation start" value={trigger} onValueChange={(value) => setTrigger(value as ElementAnimation["trigger"])} options={TRIGGERS} />
            <SimpleSelect size="sm" aria-label="New animation direction" value={direction} disabled={!(["slide", "rise"] as string[]).includes(preset)} onValueChange={(value) => setDirection(value as typeof direction)} options={DIRECTIONS} />
            <NumberField label="Time" value={duration / 1000} min={0.1} max={30} onCommit={(value) => setDuration(Math.round(value * 1000))} />
            <NumberField label="Delay" value={delay / 1000} min={0} max={30} onCommit={(value) => setDelay(Math.round(value * 1000))} />
          </div>
          <Field label="Easing"><SimpleSelect size="sm" aria-label="New animation easing" value={newEasing} onValueChange={(value) => setNewEasing(value as ElementAnimation["easing"])} options={EASINGS} /></Field>
          {category === "motion-path" && <div className="grid grid-cols-2 gap-2">
            <NumberField label="Path X" value={pathX} min={-10000} max={10000} step={10} onCommit={setPathX} />
            <NumberField label="Path Y" value={pathY} min={-10000} max={10000} step={10} onCommit={setPathY} />
          </div>}
          {selected.length === 1 && selected[0]!.type === "text" && <label className="flex items-center gap-2 text-xs"><Checkbox checked={byParagraph} onCheckedChange={(checked) => setByParagraph(checked === true)} />By paragraph</label>}
          <Button size="sm" variant="outline" onClick={addAnimations}><HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />Add animation</Button>
        </>}
        <Button size="sm" onClick={onPlay}><HugeiconsIcon icon={PlayIcon} data-icon="inline-start" />Play</Button>
      </Section>
    </div>
  );
}
