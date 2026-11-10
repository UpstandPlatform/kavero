"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, AlignEndHorizontalIcon, AlignEndVerticalIcon, AlignHorizontalCenterIcon, AlignHorizontalDistributeCenterIcon, AlignStartHorizontalIcon, AlignStartVerticalIcon, AlignVerticalCenterIcon, AlignVerticalDistributeCenterIcon, ArrowDown01Icon, ArrowDownToLineIcon, ArrowUp01Icon, ArrowUpToLineIcon, Cancel01Icon, Delete02Icon, LockIcon, PencilIcon, ReplaceIcon, SquareUnlock01Icon, Tag01Icon, TextAlignCenterIcon, TextAlignLeftIcon, TextAlignRightIcon, ViewIcon, ViewOffIcon } from "@hugeicons/core-free-icons";
import { cardDisplay, documentDirection, resolveToken, type CatalogDocument, type CatalogElement, type CatalogSlide } from "@Kavero/catalog-engine";
import type { Editor, EditorCommand } from "@Kavero/editor-core";
import { Button } from "@Kavero/ui/components/button";
import { Checkbox } from "@Kavero/ui/components/checkbox";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@Kavero/ui/components/select";
import { SimpleSelect } from "@Kavero/ui/components/simple-select";
import { ColorPicker } from "@Kavero/ui/components/color-picker";
import { TooltipHint } from "@Kavero/ui/components/tooltip";
import { useEffect, useState, type ReactNode } from "react";

import { matchMorph, slideDurationMs } from "@Kavero/animation-engine";

import { kbd } from "./editor-actions";
import { FontPicker, type AddFont } from "./font-picker";
import { ProductThumb, productPrice, type ProductUi } from "./product-picker";
import { useRun } from "./use-catalog-editor";

const FONTS = ["Inter", "Playfair Display", "Space Grotesk", "DM Serif Display", "Montserrat", "Lora", "Poppins", "Roboto", "Georgia", "Arial"];

// Compact (h-7) control used throughout the inspector; same radius/focus ring as Button size="sm" and SimpleSelect size="sm".
const inputCls = "h-7 w-full min-w-0 rounded-[min(var(--radius-md),10px)] border border-input bg-transparent px-2 text-xs tabular-nums transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/** Font family picker: theme tokens, catalog fonts, web fonts, then "From this computer…". */
function FontSelect({ doc, catalogFonts, value, onChange }: { doc: CatalogDocument; catalogFonts: string[]; value: string; onChange: (v: string) => void }) {
  const web = FONTS.filter((f) => !catalogFonts.includes(f));
  const custom = !catalogFonts.includes(value) && !FONTS.includes(value) && !value.startsWith("token:") ? value : null;
  const items = [
    { value: "token:heading", label: `Theme heading (${doc.theme.fonts.heading})` },
    { value: "token:body", label: `Theme body (${doc.theme.fonts.body})` },
    ...catalogFonts.map((f) => ({ value: f, label: f })),
    ...web.map((f) => ({ value: f, label: f })),
    ...(custom ? [{ value: custom, label: custom }] : []),
    { value: "__computer", label: "From this computer…" },
  ];
  return (
    <Select items={items} value={value} onValueChange={(v) => v !== null && onChange(v)}>
      <SelectTrigger size="sm" aria-label="Font" className="w-full min-w-0 gap-1 pr-1.5 pl-2 text-xs">
        <SelectValue className="min-w-0 truncate" />
      </SelectTrigger>
      <SelectContent className="**:data-[slot=select-item]:text-xs">
        <SelectGroup>
          <SelectItem value="token:heading">{items[0]!.label}</SelectItem>
          <SelectItem value="token:body">{items[1]!.label}</SelectItem>
        </SelectGroup>
        {catalogFonts.length > 0 && (
          <SelectGroup>
            <SelectLabel>In this catalog</SelectLabel>
            {catalogFonts.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
          </SelectGroup>
        )}
        <SelectGroup>
          <SelectLabel>Web fonts</SelectLabel>
          {web.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          {custom && <SelectItem value={custom}>{custom}</SelectItem>}
          <SelectItem value="__computer">From this computer…</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b px-3 py-3">
      <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2">{children}</div>
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
function ColorInput({ doc, value, onChange, label }: { doc: CatalogDocument; value: string; onChange: (v: string) => void; label: string }) {
  const resolved = resolveToken(doc, value);
  return (
    <ColorPicker
      value={value.startsWith("token:") ? value : /^#[0-9a-f]{6}$/i.test(resolved) ? resolved : "#000000"}
      onValueChange={onChange}
      label={label}
      swatches={Object.entries(doc.theme.colors).map(([name, color]) => ({ label: `Theme ${name}`, value: `token:${name}`, color }))}
    />
  );
}

export function PropertiesPanel({ editor, doc, slide, selection, addFont, assetUrls, productUi }: {
  editor: Editor; doc: CatalogDocument; slide: CatalogSlide; selection: string[]; addFont: AddFont; assetUrls: Record<string, string>; productUi: ProductUi;
}) {
  const run = useRun(editor);
  const [fontPickerFor, setFontPickerFor] = useState<string | null>(null);
  const rtl = documentDirection(doc) === "rtl";
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
            <HugeiconsIcon icon={Delete02Icon} /> Delete
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
          <Button variant="ghost" size="icon-sm" title={el.locked ? "Unlock" : "Lock"} onClick={() => update({ locked: !el.locked })}>{el.locked ? <HugeiconsIcon icon={LockIcon} /> : <HugeiconsIcon icon={SquareUnlock01Icon} />}</Button>
          <Button variant="ghost" size="icon-sm" title={el.hidden ? "Show" : "Hide"} onClick={() => update({ hidden: !el.hidden })}>{el.hidden ? <HugeiconsIcon icon={ViewOffIcon} /> : <HugeiconsIcon icon={ViewIcon} />}</Button>
          <Button variant="ghost" size="icon-sm" title="Delete" onClick={() => run({ type: "element.delete", elementId: el.id })}><HugeiconsIcon icon={Delete02Icon} /></Button>
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
          {([["front", ArrowUpToLineIcon, "Bring to front"], ["forward", ArrowUp01Icon, "Bring forward"], ["backward", ArrowDown01Icon, "Send backward"], ["back", ArrowDownToLineIcon, "Send to back"]] as const).map(([to, Icon, label]) => (
            <Button key={to} variant="outline" size="icon-sm" title={label} onClick={() => run({ type: "element.reorder", elementId: el.id, to })}><HugeiconsIcon icon={Icon} /></Button>
          ))}
        </div>
      </Section>

      {el.type === "text" && (
        <Section title="Text">
          <Field label="Font">
            <FontSelect doc={doc} catalogFonts={catalogFonts} value={el.style.fontFamily}
              onChange={(v) => (v === "__computer" ? setFontPickerFor(el.id) : update({ style: { fontFamily: v } }))} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field compact label="Size"><NumberInput value={el.style.fontSize} min={4} max={800} onCommit={(fontSize) => update({ style: { fontSize } })} /></Field>
            <Field compact label="Weight">
              <SimpleSelect size="sm" aria-label="Weight" value={String(el.style.fontWeight)} onValueChange={(v) => update({ style: { fontWeight: Number(v) } })}
                options={[300, 400, 500, 600, 700, 800, 900].map((w) => ({ value: String(w), label: w }))} />
            </Field>
            <Field compact label="Line"><NumberInput value={el.style.lineHeight} min={0.5} max={4} step={0.05} onCommit={(lineHeight) => update({ style: { lineHeight } })} /></Field>
            <Field compact label="Spacing"><NumberInput value={el.style.letterSpacing} step={0.5} onCommit={(letterSpacing) => update({ style: { letterSpacing } })} /></Field>
          </div>
          <Field label="Color"><ColorInput doc={doc} value={el.style.color} label="Text color" onChange={(color) => update({ style: { color } })} /></Field>
          <div className="flex gap-1">
            {/* start/end follow the text direction, so RTL catalogs mirror correctly */}
            {([["start", rtl ? TextAlignRightIcon : TextAlignLeftIcon, "Align to start"], ["center", TextAlignCenterIcon, "Center"], ["end", rtl ? TextAlignLeftIcon : TextAlignRightIcon, "Align to end"]] as const).map(([a, Icon, label]) => (
              <Button key={a} variant={el.style.align === a || (a === "start" && el.style.align === (rtl ? "right" : "left")) || (a === "end" && el.style.align === (rtl ? "left" : "right")) ? "secondary" : "ghost"} size="icon-sm" title={label} onClick={() => update({ style: { align: a } })}><HugeiconsIcon icon={Icon} /></Button>
            ))}
            <Button variant={el.style.italic ? "secondary" : "ghost"} size="icon-sm" title="Italic" className="italic" onClick={() => update({ style: { italic: !el.style.italic } })}>I</Button>
            <Button variant={el.style.decoration === "underline" ? "secondary" : "ghost"} size="icon-sm" title="Underline" className="underline" onClick={() => update({ style: { decoration: el.style.decoration === "underline" ? "none" : "underline" } })}>U</Button>
          </div>
          <Field label="Direction">
            <SimpleSelect size="sm" aria-label="Direction" value={el.style.direction} onValueChange={(direction) => update({ style: { direction } })}
              options={[{ value: "auto", label: "Automatic (from the text)" }, { value: "rtl", label: "Right to left" }, { value: "ltr", label: "Left to right (e.g. phone numbers)" }]} />
          </Field>
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
            <SimpleSelect size="sm" aria-label="Shape" value={el.content.shape} onValueChange={(shape) => update({ content: { shape } })}
              options={["rect", "ellipse", "triangle", "line", "arrow"].map((s) => ({ value: s, label: s }))} />
          </Field>
          <Field label="Fill"><ColorInput doc={doc} value={el.style.fill} label="Shape fill" onChange={(fill) => update({ style: { fill } })} /></Field>
          <Field label="Border"><ColorInput doc={doc} value={el.style.stroke ?? "#000000"} label="Shape border" onChange={(stroke) => update({ style: { stroke, strokeWidth: el.style.strokeWidth || 2 } })} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field compact label="Width"><NumberInput value={el.style.strokeWidth} min={0} max={100} onCommit={(strokeWidth) => update({ style: { strokeWidth } })} /></Field>
            <Field compact label="Radius"><NumberInput value={el.style.borderRadius} min={0} onCommit={(borderRadius) => update({ style: { borderRadius } })} /></Field>
          </div>
        </Section>
      )}

      {el.type === "image" && (
        <Section title="Image">
          <Field label="Fit">
            <SimpleSelect size="sm" aria-label="Fit" value={el.style.fit} onValueChange={(fit) => update({ style: { fit } })}
              options={[{ value: "cover", label: "Fill (crop)" }, { value: "contain", label: "Fit" }, { value: "fill", label: "Stretch" }]} />
          </Field>
          <Field label="Radius"><NumberInput value={el.style.borderRadius} min={0} onCommit={(borderRadius) => update({ style: { borderRadius } })} /></Field>
          <Field label="Alt text">
            <input className={inputCls} defaultValue={el.content.alt} key={el.id} onBlur={(e) => e.target.value !== el.content.alt && update({ content: { alt: e.target.value } })} placeholder="Describe the image" />
          </Field>
          <Field label="Grayscale"><NumberInput value={Math.round((el.style.filters?.grayscale ?? 0) * 100)} min={0} max={100} suffix="%" onCommit={(v) => update({ style: { filters: { brightness: 1, contrast: 1, saturate: 1, ...el.style.filters, grayscale: v / 100 } } })} /></Field>
        </Section>
      )}

      {(el.type === "product" || el.type === "product-grid") && <ProductProperties doc={doc} el={el} run={run} update={update} assetUrls={assetUrls} ui={productUi} />}

      {el.type === "html" && (
        <Section title="HTML & CSS">
          <CodeField key={`${el.id}-html`} label="HTML" value={el.content.html} rows={8} onCommit={(html) => update({ content: { html } })} />
          <CodeField key={`${el.id}-css`} label="CSS" value={el.content.css} rows={6} onCommit={(css) => update({ content: { css } })} />
          <Field label="Background"><ColorInput doc={doc} value={el.style.background ?? "#ffffff"} label="Element background" onChange={(background) => update({ style: { background } })} /></Field>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Theme colors are CSS variables, e.g. <code>var(--kv-primary)</code> and fonts <code>var(--kv-heading)</code>. Scripts, forms and embedded frames are removed; images must use https or data URLs.
          </p>
        </Section>
      )}

      <AnimationProperties el={el} run={run} />
    </div>
  );
}

const ALIGN_BUTTONS = [
  ["l", AlignStartVerticalIcon, "Align left", "Alt+A"],
  ["c", AlignVerticalCenterIcon, "Align center", "Alt+H"],
  ["r", AlignEndVerticalIcon, "Align right", "Alt+D"],
  ["t", AlignStartHorizontalIcon, "Align top", "Alt+W"],
  ["m", AlignHorizontalCenterIcon, "Align middle", "Alt+V"],
  ["b", AlignEndHorizontalIcon, "Align bottom", "Alt+S"],
] as const;

const segment = "inline-flex overflow-hidden rounded-[min(var(--radius-md),10px)] border border-input divide-x divide-input";
const segmentBtn = "grid size-7 place-items-center text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-4";

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
  const target = single ? "to slide" : "selection";
  // Alignment is physical (x/y on the page), so the buttons keep left-to-right order in RTL catalogs too.
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="me-auto text-xs text-muted-foreground">Align {target}</span>
      <div className="flex gap-1" role="toolbar" aria-label={`Align ${target}`} dir="ltr">
        {[ALIGN_BUTTONS.slice(0, 3), ALIGN_BUTTONS.slice(3)].map((group, gi) => (
          <div key={gi} className={segment} role="group" aria-label={gi === 0 ? "Horizontal" : "Vertical"}>
            {group.map(([k, Icon, label, keys]) => (
            <TooltipHint key={k} content={`${label} (${kbd(keys)})`}><button type="button" className={segmentBtn} onClick={() => align(k)} aria-label={`${label} ${target} (${kbd(keys)})`} aria-keyshortcuts={keys}>
                <HugeiconsIcon icon={Icon} aria-hidden />
            </button></TooltipHint>
            ))}
          </div>
        ))}
        {elements.length > 2 && (
          <div className={segment} role="group" aria-label="Distribute">
            <TooltipHint content="Distribute horizontally"><button type="button" className={segmentBtn} onClick={() => distribute("x")} aria-label="Distribute horizontally"><HugeiconsIcon icon={AlignHorizontalDistributeCenterIcon} aria-hidden /></button></TooltipHint>
            <TooltipHint content="Distribute vertically"><button type="button" className={segmentBtn} onClick={() => distribute("y")} aria-label="Distribute vertically"><HugeiconsIcon icon={AlignVerticalDistributeCenterIcon} aria-hidden /></button></TooltipHint>
          </div>
        )}
      </div>
    </div>
  );
}

const CARD_OPTIONS = [
  ["showImage", "Image"], ["showName", "Name"], ["showBrand", "Brand"], ["showSubtitle", "Subtitle"],
  ["showPrice", "Price"], ["showCompareAtPrice", "Compare-at price"], ["showBadge", "Badge"], ["showAvailability", "Availability"],
  ["showRating", "Rating"], ["showSku", "SKU"], ["showDescription", "Description"], ["showAttributes", "Specs"], ["showLink", "View product link"],
] as const;

function ProductProperties({ doc, el, run, update, assetUrls, ui }: {
  doc: CatalogDocument;
  el: Extract<CatalogElement, { type: "product" | "product-grid" }>;
  run: (c: EditorCommand) => unknown;
  update: (c: Record<string, unknown>) => unknown;
  assetUrls: Record<string, string>;
  ui: ProductUi;
}) {
  const display = cardDisplay(el.style);
  const byId = new Map(doc.products.map((p) => [p.id, p]));
  // Arrays replace rather than merge, so always send the whole list.
  const setGrid = (ids: string[]) => run({ type: "element.update", elementId: el.id, changes: { content: { products: ids.map((productId) => ({ productId })) } } });
  const gridIds = el.type === "product-grid" ? el.content.products.map((p) => p.productId) : [];
  const moveInGrid = (i: number, by: number) => {
    const next = [...gridIds];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    setGrid(next);
  };
  const current = el.type === "product" ? byId.get(el.content.productId) : undefined;
  const chooseProduct = () => ui.pick({
    multiple: false, initial: current ? [current.id] : [], title: "Show a different product", confirmLabel: "Use this product",
    onConfirm: ([id]) => id && update({ content: { productId: id } }),
  });

  return (
    <>
      {el.type === "product" ? (
        <Section title="Product">
          {!current ? (
            <>
              <p className="text-[11px] text-muted-foreground">No product chosen for this card.</p>
              <Button variant="outline" size="sm" onClick={chooseProduct} aria-haspopup="dialog"><HugeiconsIcon icon={Tag01Icon} /> Choose product…</Button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <ProductThumb product={current} assetUrls={assetUrls} />
                <div className="min-w-0 flex-1 text-xs">
                  <p className="truncate font-medium">{current.name}</p>
                  <p className="truncate text-muted-foreground">{[productPrice(doc, current), current.sku].filter(Boolean).join(" · ") || " "}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <Button variant="outline" size="sm" onClick={chooseProduct} aria-haspopup="dialog"><HugeiconsIcon icon={ReplaceIcon} /> Change…</Button>
                <Button variant="outline" size="sm" onClick={() => ui.edit(current.id)} aria-haspopup="dialog"><HugeiconsIcon icon={PencilIcon} /> Edit product</Button>
              </div>
            </>
          )}
        </Section>
      ) : (
        <Section title={`Products in grid (${gridIds.length})`}>
          <Field label="Columns"><NumberInput value={el.content.columns} min={1} max={8} onCommit={(columns) => update({ content: { columns } })} /></Field>
          {gridIds.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">This grid is empty. Add products to fill it.</p>
          ) : (
            <ol className="grid max-h-56 gap-0.5 overflow-y-auto">
              {gridIds.map((id, i) => {
                const p = byId.get(id);
                const name = p?.name ?? "Missing product";
                return (
                  <li key={`${id}-${i}`} className="group flex items-center gap-1.5 rounded-md py-0.5 text-xs hover:bg-muted/60">
                    {p ? <ProductThumb product={p} assetUrls={assetUrls} className="size-6" /> : <span className="size-6 shrink-0 rounded-md border border-dashed" />}
                    <TooltipHint content={name}><span tabIndex={0} className={`min-w-0 flex-1 truncate ${p ? "" : "text-muted-foreground italic"}`}>{name}</span></TooltipHint>
                    <span className="flex opacity-60 group-hover:opacity-100 group-focus-within:opacity-100">
                      <Button variant="ghost" size="icon-xs" title="Move earlier" aria-label={`Move ${name} earlier`} disabled={i === 0} onClick={() => moveInGrid(i, -1)}><HugeiconsIcon icon={ArrowUp01Icon} /></Button>
                      <Button variant="ghost" size="icon-xs" title="Move later" aria-label={`Move ${name} later`} disabled={i === gridIds.length - 1} onClick={() => moveInGrid(i, 1)}><HugeiconsIcon icon={ArrowDown01Icon} /></Button>
                      {p && <Button variant="ghost" size="icon-xs" title="Edit product" aria-label={`Edit ${name}`} onClick={() => ui.edit(id)}><HugeiconsIcon icon={PencilIcon} /></Button>}
                      <Button variant="ghost" size="icon-xs" title="Remove from grid" aria-label={`Remove ${name} from grid`} onClick={() => setGrid(gridIds.filter((_, j) => j !== i))}><HugeiconsIcon icon={Cancel01Icon} /></Button>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          <Button variant="outline" size="sm" aria-haspopup="dialog"
            onClick={() => ui.pick({ multiple: true, initial: gridIds, title: "Products in this grid", confirmLabel: "Update grid", onConfirm: setGrid })}>
            <HugeiconsIcon icon={Add01Icon} /> Add or reorder products…
          </Button>
        </Section>
      )}

      <Section title="Card shows">
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          {CARD_OPTIONS.map(([key, label]) => (
            <label key={key} className="flex min-w-0 cursor-pointer items-center gap-2 text-xs">
              <Checkbox checked={display[key]} onCheckedChange={(checked) => update({ style: { [key]: checked } })} />
              <span className="truncate">{label}</span>
            </label>
          ))}
        </div>
        {display.showAttributes && (
          <Field label="Max specs"><NumberInput value={display.maxAttributes} min={1} max={20} onCommit={(maxAttributes) => update({ style: { maxAttributes } })} /></Field>
        )}
        <Field label="Layout">
          <SimpleSelect size="sm" aria-label="Layout" value={el.style.layout === "horizontal" ? "horizontal" : "vertical"} onValueChange={(layout) => update({ style: { layout } })}
            options={[{ value: "vertical", label: "Photo on top" }, { value: "horizontal", label: "Photo beside text" }]} />
        </Field>
        <Field label="Photo fit">
          <SimpleSelect size="sm" aria-label="Photo fit" value={el.style.imageFit} onValueChange={(imageFit) => update({ style: { imageFit } })}
            options={[{ value: "contain", label: "Show whole photo" }, { value: "cover", label: "Fill and crop" }]} />
        </Field>
        <Field label="Radius"><NumberInput value={el.style.borderRadius} min={0} onCommit={(borderRadius) => update({ style: { borderRadius } })} /></Field>
        {el.type === "product-grid" && <Field label="Gap"><NumberInput value={el.style.gap} min={0} max={400} onCommit={(gap) => update({ style: { gap } })} /></Field>}
        <p className="text-[11px] text-muted-foreground">Fields a product doesn’t have are skipped, so cards never show empty gaps.</p>
      </Section>
    </>
  );
}

const TRANSITIONS = [["none", "None"], ["fade", "Fade"], ["morph", "Morph"], ["slide", "Slide"], ["push", "Push"], ["zoom", "Zoom"], ["wipe", "Wipe"], ["flip", "Flip"]] as const;

function SlideProperties({ doc, slide, run }: { doc: CatalogDocument; slide: CatalogSlide; run: (c: EditorCommand) => unknown }) {
  const slideIndex = doc.slides.findIndex((s) => s.id === slide.id);
  const prevSlide = slideIndex > 0 ? doc.slides[slideIndex - 1] : undefined;
  const morphCount = slide.transition?.type === "morph" && prevSlide ? matchMorph(prevSlide, slide).length : 0;
  const bg = slide.background;
  return (
    <div>
      <Section title="Slide">
        <Field label="Name">
          <input key={slide.id} className={inputCls} defaultValue={slide.name} onBlur={(e) => e.target.value.trim() && e.target.value !== slide.name && run({ type: "slide.update", slideId: slide.id, changes: { name: e.target.value.trim() } })} />
        </Field>
        <Field label="Background">
          <ColorInput doc={doc} value={bg.kind === "color" ? bg.color : "#ffffff"} label="Slide background" onChange={(color) => run({ type: "slide.update", slideId: slide.id, changes: { background: { kind: "color", color } } })} />
        </Field>
        <Field label="Transition">
          <SimpleSelect
            size="sm"
            aria-label="Transition"
            value={slide.transition?.type ?? "none"}
            onValueChange={(v) => run({ type: "slide.setTransition", slideId: slide.id, transition: v === "none" ? null : { type: v as never, ...(v === "morph" ? { durationMs: 900 } : {}) } })}
            options={TRANSITIONS.map(([value, label]) => ({ value, label }))}
          />
        </Field>
        {slide.transition?.type === "morph" && (
          <p className="-mt-1 text-xs text-muted-foreground">
            {slideIndex === 0
              ? "Morph plays when arriving from the previous slide — this is the first slide."
              : `Elements also on the previous slide move into place (${morphCount} matched). Duplicate a slide or copy elements across to match more.`}
          </p>
        )}
        {slide.transition && slide.transition.type !== "none" && (
          <div className="grid grid-cols-2 gap-2">
            <Field compact label="Time"><NumberInput value={slide.transition.durationMs / 1000} min={0.1} max={10} step={0.1} suffix="s" onCommit={(v) => run({ type: "slide.setTransition", slideId: slide.id, transition: { durationMs: Math.round(v * 1000) } })} /></Field>
            {slide.transition.type !== "morph" && slide.transition.type !== "fade" && <Field compact label="From">
              <SimpleSelect size="sm" aria-label="From" value={slide.transition.direction ?? "left"} onValueChange={(v) => run({ type: "slide.setTransition", slideId: slide.id, transition: { direction: v as never } })}
                options={["left", "right", "up", "down"].map((d) => ({ value: d, label: d }))} />
            </Field>}
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
            <ColorPicker value={hex} onValueChange={(color) => run({ type: "catalog.updateTheme", theme: { colors: { [name]: color } } })} label={`${name} theme color`} className="w-full" />
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
        className="w-full resize-y rounded-lg border border-input bg-transparent p-2 font-mono text-[11px] leading-snug transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
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
  return (
    <Section title="Animation">
      {el.animations.length === 0 && <p className="text-[11px] text-muted-foreground">No animations yet. They play in Preview, on published sites and in video exports.</p>}
      {el.animations.map((a, i) => (
        <div key={a.id} className="flex items-center gap-2 text-xs">
          <span className="tabular-nums text-muted-foreground">{i + 1}</span>
          <span className="flex-1 truncate capitalize">{a.category} · {a.preset}{a.direction && a.preset === "slide" ? ` ${a.direction}` : ""}</span>
          <span className="tabular-nums text-muted-foreground">{(a.durationMs / 1000).toFixed(1)}s</span>
          <Button variant="ghost" size="icon-xs" title="Remove animation" onClick={() => run({ type: "element.removeAnimation", elementId: el.id, animationId: a.id })}><HugeiconsIcon icon={Delete02Icon} /></Button>
        </div>
      ))}
      <div className="grid grid-cols-2 gap-1">
        <SimpleSelect size="sm" aria-label="Animation type" value={category} onValueChange={(v) => setCategory(v as never)}
          options={[{ value: "entrance", label: "Entrance" }, { value: "exit", label: "Exit" }, { value: "emphasis", label: "Emphasis" }]} />
        <SimpleSelect size="sm" aria-label="Effect" value={preset} onValueChange={setPreset} options={PRESETS.map((p) => ({ value: p, label: p }))} />
        <SimpleSelect size="sm" aria-label="Start" value={trigger} onValueChange={setTrigger}
          options={[{ value: "on-enter", label: "With slide" }, { value: "after-previous", label: "After previous" }, { value: "with-previous", label: "With previous" }]} />
        <SimpleSelect size="sm" aria-label="Direction" value={direction} onValueChange={setDirection} disabled={preset !== "slide"}
          options={(["up", "down", "left", "right"] as const).map((d) => ({ value: d, label: d }))} />
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
