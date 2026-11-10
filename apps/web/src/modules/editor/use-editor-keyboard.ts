"use client";

import type { Editor } from "@Kavero/editor-core";
import { useEffect } from "react";

import type { EditorActions } from "./editor-actions";

const isTyping = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable=true], [data-kv-menu], dialog");
const focusedSlideId = (t: EventTarget | null) => (t as Element | null)?.closest?.("[data-slide-id]")?.getAttribute("data-slide-id") ?? undefined;
/** A modal (native <dialog>, Preview, font picker…) owns the keyboard while it's open, wherever focus is. */
const modalOpen = () => !!document.querySelector("dialog[open], [aria-modal='true']");
const ignore = (t: EventTarget | null) => isTyping(t) || modalOpen();

/**
 * Editor shortcuts. Copy/cut/paste use the native clipboard events so pasting
 * images or text from other apps works, and Kavero elements can move between tabs.
 */
export function useEditorKeyboard(editor: Editor, a: EditorActions, view: { zoomIn: () => void; zoomOut: () => void; zoomFit: () => void; showShortcuts: () => void }) {
  useEffect(() => {
    // Ctrl+C/X/V normally arrive as native clipboard events (which carry images and text
    // from other apps). Some hosts never fire them (an Electron window without an Edit menu,
    // automation), so the keydown schedules a fallback that a native event cancels.
    let expect: "copy" | "cut" | "paste" | null = null;
    const onCopy = (e: ClipboardEvent) => {
      expect = null;
      if (ignore(e.target)) return;
      const focusedId = focusedSlideId(e.target);
      const slideId = !a.hasSelection() && focusedId === editor.getState().activeSlideId ? focusedId : undefined;
      if (slideId) { a.copySlide(slideId, e); return; }
      if (a.copy(e)) e.preventDefault();
    };
    const onCut = (e: ClipboardEvent) => {
      expect = null;
      if (ignore(e.target)) return;
      const focusedId = focusedSlideId(e.target);
      const slideId = !a.hasSelection() && focusedId === editor.getState().activeSlideId ? focusedId : undefined;
      if (slideId) { a.cutSlide(slideId, e); return; }
      if (a.hasSelection()) a.cut(e);
    };
    const onPaste = (e: ClipboardEvent) => {
      expect = null;
      const focusedId = focusedSlideId(e.target);
      const slideId = focusedId === editor.getState().activeSlideId ? focusedId : undefined;
      if (!ignore(e.target)) void a.paste(e, undefined, slideId);
    };
    const fallback = (kind: "copy" | "cut" | "paste", slideId?: string) => {
      expect = kind;
      setTimeout(() => {
        if (expect !== kind) return;
        expect = null;
        if (kind === "copy") slideId ? a.copySlide(slideId) : a.copy();
        else if (kind === "cut") slideId ? a.cutSlide(slideId) : a.cut();
        else void a.paste(undefined, undefined, slideId);
      }, 0);
    };

    const onKey = (e: KeyboardEvent) => {
      if (ignore(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      const has = a.hasSelection();
      const focusedId = focusedSlideId(e.target);
      const slideId = focusedId === editor.getState().activeSlideId ? focusedId : undefined;
      const slideContextId = has ? undefined : slideId;
      const handled = () => e.preventDefault();
      if (mod && !e.altKey && !e.shiftKey && (k === "c" || k === "x" || k === "v")) {
        if (k === "v" || has || slideContextId) fallback(k === "c" ? "copy" : k === "x" ? "cut" : "paste", slideContextId);
        return;
      }

      // History and view work with or without a selection.
      if (mod && k === "z") { handled(); return e.shiftKey ? editor.redo() : editor.undo(); }
      if (mod && k === "y") { handled(); return editor.redo(); }
      if (mod && (k === "=" || k === "+")) { handled(); return view.zoomIn(); }
      if (mod && k === "-") { handled(); return view.zoomOut(); }
      if (mod && k === "0") { handled(); return view.zoomFit(); }
      if (mod && k === "a") { handled(); return a.selectAll(); }
      if (mod && k === "m") { handled(); return a.addSlide(); }
      if (mod && !e.altKey && e.shiftKey && k === "d") { handled(); return a.duplicateSlide(slideId); }
      if (mod && !e.altKey && !e.shiftKey && k === "d") {
        handled();
        return has ? a.duplicate() : slideId ? a.duplicateSlide(slideId) : a.duplicateSlide();
      }
      if (e.key === "?" || (e.shiftKey && k === "/")) { handled(); return view.showShortcuts(); }
      if (e.key === "Escape") return a.selectNone();
      if (e.key === "Tab") { handled(); return a.selectNext(e.shiftKey ? -1 : 1); }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (has) { handled(); return a.remove(); }
        if (slideId) { handled(); return a.deleteSlide(slideId); }
      }

      const slides = editor.getDocument().slides;
      const i = slides.findIndex((s) => s.id === editor.getState().activeSlideId);
      if (e.key === "PageDown" || (!has && e.key === "ArrowDown")) { handled(); if (slides[i + 1]) editor.setActiveSlide(slides[i + 1]!.id); return; }
      if (e.key === "PageUp" || (!has && e.key === "ArrowUp")) { handled(); if (slides[i - 1]) editor.setActiveSlide(slides[i - 1]!.id); return; }
      if (!has) return;

      if (e.key.startsWith("Arrow")) {
        handled();
        const s = e.shiftKey ? 10 : 1;
        const [dx, dy] = ({ ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] } as Record<string, [number, number]>)[e.key]!;
        return a.nudge(dx, dy);
      }
      if (mod && e.altKey && k === "c") { handled(); return a.copyStyle(); }
      if (mod && e.altKey && k === "v") { handled(); return a.pasteStyle(); }
      if (mod && k === "g") { handled(); return e.shiftKey ? a.ungroup() : a.group(); }
      // Use e.code for brackets so the shortcut works on any keyboard layout.
      if (mod && e.code === "BracketRight") { handled(); return a.order(e.shiftKey ? "front" : "forward"); }
      if (mod && e.code === "BracketLeft") { handled(); return a.order(e.shiftKey ? "back" : "backward"); }
      if (mod && e.shiftKey && k === "l") { handled(); return a.toggleLock(); }
      if (mod && e.shiftKey && k === "h") { handled(); return a.toggleHide(); }
      if (e.altKey && !mod) {
        const map: Record<string, "l" | "c" | "r" | "t" | "m" | "b"> = { KeyA: "l", KeyH: "c", KeyD: "r", KeyW: "t", KeyV: "m", KeyS: "b" };
        const how = map[e.code];
        if (how) { handled(); return a.align(how); }
      }
    };

    window.addEventListener("keydown", onKey);
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
    };
  }, [editor, a, view]);
}
