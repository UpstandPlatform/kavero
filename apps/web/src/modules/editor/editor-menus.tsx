"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, AlignEndHorizontalIcon, AlignEndVerticalIcon, AlignHorizontalCenterIcon, AlignStartHorizontalIcon, AlignStartVerticalIcon, AlignVerticalCenterIcon, ArrowDown01Icon, ArrowDownToLineIcon, ArrowUp01Icon, ArrowUpToLineIcon, Copy01Icon, Delete02Icon, FilePasteIcon, GroupItemsIcon, Layers01Icon, LockIcon, Maximize01Icon, MessageMultiple01Icon, PaintBrush01Icon, PencilIcon, RotateLeft01Icon, ScissorsIcon, SquareIcon, SquareUnlock01Icon, UngroupItemsIcon, ViewIcon, ViewOffIcon } from "@hugeicons/core-free-icons";

import type { MenuItem } from "./context-menu";
import { hasClipboard, kbd, type EditorActions } from "./editor-actions";

/** Right-click on one or more selected elements. */
export function elementMenu(a: EditorActions, opts: { onRename?: () => void; onAddToChat?: () => void; extensionItems?: MenuItem[]; at?: { x: number; y: number } } = {}): MenuItem[] {
  const els = a.selected();
  const many = els.length > 1;
  const allLocked = els.every((e) => e.locked);
  const grouped = els.some((e) => e.groupId);
  return [
    { label: many ? `${els.length} elements` : els[0]?.name || labelOf(els[0]?.type), type: "label" },
    ...(opts.onAddToChat ? [{ label: many ? "Add selection to chat" : "Add to chat", icon: <HugeiconsIcon icon={MessageMultiple01Icon} />, onSelect: opts.onAddToChat } as MenuItem] : []),
    ...(opts.onAddToChat ? [{ type: "separator" } as MenuItem] : []),
    { label: "Cut", icon: <HugeiconsIcon icon={ScissorsIcon} />, shortcut: kbd("Ctrl+X"), onSelect: () => a.cut() },
    { label: "Copy", icon: <HugeiconsIcon icon={Copy01Icon} />, shortcut: kbd("Ctrl+C"), onSelect: () => a.copy() },
    { label: "Paste", icon: <HugeiconsIcon icon={FilePasteIcon} />, shortcut: kbd("Ctrl+V"), disabled: !hasClipboard(), onSelect: () => void a.paste(undefined, opts.at) },
    { label: "Duplicate", icon: <HugeiconsIcon icon={Copy01Icon} />, shortcut: kbd("Ctrl+D"), onSelect: () => a.duplicate() },
    { label: "Delete", icon: <HugeiconsIcon icon={Delete02Icon} />, shortcut: "Del", danger: true, onSelect: () => a.remove() },
    { type: "separator" },
    { label: "Copy style", icon: <HugeiconsIcon icon={PaintBrush01Icon} />, shortcut: kbd("Ctrl+Alt+C"), disabled: many, onSelect: () => a.copyStyle() },
    { label: "Paste style", icon: <HugeiconsIcon icon={PaintBrush01Icon} />, shortcut: kbd("Ctrl+Alt+V"), disabled: !a.canPasteStyle(), onSelect: () => a.pasteStyle() },
    { type: "separator" },
    {
      type: "submenu", label: "Order", icon: <HugeiconsIcon icon={Layers01Icon} />, items: [
        { label: "Bring to front", icon: <HugeiconsIcon icon={ArrowUpToLineIcon} />, shortcut: kbd("Ctrl+Shift+]"), onSelect: () => a.order("front") },
        { label: "Bring forward", icon: <HugeiconsIcon icon={ArrowUp01Icon} />, shortcut: kbd("Ctrl+]"), onSelect: () => a.order("forward") },
        { label: "Send backward", icon: <HugeiconsIcon icon={ArrowDown01Icon} />, shortcut: kbd("Ctrl+["), onSelect: () => a.order("backward") },
        { label: "Send to back", icon: <HugeiconsIcon icon={ArrowDownToLineIcon} />, shortcut: kbd("Ctrl+Shift+["), onSelect: () => a.order("back") },
      ],
    },
    {
      type: "submenu", label: many ? "Align selection" : "Align to slide", icon: <HugeiconsIcon icon={AlignHorizontalCenterIcon} />, disabled: allLocked, items: [
        { label: "Left", icon: <HugeiconsIcon icon={AlignStartVerticalIcon} />, shortcut: "Alt+A", onSelect: () => a.align("l") },
        { label: "Center", icon: <HugeiconsIcon icon={AlignVerticalCenterIcon} />, shortcut: "Alt+H", onSelect: () => a.align("c") },
        { label: "Right", icon: <HugeiconsIcon icon={AlignEndVerticalIcon} />, shortcut: "Alt+D", onSelect: () => a.align("r") },
        { type: "separator" },
        { label: "Top", icon: <HugeiconsIcon icon={AlignStartHorizontalIcon} />, shortcut: "Alt+W", onSelect: () => a.align("t") },
        { label: "Middle", icon: <HugeiconsIcon icon={AlignHorizontalCenterIcon} />, shortcut: "Alt+V", onSelect: () => a.align("m") },
        { label: "Bottom", icon: <HugeiconsIcon icon={AlignEndHorizontalIcon} />, shortcut: "Alt+S", onSelect: () => a.align("b") },
        ...(els.length > 2 ? ([
          { type: "separator" },
          { label: "Distribute horizontally", onSelect: () => a.distribute("x") },
          { label: "Distribute vertically", onSelect: () => a.distribute("y") },
        ] as MenuItem[]) : []),
      ],
    },
    {
      type: "submenu", label: "Position", icon: <HugeiconsIcon icon={Maximize01Icon} />, disabled: allLocked, items: [
        { label: "Center on slide", onSelect: () => a.centerOnSlide() },
        { label: "Fill the slide", onSelect: () => a.fillSlide() },
        { label: "Reset rotation", icon: <HugeiconsIcon icon={RotateLeft01Icon} />, onSelect: () => a.resetRotation() },
      ],
    },
    many
      ? { label: "Group", icon: <HugeiconsIcon icon={GroupItemsIcon} />, shortcut: kbd("Ctrl+G"), onSelect: () => a.group() }
      : { label: "Ungroup", icon: <HugeiconsIcon icon={UngroupItemsIcon} />, shortcut: kbd("Ctrl+Shift+G"), disabled: !grouped, onSelect: () => a.ungroup() },
    ...(many && grouped ? [{ label: "Ungroup", icon: <HugeiconsIcon icon={UngroupItemsIcon} />, shortcut: kbd("Ctrl+Shift+G"), onSelect: () => a.ungroup() } as MenuItem] : []),
    { type: "separator" },
    { label: allLocked ? "Unlock" : "Lock", icon: allLocked ? <HugeiconsIcon icon={SquareUnlock01Icon} /> : <HugeiconsIcon icon={LockIcon} />, shortcut: kbd("Ctrl+Shift+L"), onSelect: () => a.toggleLock() },
    { label: "Hide", icon: <HugeiconsIcon icon={ViewOffIcon} />, shortcut: kbd("Ctrl+Shift+H"), onSelect: () => a.toggleHide() },
    ...(opts.onRename && !many ? [{ label: "Rename…", icon: <HugeiconsIcon icon={PencilIcon} />, onSelect: opts.onRename } as MenuItem] : []),
    { label: "Select all of this type", icon: <HugeiconsIcon icon={SquareIcon} />, onSelect: () => a.selectSameType() },
    ...(opts.extensionItems?.length ? [{ type: "separator" } as MenuItem, ...opts.extensionItems] : []),
  ];
}

/** Right-click on empty canvas. */
export function canvasMenu(a: EditorActions, at: { x: number; y: number }): MenuItem[] {
  return [
    { label: "Paste here", icon: <HugeiconsIcon icon={FilePasteIcon} />, shortcut: kbd("Ctrl+V"), onSelect: () => void a.paste(undefined, at) },
    { label: "Select all", shortcut: kbd("Ctrl+A"), onSelect: () => a.selectAll() },
    { type: "separator" },
    { label: "New slide", icon: <HugeiconsIcon icon={Add01Icon} />, shortcut: kbd("Ctrl+M"), onSelect: () => a.addSlide() },
    { label: "Duplicate slide", icon: <HugeiconsIcon icon={Copy01Icon} />, shortcut: kbd("Ctrl+Shift+D"), onSelect: () => a.duplicateSlide() },
  ];
}

/** Right-click on a slide thumbnail. */
export function slideMenu(a: EditorActions, slideId: string, index: number, count: number, onRename: () => void): MenuItem[] {
  return [
    { label: "New slide after", icon: <HugeiconsIcon icon={Add01Icon} />, onSelect: () => a.addSlide(index) },
    { label: "Duplicate", icon: <HugeiconsIcon icon={Copy01Icon} />, shortcut: kbd("Ctrl+D"), onSelect: () => a.duplicateSlide(slideId) },
    { label: "Copy slide", icon: <HugeiconsIcon icon={Copy01Icon} />, shortcut: kbd("Ctrl+C"), onSelect: () => a.copySlide(slideId) },
    { label: "Cut slide", icon: <HugeiconsIcon icon={ScissorsIcon} />, shortcut: kbd("Ctrl+X"), disabled: count === 1, onSelect: () => a.cutSlide(slideId) },
    { label: "Paste slide after", icon: <HugeiconsIcon icon={FilePasteIcon} />, disabled: !a.hasSlideClip(), onSelect: () => a.pasteSlide() },
    { type: "separator" },
    { label: "Rename…", icon: <HugeiconsIcon icon={PencilIcon} />, onSelect: onRename },
    { type: "separator" },
    { label: "Delete slide", icon: <HugeiconsIcon icon={Delete02Icon} />, danger: true, disabled: count === 1, onSelect: () => a.deleteSlide(slideId) },
  ];
}

export function labelOf(type?: string) {
  return ({ text: "Text", shape: "Shape", image: "Image", product: "Product", "product-grid": "Product grid", html: "HTML block", button: "Button", video: "Video", icon: "Icon" } as Record<string, string>)[type ?? ""] ?? "Element";
}

/** Eye icon helper for the layers panel. */
export const visibilityIcon = (hidden: boolean) => (hidden ? <HugeiconsIcon icon={ViewOffIcon} /> : <HugeiconsIcon icon={ViewIcon} />);
