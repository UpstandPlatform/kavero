"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { CodeIcon, Delete02Icon, Film01Icon, Image01Icon, LayoutGridIcon, Link02Icon, LockIcon, SquareIcon, SquareUnlock01Icon, StarIcon, Tag01Icon, TextIcon, ViewIcon, ViewOffIcon } from "@hugeicons/core-free-icons";
import type { CatalogElement, CatalogSlide } from "@Kavero/catalog-engine";
import type { Editor } from "@Kavero/editor-core";
import { Input } from "@Kavero/ui/components/input";
import { useRef, useState, type ReactNode } from "react";

import { useContextMenu } from "./context-menu";
import type { EditorActions } from "./editor-actions";
import { TooltipHint } from "@Kavero/ui/components/tooltip";
import { elementMenu, labelOf } from "./editor-menus";

const ICONS: Record<CatalogElement["type"], ReactNode> = {
  text: <HugeiconsIcon icon={TextIcon} />, shape: <HugeiconsIcon icon={SquareIcon} />, image: <HugeiconsIcon icon={Image01Icon} />, product: <HugeiconsIcon icon={Tag01Icon} />, "product-grid": <HugeiconsIcon icon={LayoutGridIcon} />,
  html: <HugeiconsIcon icon={CodeIcon} />, button: <HugeiconsIcon icon={Link02Icon} />, video: <HugeiconsIcon icon={Film01Icon} />, icon: <HugeiconsIcon icon={StarIcon} />,
};

/** A short readable name for a layer row. */
export function layerName(el: CatalogElement) {
  if (el.name) return el.name;
  if (el.type === "text") return el.content.paragraphs.map((p) => p.map((r) => r.text).join("")).join(" ").trim().slice(0, 40) || "Empty text";
  if (el.type === "shape") return el.content.shape === "rect" ? "Rectangle" : el.content.shape[0]!.toUpperCase() + el.content.shape.slice(1);
  if (el.type === "button") return `Button: ${el.content.label}`;
  return labelOf(el.type);
}

/**
 * Layers of the current slide, top first: click / Ctrl-click / Shift-click to
 * select, eye and lock toggles, double-click to rename, drag to reorder,
 * right-click for the element menu.
 */
export function LayersPanel({ editor, slide, selection, actions }: { editor: Editor; slide: CatalogSlide; selection: string[]; actions: EditorActions }) {
  const openMenu = useContextMenu();
  const layers = [...slide.elements].sort((a, b) => b.zIndex - a.zIndex);
  const selected = new Set(selection);
  const anchor = useRef<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; over: number | null } | null>(null);

  function select(e: React.MouseEvent, el: CatalogElement) {
    if (e.shiftKey && anchor.current) {
      const a = layers.findIndex((l) => l.id === anchor.current);
      const b = layers.findIndex((l) => l.id === el.id);
      const [from, to] = a < b ? [a, b] : [b, a];
      editor.select(layers.slice(from, to + 1).map((l) => l.id));
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      editor.select(selected.has(el.id) ? selection.filter((id) => id !== el.id) : [...selection, el.id]);
    } else editor.select([el.id]);
    anchor.current = el.id;
  }

  /** Drop at row index `to` (in top-first order) → zIndex counted from the bottom. */
  function drop(to: number) {
    if (!drag) return;
    const from = layers.findIndex((l) => l.id === drag.id);
    setDrag(null);
    if (from < 0 || to === from || to === from + 1) return;
    const target = to > from ? to - 1 : to;
    editor.execute({ type: "element.setZ", elementId: drag.id, index: layers.length - 1 - target });
  }

  if (!layers.length) return <p className="px-3 py-6 text-center text-xs text-muted-foreground">No elements on this slide yet. Add some from the toolbar.</p>;

  return (
    <ul className="grid grid-cols-[minmax(0,1fr)] gap-px px-2 pb-3 text-xs" role="listbox" aria-label="Layers" aria-multiselectable onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag((d) => (d ? { ...d, over: null } : d)); }}>
      {layers.map((el, i) => {
        const isSel = selected.has(el.id);
        return (
          <li
            key={el.id}
            role="option"
            aria-selected={isSel}
            draggable={renaming !== el.id}
            onDragStart={(e) => { setDrag({ id: el.id, over: null }); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", el.id); }}
            onDragOver={(e) => {
              if (!drag) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              setDrag({ ...drag, over: e.clientY < r.top + r.height / 2 ? i : i + 1 });
            }}
            onDrop={(e) => { e.preventDefault(); drop(drag?.over ?? i); }}
            onDragEnd={() => setDrag(null)}
            onClick={(e) => select(e, el)}
            onDoubleClick={() => setRenaming(el.id)}
            onContextMenu={(e) => {
              if (!isSel) editor.select([el.id]);
              openMenu(e, elementMenu(actions, { onRename: () => setRenaming(el.id) }));
            }}
            className={`group relative flex h-7 min-w-0 cursor-default items-center gap-1.5 rounded-md px-1.5 select-none ${isSel ? "bg-accent text-accent-foreground" : "hover:bg-muted"} ${el.hidden ? "opacity-50" : ""} [&_svg]:size-3.5 [&_svg]:shrink-0`}
          >
            {drag?.over === i && <span className="pointer-events-none absolute inset-x-1 -top-px h-0.5 rounded bg-sky-500" />}
            {drag?.over === i + 1 && i === layers.length - 1 && <span className="pointer-events-none absolute inset-x-1 -bottom-px h-0.5 rounded bg-sky-500" />}
            {el.groupId && <TooltipHint content="In a group"><span className="h-4 w-0.5 rounded bg-sky-500/60" /></TooltipHint>}
            <span className="text-muted-foreground">{ICONS[el.type]}</span>
            {renaming === el.id ? (
              <Input
                autoFocus
                defaultValue={el.name ?? ""}
                placeholder={layerName(el)}
                aria-label="Layer name"
                className="h-8 min-w-0 flex-1"
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => { actions.rename(el.id, e.target.value); setRenaming(null); }}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setRenaming(null); }}
              />
            ) : (
              <span className="min-w-0 flex-1 truncate" dir="auto">{layerName(el)}</span>
            )}
            <span className={`flex items-center gap-0.5 ${el.hidden || el.locked ? "" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}`}>
              <TooltipHint content={el.hidden ? "Show" : "Hide"}><button type="button" aria-label={el.hidden ? `Show ${layerName(el)}` : `Hide ${layerName(el)}`} onClick={(e) => { e.stopPropagation(); actions.setFlag(el.id, "hidden", !el.hidden); }} className="rounded-sm p-0.5 hover:bg-background">
                {el.hidden ? <HugeiconsIcon icon={ViewOffIcon} /> : <HugeiconsIcon icon={ViewIcon} />}
              </button></TooltipHint>
              <TooltipHint content={el.locked ? "Unlock" : "Lock"}><button type="button" aria-label={el.locked ? `Unlock ${layerName(el)}` : `Lock ${layerName(el)}`} onClick={(e) => { e.stopPropagation(); actions.setFlag(el.id, "locked", !el.locked); }} className="rounded-sm p-0.5 hover:bg-background">
                {el.locked ? <HugeiconsIcon icon={LockIcon} /> : <HugeiconsIcon icon={SquareUnlock01Icon} />}
              </button></TooltipHint>
              <TooltipHint content="Delete"><button type="button" aria-label={`Delete ${layerName(el)}`} onClick={(e) => { e.stopPropagation(); editor.execute({ type: "element.delete", elementId: el.id }); }} className="rounded-sm p-0.5 hover:bg-background hover:text-destructive">
                <HugeiconsIcon icon={Delete02Icon} />
              </button></TooltipHint>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
