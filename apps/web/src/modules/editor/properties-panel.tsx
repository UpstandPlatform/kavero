"use client";

import { resolveToken, type CatalogDocument, type CatalogElement, type CatalogSlide } from "@Kavero/catalog-engine";
import type { Editor, EditorCommand } from "@Kavero/editor-core";
import { Button } from "@Kavero/ui/components/button";
import {
  AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, Eye, EyeOff, Lock, Trash2, Unlock,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { slideDurationMs } from "@Kavero/animation-engine";

import { FontPicker, type AddFont } from "./font-picker";
import { useRun } from "./use-catalog-editor";

const FONTS = ["Inter", "Playfair Display", "Space Grotesk", "DM Serif Display", "Montserrat", "Lora", "Poppins", "Roboto", "Georgia", "Arial"];

const inputCls = "h-7 w-full min-w-0 border border-input bg-transparent px-1.5 text-xs tabular-nums outline-none focus-visible:border-ring";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b px-3 py-3">
      <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

function Field({ label, children, compact }: { label: string; children: ReactNode; compact?: boolean }) {
  return (
    <label className={`grid items-center gap-2 text-xs ${compact ? "grid-cols-[auto_minmax(0,1fr)]" : "grid-cols-[72px_minmax(0,1fr)]"}`}>
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** Number input that commits on blur/Enter so typing doesn't spam history. */
function NumberInput({ value, onCommit, min, max, step = 1, suffix }: { value: number; onCommit: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(Math.round(value * 100) / 100)), [value]);
  const commit = () => {
    let v = Number(draft);
    if (!Number.isFinite(v)) return setDraft(String(value));
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    if (v !== value) onCommit(v);
    else setDraft(String(value));
  };
  return (
    <div className="relative">
      <input
        type="number" className={`${inputCls} ${suffix ? "pr-4" : ""} [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none`} value={draft} step={step} min={min} max={max}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      />
      {suffix && <span className="pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 text-[10px] text-muted-foreground">{suffix}</span>}
    </div>
  );
}

/** Color picker with theme swatches; stores "token:x" when a swatch is chosen. */
function ColorInput({ doc, value, onChange }: { doc: CatalogDocument; value: string; onChange: (v: string) => void }) {
  const resolved = resolveToken(doc, value);
  return (
    <div className="flex items-center gap-1">
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(resolved) ? resolved : "#000000"} onChange={(e) => onChange(e.target.value)} className="h-7 w-8 shrink-0 cursor-pointer border border-input bg-transparent p-0.5" aria-label="Custom color" />
      <div className="flex flex-wrap gap-0.5">
        {Object.entries(doc.theme.colors).map(([name, hex]) => (
          <button
            key={name} type="button" title={`Theme: ${name}`} onClick={() => onChange(`token:${name}`)}
            className="size-4 border border-black/20 aria-pressed:ring-2 aria-pressed:ring-sky-500"
            aria-pressed={value === `token:${name}`}
            style={{ background: hex }}
          />
        ))}
      </div>
    </div>
  );
}

export function PropertiesPanel({ editor, doc, slide, selection, addFont }: { editor: Editor; doc: CatalogDocument; slide: CatalogSlide; selection: string[]; addFont: AddFont }) {
  const run = useRun(editor);
  const [fontPickerFor, setFontPickerFor] = useState<string | null>(null);
  const catalogFonts = [...new Set(doc.assets.filter((a) => a.kind === "font" && a.family).map((a) => a.family!))].sort();
  const selected = slide.elements.filter((e) => selection.includes(e.id));

  if (selected.length === 0) return <SlideProperties doc={doc} slide={slide} run={run} />;
  if (selected.length > 1) {
    return (
      <Section title={`${selected.length} elements`}>
        <AlignTools elements={selected} run={run} doc={doc} />
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={() => run({ type: "element.group", elementIds: selected.map((e) => e.id) })}>Group</Button>
          {selected[0]?.groupId && selected.every((e) => e.groupId === selected[0]!.groupId) && (
            <Button variant="outline" size="sm" onClick={() => run({ type: "element.ungroup", groupId: selected[0]!.groupId! })}>Ungroup</Button>
          )}
          <Button variant="destructive" size="sm" onClick={() => run({ type: "batch", commands: selected.map((e) => ({ type: "element.delete", elementId: e.id })) })}>
            <Trash2 /> Delete
          </Button>
        </div>
      </Section>
    );
  }

  const el = selected[0]!;
  const update = (changes: Record<string, unknown>) => run({ type: "element.update", elementId: el.id, changes });
  const move = (position: Record<string, number>) => run({ type: "element.move", elementId: el.id, position });

  return (
    <div>
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-semibold capitalize">{el.type.replace("-", " ")}</span>
        <div className="flex">
          <Button variant="ghost" size="icon-sm" title={el.locked ? "Unlock" : "Lock"} onClick={() => update({ locked: !el.locked })}>{el.locked ? <Lock /> : <Unlock />}</Button>
          <Button variant="ghost" size="icon-sm" title={el.hidden ? "Show" : "Hide"} onClick={() => update({ hidden: !el.hidden })}>{el.hidden ? <EyeOff /> : <Eye />}</Button>
          <Button variant="ghost" size="icon-sm" title="Delete" onClick={() => run({ type: "element.delete", elementId: el.id })}><Trash2 /></Button>
        </div>
      </div>

      <Section title="Position">
        <div className="grid grid-cols-2 gap-2">
          <Field compact label="X"><NumberInput value={el.position.x} onCommit={(x) => move({ x })} /></Field>
          <Field compact label="Y"><NumberInput value={el.position.y} onCommit={(y) => move({ y })} /></Field>
          <Field compact label="W"><NumberInput value={el.position.width} min={1} onCommit={(width) => move({ width })} /></Field>
          <Field compact label="H"><NumberInput value={el.position.height} min={1} onCommit={(height) => move({ height })} /></Field>
        </div>
        <Field label="Rotation"><NumberInput value={el.position.rotation} min={-360} max={360} suffix="°" onCommit={(rotation) => move({ rotation })} /></Field>
        <Field label="Opacity"><NumberInput value={Math.round(el.opacity * 100)} min={0} max={100} suffix="%" onCommit={(v) => update({ opacity: v / 100 })} /></Field>
        <AlignTools elements={[el]} run={run} doc={doc} />
        <div className="flex gap-1">
          <span className="mr-auto self-center text-xs text-muted-foreground">Layer</span>
          {([["front", ArrowUpToLine, "Bring to front"], ["forward", ArrowUp, "Bring forward"], ["backward", ArrowDown, "Send backward"], ["back", ArrowDownToLine, "Send to back"]] as const).map(([to, Icon, label]) => (
            <Button key={to} variant="outline" size="icon-sm" title={label} onClick={() => run({ type: "element.reorder", elementId: el.id, to })}><Icon /></Button>
          ))}
        </div>
      </Section>

      {el.type === "text" && (
        <Section title="Text">
          <Field label="Font">
            <select
              className={inputCls}
              value={el.style.fontFamily}
              onChange={(e) => (e.target.value === "__computer" ? setFontPickerFor(el.id) : update({ style: { fontFamily: e.target.value } }))}
            >
              <option value="token:heading">Theme heading ({doc.theme.fonts.heading})</option>
              <option value="token:body">Theme body ({doc.theme.fonts.body})</option>
              {catalogFonts.length > 0 && (
                <optgroup label="In this catalog">
                  {catalogFonts.map((f) => <option key={f} value={f}>{f}</option>)}
                </optgroup>
              )}
              <optgroup label="Web fonts">
                {FONTS.filter((f) => !catalogFonts.includes(f)).map((f) => <option key={f} value={f}>{f}</option>)}
              </optgroup>
              {!catalogFonts.includes(el.style.fontFamily) && !FONTS.includes(el.style.fontFamily) && !el.style.fontFamily.startsWith("token:") && (
                <option value={el.style.fontFamily}>{el.style.fontFamily}</option>
              )}
              <option value="__computer">From this computer…</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field compact label="Size"><NumberInput value={el.style.fontSize} min={4} max={800} onCommit={(fontSize) => update({ style: { fontSize } })} /></Field>
            <Field compact label="Weight">
              <select className={inputCls} value={el.style.fontWeight} onChange={(e) => update({ style: { fontWeight: Number(e.target.value) } })}>
                {[300, 400, 500, 600, 700, 800, 900].map((w) => <option key={w}>{w}</option>)}
              </select>
            </Field>
            <Field compact label="Line"><NumberInput value={el.style.lineHeight} min={0.5} max={4} step={0.05} onCommit={(lineHeight) => update({ style: { lineHeight } })} /></Field>
            <Field compact label="Spacing"><NumberInput value={el.style.letterSpacing} step={0.5} onCommit={(letterSpacing) => update({ style: { letterSpacing } })} /></Field>
          </div>
          <Field label="Color"><ColorInput doc={doc} value={el.style.color} onChange={(color) => update({ style: { color } })} /></Field>
          <div className="flex gap-1">
            {([["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight]] as const).map(([a, Icon]) => (
              <Button key={a} variant={el.style.align === a ? "secondary" : "ghost"} size="icon-sm" title={`Align ${a}`} onClick={() => update({ style: { align: a } })}><Icon /></Button>
            ))}
            <Button variant={el.style.italic ? "secondary" : "ghost"} size="icon-sm" title="Italic" className="italic" onClick={() => update({ style: { italic: !el.style.italic } })}>I</Button>
            <Button variant={el.style.decoration === "underline" ? "secondary" : "ghost"} size="icon-sm" title="Underline" className="underline" onClick={() => update({ style: { decoration: el.style.decoration === "underline" ? "none" : "underline" } })}>U</Button>
          </div>
          <p className="text-[11px] text-muted-foreground">Double-click the text on the slide to edit it.</p>
          {fontPickerFor === el.id && (
            <FontPicker
              onAdd={addFont}
              onPick={(fontFamily) => run({ type: "element.update", elementId: el.id, changes: { style: { fontFamily } } })}
              onClose={() => setFontPickerFor(null)}
            />
          )}
        </Section>
      )}

      {el.type === "shape" && (
        <Section title="Shape">
          <Field label="Shape">
            <select className={inputCls} value={el.content.shape} onChange={(e) => update({ content: { shape: e.target.value } })}>
              {["rect", "ellipse", "triangle", "line", "arrow"].map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Fill"><ColorInput doc={doc} value={el.style.fill} onChange={(fill) => update({ style: { fill } })} /></Field>
          <Field label="Border"><ColorInput doc={doc} value={el.style.stroke ?? "#000000"} onChange={(stroke) => update({ style: { stroke, strokeWidth: el.style.strokeWidth || 2 } })} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field compact label="Width"><NumberInput value={el.style.strokeWidth} min={0} max={100} onCommit={(strokeWidth) => update({ style: { strokeWidth } })} /></Field>
            <Field compact label="Radius"><NumberInput value={el.style.borderRadius} min={0} onCommit={(borderRadius) => update({ style: { borderRadius } })} /></Field>
          </div>
        </Section>
      )}

      {el.type === "image" && (
        <Section title="Image">
          <Field label="Fit">
            <select className={inputCls} value={el.style.fit} onChange={(e) => update({ style: { fit: e.target.value } })}>
              <option value="cover">Fill (crop)</option>
              <option value="contain">Fit</option>
              <option value="fill">Stretch</option>
            </select>
          </Field>
          <Field label="Radius"><NumberInput value={el.style.borderRadius} min={0} onCommit={(borderRadius) => update({ style: { borderRadius } })} /></Field>
          <Field label="Alt text">
            <input className={inputCls} defaultValue={el.content.alt} key={el.id} onBlur={(e) => e.target.value !== el.content.alt && update({ content: { alt: e.target.value } })} placeholder="Describe the image" />
          </Field>
          <Field label="Grayscale"><NumberInput value={Math.round((el.style.filters?.grayscale ?? 0) * 100)} min={0} max={100} suffix="%" onCommit={(v) => update({ style: { filters: { brightness: 1, contrast: 1, saturate: 1, ...el.style.filters, grayscale: v / 100 } } })} /></Field>
        </Section>
      )}

      {(el.type === "product" || el.type === "product-grid") && <ProductProperties doc={doc} el={el} run={run} update={update} />}

      {el.type === "html" && (
        <Section title="HTML & CSS">
          <CodeField key={`${el.id}-html`} label="HTML" value={el.content.html} rows={8} onCommit={(html) => update({ content: { html } })} />
          <CodeField key={`${el.id}-css`} label="CSS" value={el.content.css} rows={6} onCommit={(css) => update({ content: { css } })} />
          <Field label="Background"><ColorInput doc={doc} value={el.style.background ?? "#ffffff"} onChange={(background) => update({ style: { background } })} /></Field>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Theme colors are CSS variables, e.g. <code>var(--kv-primary)</code> and fonts <code>var(--kv-heading)</code>. Scripts, forms and embedded frames are removed; images must use https or data URLs.
          </p>
        </Section>
      )}

      <AnimationProperties el={el} run={run} />
    </div>
  );
}

function AlignTools({ elements, run, doc }: { elements: CatalogElement[]; run: (c: EditorCommand) => unknown; doc: CatalogDocument }) {
  // One element aligns to the slide; several align to their shared bounding box.
  const single = elements.length === 1;
  const box = single
    ? { x0: 0, y0: 0, x1: doc.settings.width, y1: doc.settings.height }
    : {
        x0: Math.min(...elements.map((e) => e.position.x)), y0: Math.min(...elements.map((e) => e.position.y)),
        x1: Math.max(...elements.map((e) => e.position.x + e.position.width)), y1: Math.max(...elements.map((e) => e.position.y + e.position.height)),
      };
  const align = (how: "l" | "c" | "r" | "t" | "m" | "b") =>
    run({
      type: "batch",
      commands: elements.filter((e) => !e.locked).map((e) => {
        const p = e.position;
        const x = how === "l" ? box.x0 : how === "c" ? (box.x0 + box.x1 - p.width) / 2 : how === "r" ? box.x1 - p.width : p.x;
        const y = how === "t" ? box.y0 : how === "m" ? (box.y0 + box.y1 - p.height) / 2 : how === "b" ? box.y1 - p.height : p.y;
        return { type: "element.move" as const, elementId: e.id, position: { x: Math.round(x), y: Math.round(y) } };
      }),
    });
  const distribute = (axis: "x" | "y") => {
    const sorted = [...elements].sort((a, b) => a.position[axis] - b.position[axis]);
    const size = axis === "x" ? "width" : "height";
    const total = sorted.reduce((s, e) => s + e.position[size], 0);
    const span = (axis === "x" ? box.x1 - box.x0 : box.y1 - box.y0) - total;
    const gap = span / (sorted.length - 1);
    let at = axis === "x" ? box.x0 : box.y0;
    run({
      type: "batch",
      commands: sorted.map((e) => {
        const cmd = { type: "element.move" as const, elementId: e.id, position: { [axis]: Math.round(at) } };
        at += e.position[size] + gap;
        return cmd;
      }),
    });
  };
  const btn = "h-7 flex-1 border border-input text-[11px] hover:bg-muted";
  return (
    <div className="grid gap-1">
      <span className="text-xs text-muted-foreground">Align {single ? "to slide" : "selection"}</span>
      <div className="flex gap-0.5">
        {([["l", "Left"], ["c", "Center"], ["r", "Right"], ["t", "Top"], ["m", "Middle"], ["b", "Bottom"]] as const).map(([k, l]) => (
          <button key={k} type="button" className={btn} onClick={() => align(k)} title={`Align ${l.toLowerCase()}`}>{l}</button>
        ))}
      </div>
      {elements.length > 2 && (
        <div className="flex gap-0.5">
          <button type="button" className={btn} onClick={() => distribute("x")}>Distribute horizontally</button>
          <button type="button" className={btn} onClick={() => distribute("y")}>Distribute vertically</button>
        </div>
      )}
    </div>
  );
}

function ProductProperties({ doc, el, run, update }: {
  doc: CatalogDocument;
  el: Extract<CatalogElement, { type: "product" | "product-grid" }>;
  run: (c: EditorCommand) => unknown;
  update: (c: Record<string, unknown>) => unknown;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const chosen = el.type === "product" ? [el.content.productId] : el.content.products.map((p) => p.productId);
  const toggle = (id: string) => {
    if (el.type === "product") return update({ content: { productId: id } });
    const next = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id];
    // Arrays replace rather than merge, so send the whole list.
    run({ type: "element.update", elementId: el.id, changes: { content: { products: next.map((productId) => ({ productId })) } } });
  };
  return (
    <Section title="Products">
      {el.type === "product-grid" && (
        <Field label="Columns"><NumberInput value={el.content.columns} min={1} max={8} onCommit={(columns) => update({ content: { columns } })} /></Field>
      )}
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={el.style.showPrice} onChange={(e) => update({ style: { showPrice: e.target.checked } })} /> Show price</label>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={el.style.showDescription} onChange={(e) => update({ style: { showDescription: e.target.checked } })} /> Show description</label>
      <div className="grid max-h-48 gap-1 overflow-y-auto">
        {doc.products.length === 0 && <p className="text-[11px] text-muted-foreground">No products yet. Add one below. (Import from MCP comes in a later phase.)</p>}
        {doc.products.map((p) => (
          <label key={p.id} className="flex items-center gap-2 text-xs">
            <input type={el.type === "product" ? "radio" : "checkbox"} name={`p-${el.id}`} checked={chosen.includes(p.id)} onChange={() => toggle(p.id)} />
            <span className="truncate">{p.name}</span>
            {p.price !== undefined && <span className="ml-auto text-muted-foreground tabular-nums">{p.price}</span>}
          </label>
        ))}
      </div>
      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          const r = run({ type: "product.upsert", product: { name: name.trim(), price: price ? Number(price) : undefined } }) as { createdIds: string[] } | null;
          const id = r?.createdIds[0];
          if (id) toggle(id);
          setName("");
          setPrice("");
        }}
      >
        <input className={inputCls} placeholder="Product name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={`${inputCls} w-16`} placeholder="Price" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
        <Button type="submit" size="sm" variant="outline">Add</Button>
      </form>
    </Section>
  );
}

function SlideProperties({ doc, slide, run }: { doc: CatalogDocument; slide: CatalogSlide; run: (c: EditorCommand) => unknown }) {
  const bg = slide.background;
  return (
    <div>
      <Section title="Slide">
        <Field label="Name">
          <input key={slide.id} className={inputCls} defaultValue={slide.name} onBlur={(e) => e.target.value.trim() && e.target.value !== slide.name && run({ type: "slide.update", slideId: slide.id, changes: { name: e.target.value.trim() } })} />
        </Field>
        <Field label="Background">
          <ColorInput doc={doc} value={bg.kind === "color" ? bg.color : "#ffffff"} onChange={(color) => run({ type: "slide.update", slideId: slide.id, changes: { background: { kind: "color", color } } })} />
        </Field>
        <Field label="Transition">
          <select
            className={inputCls}
            value={slide.transition?.type ?? "none"}
            onChange={(e) => run({ type: "slide.setTransition", slideId: slide.id, transition: e.target.value === "none" ? null : { type: e.target.value as never } })}
          >
            {["none", "fade", "slide", "push", "zoom", "wipe", "flip"].map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        {slide.transition && slide.transition.type !== "none" && (
          <div className="grid grid-cols-2 gap-2">
            <Field compact label="Time"><NumberInput value={slide.transition.durationMs / 1000} min={0.1} max={10} step={0.1} suffix="s" onCommit={(v) => run({ type: "slide.setTransition", slideId: slide.id, transition: { durationMs: Math.round(v * 1000) } })} /></Field>
            <Field compact label="From">
              <select className={inputCls} value={slide.transition.direction ?? "left"} onChange={(e) => run({ type: "slide.setTransition", slideId: slide.id, transition: { direction: e.target.value as never } })}>
                {["left", "right", "up", "down"].map((d) => <option key={d}>{d}</option>)}
              </select>
            </Field>
          </div>
        )}
        <Field label="Duration">
          <NumberInput
            value={(slide.durationMs ?? slideDurationMs(slide)) / 1000}
            min={0.5} max={600} step={0.5} suffix="s"
            onCommit={(v) => run({ type: "slide.update", slideId: slide.id, changes: { durationMs: Math.round(v * 1000) } })}
          />
        </Field>
      </Section>
      <Section title="Theme colors">
        {Object.entries(doc.theme.colors).map(([name, hex]) => (
          <Field key={name} label={name}>
            <input type="color" value={hex} className="h-7 w-full cursor-pointer border border-input bg-transparent p-0.5" onChange={(e) => run({ type: "catalog.updateTheme", theme: { colors: { [name]: e.target.value } } })} />
          </Field>
        ))}
      </Section>
      <p className="px-3 py-3 text-[11px] text-muted-foreground">
        {doc.settings.width}×{doc.settings.height}px. Select an element to edit it. Shift-click or drag across the slide to select several.
      </p>
    </div>
  );
}

/** Multi-line code box that commits on blur so typing stays one undo step. */
function CodeField({ label, value, rows, onCommit }: { label: string; value: string; rows: number; onCommit: (v: string) => void }) {
  return (
    <label className="grid gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <textarea
        defaultValue={value}
        rows={rows}
        spellCheck={false}
        onBlur={(e) => e.target.value !== value && onCommit(e.target.value)}
        className="w-full resize-y border border-input bg-transparent p-1.5 font-mono text-[11px] leading-snug outline-none focus-visible:border-ring"
      />
    </label>
  );
}

const PRESETS = ["fade", "slide", "scale", "bounce", "rotate", "blur", "float", "pulse"] as const;

function AnimationProperties({ el, run }: { el: CatalogElement; run: (c: EditorCommand) => unknown }) {
  const [category, setCategory] = useState<"entrance" | "exit" | "emphasis">("entrance");
  const [preset, setPreset] = useState<(typeof PRESETS)[number]>("fade");
  const [trigger, setTrigger] = useState<"on-enter" | "after-previous" | "with-previous">("after-previous");
  const [direction, setDirection] = useState<"left" | "right" | "up" | "down">("up");
  const [duration, setDuration] = useState(0.6);
  const [delay, setDelay] = useState(0);
  const sel = "h-7 w-full min-w-0 border border-input bg-transparent px-1 text-xs";
  return (
    <Section title="Animation">
      {el.animations.length === 0 && <p className="text-[11px] text-muted-foreground">No animations yet. They play in Preview, on published sites and in video exports.</p>}
      {el.animations.map((a, i) => (
        <div key={a.id} className="flex items-center gap-2 text-xs">
          <span className="tabular-nums text-muted-foreground">{i + 1}</span>
          <span className="flex-1 truncate capitalize">{a.category} · {a.preset}{a.direction && a.preset === "slide" ? ` ${a.direction}` : ""}</span>
          <span className="tabular-nums text-muted-foreground">{(a.durationMs / 1000).toFixed(1)}s</span>
          <Button variant="ghost" size="icon-xs" title="Remove animation" onClick={() => run({ type: "element.removeAnimation", elementId: el.id, animationId: a.id })}><Trash2 /></Button>
        </div>
      ))}
      <div className="grid grid-cols-2 gap-1">
        <select className={sel} value={category} onChange={(e) => setCategory(e.target.value as never)} aria-label="Animation type">
          <option value="entrance">Entrance</option><option value="exit">Exit</option><option value="emphasis">Emphasis</option>
        </select>
        <select className={sel} value={preset} onChange={(e) => setPreset(e.target.value as never)} aria-label="Effect">
          {PRESETS.map((p) => <option key={p}>{p}</option>)}
        </select>
        <select className={sel} value={trigger} onChange={(e) => setTrigger(e.target.value as never)} aria-label="Start">
          <option value="on-enter">With slide</option><option value="after-previous">After previous</option><option value="with-previous">With previous</option>
        </select>
        <select className={sel} value={direction} onChange={(e) => setDirection(e.target.value as never)} aria-label="Direction" disabled={preset !== "slide"}>
          {["up", "down", "left", "right"].map((d) => <option key={d}>{d}</option>)}
        </select>
        <Field compact label="Time"><NumberInput value={duration} min={0.1} max={30} step={0.1} suffix="s" onCommit={setDuration} /></Field>
        <Field compact label="Delay"><NumberInput value={delay} min={0} max={30} step={0.1} suffix="s" onCommit={setDelay} /></Field>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => run({
          type: "element.addAnimation",
          elementId: el.id,
          animation: { category, preset, trigger, direction: preset === "slide" ? direction : undefined, durationMs: Math.round(duration * 1000), delayMs: Math.round(delay * 1000), easing: category === "exit" ? "ease-in" : "ease-out" },
        })}
      >
        Add animation
      </Button>
    </Section>
  );
}
