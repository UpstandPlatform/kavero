"use client";

import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical,
  ArrowDownToLine, ArrowUpToLine, ChevronDown, ChevronUp, ClipboardPaste, Copy, CopyPlus, Eye, EyeOff, Group, Layers, Lock,
  Maximize, Paintbrush, Pencil, Plus, RotateCcw, Scissors, SquareDashed, Trash2, Ungroup, Unlock,
} from "lucide-react";

import type { MenuItem } from "./context-menu";
import { hasClipboard, kbd, type EditorActions } from "./editor-actions";

/** Right-click on one or more selected elements. */
export function elementMenu(a: EditorActions, opts: { onRename?: () => void; at?: { x: number; y: number } } = {}): MenuItem[] {
  const els = a.selected();
  const many = els.length > 1;
  const allLocked = els.every((e) => e.locked);
  const grouped = els.some((e) => e.groupId);
  return [
    { label: many ? `${els.length} elements` : els[0]?.name || labelOf(els[0]?.type), type: "label" },
    { label: "Cut", icon: <Scissors />, shortcut: kbd("Ctrl+X"), onSelect: () => a.cut() },
    { label: "Copy", icon: <Copy />, shortcut: kbd("Ctrl+C"), onSelect: () => a.copy() },
    { label: "Paste", icon: <ClipboardPaste />, shortcut: kbd("Ctrl+V"), disabled: !hasClipboard(), onSelect: () => void a.paste(undefined, opts.at) },
    { label: "Duplicate", icon: <CopyPlus />, shortcut: kbd("Ctrl+D"), onSelect: () => a.duplicate() },
    { label: "Delete", icon: <Trash2 />, shortcut: "Del", danger: true, onSelect: () => a.remove() },
    { type: "separator" },
    { label: "Copy style", icon: <Paintbrush />, shortcut: kbd("Ctrl+Alt+C"), disabled: many, onSelect: () => a.copyStyle() },
    { label: "Paste style", icon: <Paintbrush />, shortcut: kbd("Ctrl+Alt+V"), disabled: !a.canPasteStyle(), onSelect: () => a.pasteStyle() },
    { type: "separator" },
    {
      type: "submenu", label: "Order", icon: <Layers />, items: [
        { label: "Bring to front", icon: <ArrowUpToLine />, shortcut: kbd("Ctrl+Shift+]"), onSelect: () => a.order("front") },
        { label: "Bring forward", icon: <ChevronUp />, shortcut: kbd("Ctrl+]"), onSelect: () => a.order("forward") },
        { label: "Send backward", icon: <ChevronDown />, shortcut: kbd("Ctrl+["), onSelect: () => a.order("backward") },
        { label: "Send to back", icon: <ArrowDownToLine />, shortcut: kbd("Ctrl+Shift+["), onSelect: () => a.order("back") },
      ],
    },
    {
      type: "submenu", label: many ? "Align selection" : "Align to slide", icon: <AlignCenterHorizontal />, disabled: allLocked, items: [
        { label: "Left", icon: <AlignStartVertical />, shortcut: "Alt+A", onSelect: () => a.align("l") },
        { label: "Center", icon: <AlignCenterVertical />, shortcut: "Alt+H", onSelect: () => a.align("c") },
        { label: "Right", icon: <AlignEndVertical />, shortcut: "Alt+D", onSelect: () => a.align("r") },
        { type: "separator" },
        { label: "Top", icon: <AlignStartHorizontal />, shortcut: "Alt+W", onSelect: () => a.align("t") },
        { label: "Middle", icon: <AlignCenterHorizontal />, shortcut: "Alt+V", onSelect: () => a.align("m") },
        { label: "Bottom", icon: <AlignEndHorizontal />, shortcut: "Alt+S", onSelect: () => a.align("b") },
        ...(els.length > 2 ? ([
          { type: "separator" },
          { label: "Distribute horizontally", onSelect: () => a.distribute("x") },
          { label: "Distribute vertically", onSelect: () => a.distribute("y") },
        ] as MenuItem[]) : []),
      ],
    },
    {
      type: "submenu", label: "Position", icon: <Maximize />, disabled: allLocked, items: [
        { label: "Center on slide", onSelect: () => a.centerOnSlide() },
        { label: "Fill the slide", onSelect: () => a.fillSlide() },
        { label: "Reset rotation", icon: <RotateCcw />, onSelect: () => a.resetRotation() },
      ],
    },
    many
      ? { label: "Group", icon: <Group />, shortcut: kbd("Ctrl+G"), onSelect: () => a.group() }
      : { label: "Ungroup", icon: <Ungroup />, shortcut: kbd("Ctrl+Shift+G"), disabled: !grouped, onSelect: () => a.ungroup() },
    ...(many && grouped ? [{ label: "Ungroup", icon: <Ungroup />, shortcut: kbd("Ctrl+Shift+G"), onSelect: () => a.ungroup() } as MenuItem] : []),
    { type: "separator" },
    { label: allLocked ? "Unlock" : "Lock", icon: allLocked ? <Unlock /> : <Lock />, shortcut: kbd("Ctrl+Shift+L"), onSelect: () => a.toggleLock() },
    { label: "Hide", icon: <EyeOff />, shortcut: kbd("Ctrl+Shift+H"), onSelect: () => a.toggleHide() },
    ...(opts.onRename && !many ? [{ label: "Rename…", icon: <Pencil />, onSelect: opts.onRename } as MenuItem] : []),
    { label: "Select all of this type", icon: <SquareDashed />, onSelect: () => a.selectSameType() },
  ];
}

/** Right-click on empty canvas. */
export function canvasMenu(a: EditorActions, at: { x: number; y: number }): MenuItem[] {
  return [
    { label: "Paste here", icon: <ClipboardPaste />, shortcut: kbd("Ctrl+V"), onSelect: () => void a.paste(undefined, at) },
    { label: "Select all", shortcut: kbd("Ctrl+A"), onSelect: () => a.selectAll() },
    { type: "separator" },
    { label: "New slide", icon: <Plus />, shortcut: kbd("Ctrl+M"), onSelect: () => a.addSlide() },
    { label: "Duplicate slide", icon: <CopyPlus />, shortcut: kbd("Ctrl+Shift+D"), onSelect: () => a.duplicateSlide() },
  ];
}

/** Right-click on a slide thumbnail. */
export function slideMenu(a: EditorActions, slideId: string, index: number, count: number, onRename: () => void): MenuItem[] {
  return [
    { label: "New slide after", icon: <Plus />, onSelect: () => a.addSlide(index) },
    { label: "Duplicate", icon: <CopyPlus />, onSelect: () => a.duplicateSlide(slideId) },
    { label: "Copy slide", icon: <Copy />, onSelect: () => a.copySlide(slideId) },
    { label: "Paste slide after", icon: <ClipboardPaste />, disabled: !a.hasSlideClip(), onSelect: () => a.pasteSlide() },
    { type: "separator" },
    { label: "Move up", icon: <ChevronUp />, disabled: index === 0, onSelect: () => a.moveSlide(slideId, index - 1) },
    { label: "Move down", icon: <ChevronDown />, disabled: index === count - 1, onSelect: () => a.moveSlide(slideId, index + 1) },
    { label: "Rename…", icon: <Pencil />, onSelect: onRename },
    { type: "separator" },
    { label: "Delete slide", icon: <Trash2 />, danger: true, disabled: count === 1, onSelect: () => a.deleteSlide(slideId) },
  ];
}

export function labelOf(type?: string) {
  return ({ text: "Text", shape: "Shape", image: "Image", product: "Product", "product-grid": "Product grid", html: "HTML block", button: "Button", video: "Video", icon: "Icon" } as Record<string, string>)[type ?? ""] ?? "Element";
}

/** Eye icon helper for the layers panel. */
export const visibilityIcon = (hidden: boolean) => (hidden ? <EyeOff /> : <Eye />);
