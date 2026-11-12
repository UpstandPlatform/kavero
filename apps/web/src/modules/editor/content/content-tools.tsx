"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { ParagraphBulletsPoint01Icon, Table01Icon } from "@hugeicons/core-free-icons";
import { MAX_MARKDOWN_CHARACTERS, SAMPLE_MARKDOWN, tableFileKind, type CatalogDocument, type TableOp } from "@Kavero/catalog-engine";
import type { Editor, EditorCommand } from "@Kavero/editor-core";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import type { RailTool } from "../tool-rail";
import { isContentElementType } from "./content-editing";
import { isMarkdownFile, markdownElementInput, tableElementInput, type ContentElementInput } from "./content-elements";
import { InsertTableDialog } from "./insert-table-dialog";
import { MarkdownEditDialog } from "./markdown-dialog";
import { TableEditDialog } from "./table-edit-dialog";

/**
 * Markdown and table tools for the editor: rail buttons, the insert/edit dialogs, double-click
 * editing (through ContentEditingContext) and dropping .md / CSV / Excel files on the canvas.
 */
export function useContentTools({ editor, doc, run, addElement }: {
  editor: Editor;
  doc: CatalogDocument;
  run: (command: EditorCommand) => { createdIds: string[] } | null | undefined;
  /** Adds an element centred on the current slide and selects it. */
  addElement: (element: ContentElementInput) => void;
}) {
  const page = doc.settings;
  const [insertTable, setInsertTable] = useState<{ file?: File; key: number } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editing = useMemo(() => {
    if (!editingId) return undefined;
    for (const slide of doc.slides) for (const element of slide.elements) if (element.id === editingId) return element;
    return undefined;
  }, [doc, editingId]);

  // Close the editor when its element disappears (deleted, undone).
  useEffect(() => {
    if (editingId && !editing) setEditingId(null);
  }, [editing, editingId]);

  const openEditor = useCallback((elementId: string) => {
    const element = editor.getDocument().slides.flatMap((slide) => slide.elements).find((item) => item.id === elementId);
    if (!element || !isContentElementType(element.type)) return false;
    if (element.locked) {
      toast.message("Unlock this element to edit it.");
      return true;
    }
    setEditingId(elementId);
    return true;
  }, [editor]);

  const addMarkdown = useCallback((markdown: string, name?: string) => {
    if (markdown.length > MAX_MARKDOWN_CHARACTERS) {
      toast.error(`Markdown can be at most ${MAX_MARKDOWN_CHARACTERS.toLocaleString()} characters; this file has ${markdown.length.toLocaleString()}.`);
      return;
    }
    addElement(markdownElementInput(markdown, page, name));
  }, [addElement, page]);

  // Drop a markdown, CSV or spreadsheet file onto the canvas.
  useEffect(() => {
    const inCanvas = (target: EventTarget | null) => target instanceof Element && !!target.closest("[data-editor-canvas]");
    const contentFile = (event: DragEvent) => [...(event.dataTransfer?.files ?? [])].find((file) => isMarkdownFile(file) || tableFileKind(file.name, file.type) !== null);
    const onDragOver = (event: DragEvent) => {
      if (inCanvas(event.target) && event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    const onDrop = (event: DragEvent) => {
      if (!inCanvas(event.target)) return;
      const file = contentFile(event);
      if (!file) return;
      event.preventDefault();
      if (isMarkdownFile(file)) {
        file.text().then((text) => addMarkdown(text, file.name.replace(/\.[^.]+$/, "")), () => toast.error(`Could not read "${file.name}".`));
      } else setInsertTable({ file, key: Date.now() });
    };
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
    };
  }, [addMarkdown]);

  const tools: RailTool[] = [
    {
      id: "markdown", icon: <HugeiconsIcon icon={ParagraphBulletsPoint01Icon} />, label: "Markdown",
      description: "Add a block of markdown: headings, lists, task lists, links, code, quotes and tables in your theme's fonts. Double-click it to edit; drop a .md file on the slide to import one.",
      onClick: () => addMarkdown(SAMPLE_MARKDOWN),
    },
    {
      id: "table", icon: <HugeiconsIcon icon={Table01Icon} />, label: "Table",
      description: "Insert a data table from a CSV or Excel file, cells pasted from a spreadsheet, or an empty grid. Double-click it to edit cells, rows and columns.",
      onClick: () => setInsertTable({ key: Date.now() }),
    },
  ];

  const editTable = (ops: TableOp[]) => !!(editing && run({ type: "table.edit", elementId: editing.id, ops }));

  const dialogs: ReactNode = (
    <>
      {insertTable && (
        <InsertTableDialog
          key={insertTable.key}
          open
          initialFile={insertTable.file}
          onClose={() => setInsertTable(null)}
          onInsert={(content) => {
            addElement(tableElementInput(content, page));
            setInsertTable(null);
          }}
        />
      )}
      {editing?.type === "markdown" && (
        <MarkdownEditDialog
          key={editing.id}
          element={editing}
          doc={doc}
          onApply={(markdown) => run({ type: "element.update", elementId: editing.id, changes: { content: { markdown } } })}
          onClose={() => setEditingId(null)}
        />
      )}
      {editing?.type === "table" && <TableEditDialog key={editing.id} element={editing} onEdit={editTable} onClose={() => setEditingId(null)} />}
    </>
  );

  return { tools, dialogs, openEditor };
}
