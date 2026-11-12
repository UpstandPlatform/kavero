"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, PencilIcon } from "@hugeicons/core-free-icons";
import type { CatalogDocument, MarkdownElement, TableElement } from "@Kavero/catalog-engine";
import type { EditorCommand } from "@Kavero/editor-core";
import { Button } from "@Kavero/ui/components/button";
import { SimpleSelect } from "@Kavero/ui/components/simple-select";
import { Switch } from "@Kavero/ui/components/switch";
import { useState, type ReactNode } from "react";

import { FontPicker, type AddFont } from "../font-picker";
import { ColorInput, Field, FontSelect, NumberInput, Section } from "../properties-panel";
import { useOpenContentEditor } from "./content-editing";

const DIRECTION_OPTIONS = [{ value: "auto", label: "Automatic (from the text)" }, { value: "rtl", label: "Right to left" }, { value: "ltr", label: "Left to right" }];

interface Props<T> {
  doc: CatalogDocument;
  element: T;
  catalogFonts: string[];
  addFont: AddFont;
  update: (changes: Record<string, unknown>) => void;
  run: (command: EditorCommand) => unknown;
}

/** Font select that can also add a font from this computer. */
function ContentFontField({ label, doc, catalogFonts, addFont, value, onChange }: { label: string; doc: CatalogDocument; catalogFonts: string[]; addFont: AddFont; value: string; onChange: (value: string) => void }) {
  const [picking, setPicking] = useState(false);
  return (
    <>
      <Field label={label}><FontSelect doc={doc} catalogFonts={catalogFonts} value={value} onChange={(next) => (next === "__computer" ? setPicking(true) : onChange(next))} /></Field>
      {picking && <FontPicker onAdd={addFont} onPick={onChange} onClose={() => setPicking(false)} />}
    </>
  );
}

/** An optional color: a picker plus a button that clears it. */
function OptionalColor({ doc, label, value, fallback, onChange }: { doc: CatalogDocument; label: string; value: string | undefined; fallback: string; onChange: (value: string | null) => void }) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <div className="min-w-0 flex-1"><ColorInput doc={doc} value={value ?? fallback} label={label} onChange={onChange} /></div>
      {value && <Button variant="ghost" size="icon-sm" aria-label={`Clear ${label.toLowerCase()}`} title="Clear" onClick={() => onChange(null)}><HugeiconsIcon icon={Cancel01Icon} /></Button>}
    </div>
  );
}

function SwitchField({ label, checked, onChange, children }: { label: string; checked: boolean; onChange: (checked: boolean) => void; children?: ReactNode }) {
  return (
    <label className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2"><Switch size="sm" checked={checked} onCheckedChange={(next) => onChange(next)} />{children}</span>
    </label>
  );
}

export function MarkdownProperties({ doc, element: el, catalogFonts, addFont, update }: Props<MarkdownElement>) {
  const openEditor = useOpenContentEditor();
  const s = el.style;
  const style = (changes: Record<string, unknown>) => update({ style: changes });
  return (
    <Section title="Markdown">
      <Button variant="outline" size="sm" onClick={() => openEditor(el.id)}><HugeiconsIcon icon={PencilIcon} /> Edit markdown…</Button>
      <ContentFontField label="Body font" doc={doc} catalogFonts={catalogFonts} addFont={addFont} value={s.fontFamily} onChange={(fontFamily) => style({ fontFamily })} />
      <ContentFontField label="Headings" doc={doc} catalogFonts={catalogFonts} addFont={addFont} value={s.headingFontFamily} onChange={(headingFontFamily) => style({ headingFontFamily })} />
      <div className="grid grid-cols-2 gap-2">
        <Field compact label="Size"><NumberInput value={s.baseFontSize} min={4} max={400} onCommit={(baseFontSize) => style({ baseFontSize })} /></Field>
        <Field compact label="Line"><NumberInput value={s.lineHeight} min={0.8} max={4} step={0.05} onCommit={(lineHeight) => style({ lineHeight })} /></Field>
      </div>
      <Field label="Text"><ColorInput doc={doc} value={s.color} label="Text color" onChange={(color) => style({ color })} /></Field>
      <Field label="Headings"><ColorInput doc={doc} value={s.headingColor} label="Heading color" onChange={(headingColor) => style({ headingColor })} /></Field>
      <Field label="Links"><ColorInput doc={doc} value={s.linkColor} label="Link color" onChange={(linkColor) => style({ linkColor })} /></Field>
      <Field label="Background"><OptionalColor doc={doc} label="Background" value={s.background} fallback="#ffffff" onChange={(background) => style({ background: background ?? undefined })} /></Field>
      <Field label="Align">
        <SimpleSelect size="sm" aria-label="Alignment" value={s.align} onValueChange={(align) => style({ align })}
          options={[{ value: "start", label: "Start" }, { value: "center", label: "Center" }, { value: "end", label: "End" }, { value: "justify", label: "Justify" }]} />
      </Field>
      <Field label="Direction"><SimpleSelect size="sm" aria-label="Direction" value={s.direction} onValueChange={(direction) => style({ direction })} options={DIRECTION_OPTIONS} /></Field>
      <p className="text-[11px] leading-relaxed text-muted-foreground">Double-click the block on the slide to edit its markdown. Sizes of headings and code follow the base size.</p>
    </Section>
  );
}

export function TableProperties({ doc, element: el, catalogFonts, addFont, update, run }: Props<TableElement>) {
  const openEditor = useOpenContentEditor();
  const s = el.style;
  const style = (changes: Record<string, unknown>) => update({ style: changes });
  return (
    <Section title="Table">
      <Button variant="outline" size="sm" onClick={() => openEditor(el.id)}><HugeiconsIcon icon={PencilIcon} /> Edit data…</Button>
      <p className="text-[11px] text-muted-foreground tabular-nums">{el.content.rows.length} rows × {el.content.columns.length} columns</p>
      <SwitchField label="Header" checked={el.content.header} onChange={(header) => run({ type: "table.edit", elementId: el.id, ops: [{ op: "setHeader", header }] })} />
      <ContentFontField label="Font" doc={doc} catalogFonts={catalogFonts} addFont={addFont} value={s.fontFamily} onChange={(fontFamily) => style({ fontFamily })} />
      <div className="grid grid-cols-2 gap-2">
        <Field compact label="Size"><NumberInput value={s.fontSize} min={4} max={200} onCommit={(fontSize) => style({ fontSize })} /></Field>
        <Field compact label="Padding"><NumberInput value={s.cellPadding} min={0} max={64} onCommit={(cellPadding) => style({ cellPadding })} /></Field>
      </div>
      <Field label="Density">
        <SimpleSelect size="sm" aria-label="Density" value={s.density} onValueChange={(density) => style({ density })}
          options={[{ value: "compact", label: "Compact" }, { value: "normal", label: "Normal" }, { value: "comfortable", label: "Comfortable" }]} />
      </Field>
      <Field label="Text"><ColorInput doc={doc} value={s.color} label="Text color" onChange={(color) => style({ color })} /></Field>
      <Field label="Header"><ColorInput doc={doc} value={s.headerBackground} label="Header background" onChange={(headerBackground) => style({ headerBackground })} /></Field>
      <Field label="Header text"><ColorInput doc={doc} value={s.headerColor} label="Header text color" onChange={(headerColor) => style({ headerColor })} /></Field>
      <Field label="Cells"><OptionalColor doc={doc} label="Cell background" value={s.background} fallback="#ffffff" onChange={(background) => style({ background: background ?? undefined })} /></Field>
      <SwitchField label="Stripes" checked={s.zebra} onChange={(zebra) => style({ zebra })} />
      {s.zebra && <Field label="Stripe"><OptionalColor doc={doc} label="Stripe color" value={s.zebraColor} fallback={doc.theme.colors.muted ?? "#888888"} onChange={(zebraColor) => style({ zebraColor: zebraColor ?? undefined })} /></Field>}
      <Field label="Borders"><ColorInput doc={doc} value={s.borderColor} label="Border color" onChange={(borderColor) => style({ borderColor })} /></Field>
      <Field label="Border"><NumberInput value={s.borderWidth} min={0} max={8} step={0.5} suffix="px" onCommit={(borderWidth) => style({ borderWidth })} /></Field>
      <Field label="Direction"><SimpleSelect size="sm" aria-label="Direction" value={s.direction} onValueChange={(direction) => style({ direction })} options={DIRECTION_OPTIONS} /></Field>
      <p className="text-[11px] leading-relaxed text-muted-foreground">Double-click the table on the slide to edit cells, rows and columns. Rows that don't fit the box fade out; make the box taller to show them.</p>
    </Section>
  );
}
