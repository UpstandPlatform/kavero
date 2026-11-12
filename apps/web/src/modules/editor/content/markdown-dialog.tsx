"use client";

import { MAX_MARKDOWN_CHARACTERS, documentDirection, resolveToken, type CatalogDocument, type MarkdownElement } from "@Kavero/catalog-engine";
import { MarkdownView } from "@Kavero/renderer";
import { Button } from "@Kavero/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@Kavero/ui/components/dialog";
import { useLayoutEffect, useRef, useState } from "react";

import { CodeEditor } from "@/components/code-editor";
import { surface } from "@/components/surface";

/**
 * Markdown source on the left, the element as it will look on the slide on the right.
 * Changes are applied once, on "Apply", so the whole edit is a single undo step.
 */
export function MarkdownEditDialog({ element, doc, onApply, onClose }: {
  element: MarkdownElement;
  doc: CatalogDocument;
  onApply: (markdown: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(element.content.markdown);
  const tooLong = draft.length > MAX_MARKDOWN_CHARACTERS;
  const apply = () => {
    if (tooLong) return;
    if (draft !== element.content.markdown) onApply(draft);
    onClose();
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex h-[min(760px,calc(100dvh-2rem))] w-[min(1100px,calc(100vw-1rem))] max-w-none flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-none"
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            apply();
          }
        }}
      >
        <DialogHeader className="shrink-0 border-b px-5 py-4 pe-14">
          <DialogTitle className="text-base">Edit markdown</DialogTitle>
          <DialogDescription>
            GitHub-flavored markdown: <code># headings</code>, <code>**bold**</code>, <code>*italic*</code>, <code>- lists</code>, <code>- [ ] tasks</code>, <code>[links](https://…)</code>, <code>`code`</code>, <code>&gt; quotes</code> and tables. HTML tags are not rendered.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-2 md:overflow-hidden">
          <div className="flex min-h-0 flex-col gap-1">
            <CodeEditor label="Markdown" language="markdown" value={draft} rows={18} formatter={false} onChange={setDraft} className="min-h-0" placeholder="# Title" />
            <p className={`text-xs tabular-nums ${tooLong ? "text-destructive" : "text-muted-foreground"}`}>
              {draft.length.toLocaleString()} / {MAX_MARKDOWN_CHARACTERS.toLocaleString()} characters{tooLong ? " — shorten the text to apply it" : ""}
            </p>
          </div>
          <MarkdownPreview element={element} doc={doc} markdown={draft} />
        </div>
        <DialogFooter className="shrink-0 border-t px-5 py-3">
          <span className="me-auto hidden self-center text-xs text-muted-foreground sm:inline">Ctrl+Enter to apply</span>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={tooLong} onClick={apply}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The element at its slide size, scaled down to fit the preview column. */
function MarkdownPreview({ element, doc, markdown }: { element: MarkdownElement; doc: CatalogDocument; markdown: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(400);
  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const { width: w, height: h } = element.position;
  const scale = Math.min(1, width / Math.max(1, w));
  const background = doc.slides.find((slide) => slide.elements.some((item) => item.id === element.id))?.background;
  return (
    <section aria-label="Preview" className="flex min-h-0 flex-col gap-1">
      <span className="text-xs font-medium">Preview <span className="font-normal text-muted-foreground">· as on the slide ({Math.round(w)} × {Math.round(h)})</span></span>
      <div ref={box} className={`${surface.panel} min-h-0 flex-1 overflow-auto p-0`}>
        <div
          style={{
            width: w * scale, height: h * scale, overflow: "hidden",
            background: background?.kind === "color" ? resolveToken(doc, background.color) : resolveToken(doc, "token:background"),
          }}
        >
          <div style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: "0 0" }} dir={documentDirection(doc)}>
            <MarkdownView markdown={markdown} doc={doc} style={element.style} mode="edit" />
          </div>
        </div>
      </div>
    </section>
  );
}
