"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, ArrowDown01Icon, MoreHorizontalIcon, MoreVerticalIcon } from "@hugeicons/core-free-icons";
import { TABLE_COLUMN_FORMATS, TABLE_LIMITS, parseClipboardTable, type TableColumnFormat, type TableElement, type TableOp } from "@Kavero/catalog-engine";
import { Button } from "@Kavero/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@Kavero/ui/components/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@Kavero/ui/components/dropdown-menu";
import { Label } from "@Kavero/ui/components/label";
import { Switch } from "@Kavero/ui/components/switch";
import { cn } from "@Kavero/ui/lib/utils";
import { useEffect, useId, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";

const FORMAT_LABELS: Record<TableColumnFormat, string> = { text: "Text (as typed)", number: "Number", currency: "Currency", percent: "Percent", date: "Date" };
const ALIGN_LABELS = { start: "Start", center: "Center", end: "End" } as const;
const PAGE = 100;

/**
 * Spreadsheet-style editing of a table element. Every change is an editor command
 * (`table.edit`), so each one can be undone; typing in a cell commits when the cell is left.
 */
export function TableEditDialog({ element, onEdit, onClose }: {
  element: TableElement;
  /** Apply table ops; returns false when they were rejected. */
  onEdit: (ops: TableOp[]) => boolean;
  onClose: () => void;
}) {
  const { columns, rows, header } = element.content;
  const [visibleRows, setVisibleRows] = useState(PAGE);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const pendingFocus = useRef<{ row: number; column: number } | null>(null);
  const headerId = useId();
  const key = (row: number, column: number) => `${row}:${column}`;

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    if (target.row >= visibleRows) setVisibleRows(target.row + PAGE);
    requestAnimationFrame(() => {
      const input = inputs.current.get(key(target.row, target.column));
      input?.focus();
      input?.select();
    });
  });

  const focus = (row: number, column: number) => {
    pendingFocus.current = { row, column };
    const input = inputs.current.get(key(row, column));
    if (input) {
      pendingFocus.current = null;
      input.focus();
      input.select();
    }
  };

  /** Commit a cell (row -1 is the header label). */
  function commit(row: number, column: number, value: string) {
    if (row < 0) {
      if (value !== columns[column]?.label) onEdit([{ op: "updateColumn", column, changes: { label: value.slice(0, TABLE_LIMITS.labelCharacters) } }]);
    } else if (value !== rows[row]?.[column]) onEdit([{ op: "setCell", row, column, value: value.slice(0, TABLE_LIMITS.cellCharacters) }]);
  }

  function onCellKeyDown(event: KeyboardEvent<HTMLInputElement>, row: number, column: number) {
    const input = event.currentTarget;
    const lastColumn = columns.length - 1;
    // Moving focus blurs this cell, which commits it.
    const move = (r: number, c: number) => {
      event.preventDefault();
      focus(r, c);
    };
    if (event.key === "Tab") {
      if (!event.shiftKey) {
        if (column < lastColumn) return move(row, column + 1);
        if (row < rows.length - 1) return move(row + 1, 0);
        event.preventDefault();
        if (rows.length < TABLE_LIMITS.rows && onEdit([{ op: "insertRows", index: rows.length }])) focus(rows.length, 0);
        return;
      }
      if (column > 0) return move(row, column - 1);
      if (row > -1) return move(row - 1, lastColumn);
      return;
    }
    if (event.key === "Enter") {
      if (row < rows.length - 1) return move(row + 1, column);
      event.preventDefault();
      if (rows.length < TABLE_LIMITS.rows && onEdit([{ op: "insertRows", index: rows.length }])) focus(rows.length, column);
      return;
    }
    if (event.key === "ArrowDown" && row < rows.length - 1) return move(row + 1, column);
    if (event.key === "ArrowUp" && row > -1) return move(row - 1, column);
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
    const rtl = getComputedStyle(input).direction === "rtl";
    if (event.key === (rtl ? "ArrowRight" : "ArrowLeft") && atStart && column > 0) return move(row, column - 1);
    if (event.key === (rtl ? "ArrowLeft" : "ArrowRight") && atEnd && column < lastColumn) return move(row, column + 1);
    if (event.key === "Escape") {
      // Leave the dialog without committing the cell being typed in.
      input.value = row < 0 ? columns[column]?.label ?? "" : rows[row]?.[column] ?? "";
    }
  }

  /** Pasting several cells (from a spreadsheet) fills the grid from this cell. */
  function onCellPaste(event: ClipboardEvent<HTMLInputElement>, row: number, column: number) {
    const grid = parseClipboardTable(event.clipboardData.getData("text/plain"));
    if (!grid || row < 0) return;
    event.preventDefault();
    if (onEdit([{ op: "setCells", row, column, values: grid }])) focus(row, column);
  }

  const cellClass = "h-8 w-full min-w-24 rounded-none border-0 bg-transparent px-2 text-sm outline-none focus:bg-background focus:ring-2 focus:ring-ring focus:ring-inset";
  const shownRows = rows.slice(0, visibleRows);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[min(780px,calc(100dvh-2rem))] w-[min(1100px,calc(100vw-1rem))] max-w-none flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-none">
        <DialogHeader className="shrink-0 border-b px-5 py-4 pe-14">
          <DialogTitle className="text-base">Edit table</DialogTitle>
          <DialogDescription>
            Click a cell and type. Tab and Shift+Tab move across, Enter and the arrow keys move between rows; Enter on the last row adds one. Paste cells from a spreadsheet to fill several at once. Every change can be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-5 py-2 text-sm">
          <Button size="sm" variant="outline" disabled={rows.length >= TABLE_LIMITS.rows} onClick={() => onEdit([{ op: "insertRows", index: rows.length }]) && focus(rows.length, 0)}><HugeiconsIcon icon={Add01Icon} /> Row</Button>
          <Button size="sm" variant="outline" disabled={columns.length >= TABLE_LIMITS.columns} onClick={() => onEdit([{ op: "insertColumns", index: columns.length }]) && focus(-1, columns.length)}><HugeiconsIcon icon={Add01Icon} /> Column</Button>
          <div className="ms-2 flex items-center gap-2">
            <Switch id={headerId} size="sm" checked={header} onCheckedChange={(checked) => onEdit([{ op: "setHeader", header: checked }])} />
            <Label htmlFor={headerId} className="text-xs">Show header row</Label>
          </div>
          <span className="ms-auto text-xs text-muted-foreground tabular-nums">{rows.length} / {TABLE_LIMITS.rows} rows · {columns.length} / {TABLE_LIMITS.columns} columns</span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-10 bg-muted">
              <tr>
                <th className="sticky start-0 z-20 w-9 border-e border-b bg-muted" aria-label="Row actions" />
                {columns.map((column, c) => (
                  <th key={column.id} scope="col" className="border-e border-b p-0 text-start align-top font-medium">
                    <div className="flex items-center">
                      <input
                        key={`${column.id}:${column.label}`}
                        ref={(node) => { if (node) inputs.current.set(key(-1, c), node); else inputs.current.delete(key(-1, c)); }}
                        dir="auto"
                        aria-label={`Column ${c + 1} label`}
                        defaultValue={column.label}
                        placeholder={`Column ${c + 1}`}
                        className={cn(cellClass, "font-medium", column.align === "center" && "text-center", column.align === "end" && "text-end")}
                        onBlur={(event) => commit(-1, c, event.currentTarget.value)}
                        onKeyDown={(event) => onCellKeyDown(event, -1, c)}
                      />
                      <ColumnMenu
                        index={c}
                        count={columns.length}
                        align={column.align}
                        format={column.format}
                        onEdit={onEdit}
                      />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shownRows.map((row, r) => (
                <tr key={r} className="group">
                  <th scope="row" className="sticky start-0 z-[5] border-e border-b bg-background p-0 text-center text-xs font-normal text-muted-foreground tabular-nums">
                    <RowMenu index={r} count={rows.length} onEdit={onEdit} />
                  </th>
                  {columns.map((column, c) => (
                    <td key={column.id} className="border-e border-b p-0">
                      <input
                        key={`${r}:${column.id}:${row[c]}`}
                        ref={(node) => { if (node) inputs.current.set(key(r, c), node); else inputs.current.delete(key(r, c)); }}
                        dir="auto"
                        aria-label={`Row ${r + 1}, ${column.label || `column ${c + 1}`}`}
                        defaultValue={row[c] ?? ""}
                        maxLength={TABLE_LIMITS.cellCharacters}
                        className={cn(cellClass, column.align === "center" && "text-center", column.align === "end" && "text-end", column.format !== "text" && "tabular-nums")}
                        onBlur={(event) => commit(r, c, event.currentTarget.value)}
                        onKeyDown={(event) => onCellKeyDown(event, r, c)}
                        onPaste={(event) => onCellPaste(event, r, c)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > visibleRows && (
            <div className="p-3">
              <Button size="sm" variant="ghost" onClick={() => setVisibleRows((current) => current + PAGE)}><HugeiconsIcon icon={ArrowDown01Icon} /> Show {Math.min(PAGE, rows.length - visibleRows)} more rows</Button>
            </div>
          )}
          {!rows.length && <p className="p-4 text-sm text-muted-foreground">This table has no rows yet. Add one with “Row”.</p>}
        </div>

        <DialogFooter className="shrink-0 border-t px-5 py-3">
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ColumnMenu({ index, count, align, format, onEdit }: {
  index: number; count: number; align: "start" | "center" | "end"; format: TableColumnFormat; onEdit: (ops: TableOp[]) => boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" className="me-1 shrink-0 text-muted-foreground" aria-label={`Column ${index + 1} options`} />}>
        <HugeiconsIcon icon={MoreVerticalIcon} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Alignment</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={align} onValueChange={(value) => onEdit([{ op: "updateColumn", column: index, changes: { align: value as "start" } }])}>
            {(Object.keys(ALIGN_LABELS) as (keyof typeof ALIGN_LABELS)[]).map((value) => <DropdownMenuRadioItem key={value} value={value}>{ALIGN_LABELS[value]}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Format</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={format} onValueChange={(value) => onEdit([{ op: "updateColumn", column: index, changes: { format: value as TableColumnFormat } }])}>
            {TABLE_COLUMN_FORMATS.map((value) => <DropdownMenuRadioItem key={value} value={value}>{FORMAT_LABELS[value]}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem disabled={count >= TABLE_LIMITS.columns} onClick={() => onEdit([{ op: "insertColumns", index }])}>Insert column before</DropdownMenuItem>
          <DropdownMenuItem disabled={count >= TABLE_LIMITS.columns} onClick={() => onEdit([{ op: "insertColumns", index: index + 1 }])}>Insert column after</DropdownMenuItem>
          <DropdownMenuItem disabled={index === 0} onClick={() => onEdit([{ op: "moveColumn", from: index, to: index - 1 }])}>Move column back</DropdownMenuItem>
          <DropdownMenuItem disabled={index === count - 1} onClick={() => onEdit([{ op: "moveColumn", from: index, to: index + 1 }])}>Move column forward</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" disabled={count <= 1} onClick={() => onEdit([{ op: "deleteColumns", index }])}>Delete column</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RowMenu({ index, count, onEdit }: { index: number; count: number; onEdit: (ops: TableOp[]) => boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<button type="button" className="grid h-8 w-9 place-items-center hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" aria-label={`Row ${index + 1} options`} />}>
        <span className="group-hover:hidden">{index + 1}</span>
        <HugeiconsIcon icon={MoreHorizontalIcon} className="hidden size-4 group-hover:block" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        <DropdownMenuItem disabled={count >= TABLE_LIMITS.rows} onClick={() => onEdit([{ op: "insertRows", index }])}>Insert row above</DropdownMenuItem>
        <DropdownMenuItem disabled={count >= TABLE_LIMITS.rows} onClick={() => onEdit([{ op: "insertRows", index: index + 1 }])}>Insert row below</DropdownMenuItem>
        <DropdownMenuItem disabled={index === 0} onClick={() => onEdit([{ op: "moveRow", from: index, to: index - 1 }])}>Move row up</DropdownMenuItem>
        <DropdownMenuItem disabled={index === count - 1} onClick={() => onEdit([{ op: "moveRow", from: index, to: index + 1 }])}>Move row down</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => onEdit([{ op: "deleteRows", index }])}>Delete row</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
