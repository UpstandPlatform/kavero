"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { ClipboardPasteIcon, FileUploadIcon, Loading02Icon, Table01Icon } from "@hugeicons/core-free-icons";
import { TABLE_LIMITS, checkGrid, createEmptyTable, createTableContent, normalizeGrid, parseDelimited, type SpreadsheetSheet, type TableContent } from "@Kavero/catalog-engine";
import { Button } from "@Kavero/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@Kavero/ui/components/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@Kavero/ui/components/input-group";
import { Label } from "@Kavero/ui/components/label";
import { SimpleSelect } from "@Kavero/ui/components/simple-select";
import { Switch } from "@Kavero/ui/components/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@Kavero/ui/components/tabs";
import { Textarea } from "@Kavero/ui/components/textarea";
import { cn } from "@Kavero/ui/lib/utils";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { surface } from "@/components/surface";

import { TABLE_FILE_ACCEPT, readTableFile } from "./table-file";

type Source = "upload" | "paste" | "manual";
const PREVIEW_ROWS = 8;
const PICKER = { rows: 8, columns: 10 };

/**
 * "Insert table": data from a CSV/TSV/Excel file, pasted spreadsheet cells or an empty grid,
 * previewed before it lands on the slide.
 */
export function InsertTableDialog({ open, onClose, onInsert, initialGrid, initialFile }: {
  open: boolean;
  onClose: () => void;
  onInsert: (content: TableContent) => void;
  /** Pre-filled data (e.g. pasted onto the canvas); opens on the Paste tab. */
  initialGrid?: string[][];
  /** A file dropped onto the canvas; read on open. */
  initialFile?: File;
}) {
  const [source, setSource] = useState<Source>(initialGrid ? "paste" : "upload");
  const [sheets, setSheets] = useState<SpreadsheetSheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pasted, setPasted] = useState(() => (initialGrid ? initialGrid.map((row) => row.join("\t")).join("\n") : ""));
  const [header, setHeader] = useState(true);
  const [manual, setManual] = useState({ rows: 4, columns: 3 });
  const [hover, setHover] = useState<{ rows: number; columns: number } | null>(null);
  const [trim, setTrim] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const headerId = useId();

  useEffect(() => {
    if (initialFile) void loadFile(initialFile);
    // Only the file the dialog was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  const pastedGrid = useMemo(() => (pasted.trim() ? normalizeGrid(parseDelimited(pasted).rows) : []), [pasted]);
  const sheet = sheets[sheetIndex];
  const rawGrid = source === "upload" ? sheet?.rows ?? [] : source === "paste" ? pastedGrid : [];
  const limit = TABLE_LIMITS.rows + (header ? 1 : 0);
  const grid = trim ? rawGrid.slice(0, limit).map((row) => row.slice(0, TABLE_LIMITS.columns)) : rawGrid;
  const check = source === "manual" ? null : checkGrid(grid, header);
  const tooManyRows = source === "upload" && !!sheet?.truncated && !trim;
  const errors = [...(check?.errors ?? []), ...(tooManyRows && !check?.errors.some((error) => error.includes("rows")) ? [`Tables can have at most ${TABLE_LIMITS.rows} rows; this sheet has more.`] : [])];
  const canTrim = !trim && (tooManyRows || errors.some((error) => error.includes("rows") || error.includes("columns")));
  const ready = source === "manual" || (grid.length > 0 && errors.length === 0);

  async function loadFile(file: File | undefined) {
    if (!file) return;
    setReading(true);
    setFileError(null);
    setTrim(false);
    try {
      const result = await readTableFile(file);
      const first = Math.max(0, result.findIndex((item) => item.rows.length > 0));
      setSheets(result);
      setSheetIndex(first);
      setFileName(file.name);
    } catch (error) {
      setSheets([]);
      setFileName(null);
      setFileError((error as Error).message);
    } finally {
      setReading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function insert() {
    try {
      onInsert(source === "manual" ? createEmptyTable(manual.rows, manual.columns) : createTableContent(grid, { header }));
    } catch (error) {
      setFileError((error as Error).message);
    }
  }

  const previewGrid = source === "manual"
    ? Array.from({ length: Math.min(manual.rows + 1, PREVIEW_ROWS) }, (_, r) => Array.from({ length: manual.columns }, (_, c) => (r === 0 ? `Column ${c + 1}` : "")))
    : grid.slice(0, PREVIEW_ROWS + (header ? 1 : 0));
  const previewHeader = source === "manual" || header;
  const shownColumns = Math.min(previewGrid[0]?.length ?? 0, 12);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[min(820px,calc(100dvh-2rem))] w-[min(760px,calc(100vw-1rem))] max-w-none flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-none">
        <DialogHeader className="shrink-0 border-b px-5 py-4 pe-14">
          <DialogTitle className="text-base">Insert table</DialogTitle>
          <DialogDescription>Bring in data from a spreadsheet or CSV file, paste cells, or start with an empty grid. Up to {TABLE_LIMITS.columns} columns × {TABLE_LIMITS.rows} rows.</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          <Tabs value={source} onValueChange={(value) => { setSource(value as Source); setTrim(false); setFileError(null); }}>
            <TabsList>
              <TabsTrigger value="upload"><HugeiconsIcon icon={FileUploadIcon} /> Upload file</TabsTrigger>
              <TabsTrigger value="paste"><HugeiconsIcon icon={ClipboardPasteIcon} /> Paste</TabsTrigger>
              <TabsTrigger value="manual"><HugeiconsIcon icon={Table01Icon} /> Manual</TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="mt-3 grid gap-3">
              <input ref={fileInput} type="file" accept={TABLE_FILE_ACCEPT} className="hidden" onChange={(event) => void loadFile(event.target.files?.[0])} />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => { event.preventDefault(); setDragging(false); void loadFile(event.dataTransfer.files[0]); }}
                className={cn(surface.empty, "grid place-items-center gap-1 px-4 py-8 text-center text-sm transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring", dragging && "border-primary bg-primary/5")}
              >
                <HugeiconsIcon icon={reading ? Loading02Icon : FileUploadIcon} className={cn("size-6 text-muted-foreground", reading && "animate-spin")} />
                <span className="font-medium">{fileName ?? "Drop a file here or click to choose"}</span>
                <span className="text-xs text-muted-foreground">CSV, TSV, Excel (.xlsx, .xls) or OpenDocument (.ods), up to 10 MB</span>
              </button>
              {sheets.length > 1 && (
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 text-sm">
                  <Label>Sheet</Label>
                  <SimpleSelect
                    aria-label="Sheet"
                    value={String(sheetIndex)}
                    onValueChange={(value) => { setSheetIndex(Number(value)); setTrim(false); }}
                    options={sheets.map((item, index) => ({ value: String(index), label: `${item.name} · ${item.truncated ? `${TABLE_LIMITS.rows}+` : item.rows.length} rows` }))}
                  />
                </div>
              )}
            </TabsContent>

            <TabsContent value="paste" className="mt-3 grid gap-2">
              <Textarea
                value={pasted}
                onChange={(event) => { setPasted(event.target.value); setTrim(false); }}
                rows={6}
                spellCheck={false}
                placeholder={"Copy cells in Excel, Numbers or Google Sheets and paste them here.\nCSV text works too: name,price"}
                className="font-mono text-xs"
                aria-label="Pasted table data"
              />
              <p className="text-xs text-muted-foreground">Tabs, commas and semicolons are recognised automatically.</p>
            </TabsContent>

            <TabsContent value="manual" className="mt-3 grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
              <div>
                <div role="grid" aria-label="Choose table size" className="inline-grid gap-1 rounded-xl border p-2" style={{ gridTemplateColumns: `repeat(${PICKER.columns}, 1fr)` }} onPointerLeave={() => setHover(null)}>
                  {Array.from({ length: PICKER.rows * PICKER.columns }, (_, index) => {
                    const r = Math.floor(index / PICKER.columns) + 1, c = (index % PICKER.columns) + 1;
                    const active = hover ? r <= hover.rows && c <= hover.columns : r <= manual.rows && c <= manual.columns;
                    return (
                      <button
                        key={index}
                        type="button"
                        aria-label={`${r} rows by ${c} columns`}
                        onPointerEnter={() => setHover({ rows: r, columns: c })}
                        onFocus={() => setHover({ rows: r, columns: c })}
                        onClick={() => setManual({ rows: r, columns: c })}
                        className={cn("size-5 rounded-[4px] border transition-colors", active ? "border-primary bg-primary/25" : "bg-muted/40 hover:bg-muted")}
                      />
                    );
                  })}
                </div>
                <p className="mt-1 text-center text-xs text-muted-foreground tabular-nums">{(hover ?? manual).rows} × {(hover ?? manual).columns}</p>
              </div>
              <div className="grid gap-2 text-sm">
                <SizeInput label="Rows" value={manual.rows} max={TABLE_LIMITS.rows} onChange={(rows) => setManual((current) => ({ ...current, rows }))} />
                <SizeInput label="Columns" value={manual.columns} max={TABLE_LIMITS.columns} onChange={(columns) => setManual((current) => ({ ...current, columns }))} />
                <p className="text-xs text-muted-foreground">After inserting, double-click the table to type into its cells.</p>
              </div>
            </TabsContent>
          </Tabs>

          {source !== "manual" && (
            <div className="flex items-center gap-2 text-sm">
              <Switch id={headerId} checked={header} onCheckedChange={(checked) => setHeader(checked)} />
              <Label htmlFor={headerId}>First row is the header</Label>
            </div>
          )}

          {(fileError || errors.length > 0) && (source !== "manual") && (rawGrid.length > 0 || fileError) && (
            <div role="alert" className={cn(surface.danger, "grid gap-2 p-3 text-xs")}>
              {fileError && <p>{fileError}</p>}
              {errors.map((error) => <p key={error}>{error}</p>)}
              {canTrim && <Button size="xs" variant="outline" className="justify-self-start" onClick={() => setTrim(true)}>Keep the first {TABLE_LIMITS.rows} rows and {TABLE_LIMITS.columns} columns</Button>}
            </div>
          )}
          {check && check.truncatedCells > 0 && errors.length === 0 && (
            <p className="text-xs text-muted-foreground">{check.truncatedCells} long {check.truncatedCells === 1 ? "cell is" : "cells are"} shortened to {TABLE_LIMITS.cellCharacters.toLocaleString()} characters.</p>
          )}

          <section aria-label="Preview" className="grid gap-1.5">
            <div className="flex items-baseline justify-between text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Preview</span>
              {source !== "manual" && check && grid.length > 0 && <span className="tabular-nums">{check.rows.toLocaleString()} rows × {check.columns} columns</span>}
            </div>
            {previewGrid.length && shownColumns ? (
              <div className={cn(surface.table, "max-h-64")}>
                <table className="w-full text-xs">
                  <tbody>
                    {previewGrid.map((row, r) => (
                      <tr key={r} className={cn("border-b last:border-0", r === 0 && previewHeader && surface.thead)}>
                        {row.slice(0, shownColumns).map((value, c) => (
                          <td key={c} dir="auto" className={cn("max-w-40 truncate px-2 py-1.5", r === 0 && previewHeader && "font-medium text-foreground")}>{value || <span className="text-muted-foreground/40">—</span>}</td>
                        ))}
                        {(previewGrid[0]?.length ?? 0) > shownColumns && <td className="px-2 text-muted-foreground">…</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={cn(surface.empty, "px-3 py-6 text-center text-xs text-muted-foreground")}>{source === "upload" ? "Choose a file to see its data here." : "Paste cells to see them here."}</p>
            )}
          </section>
        </div>

        <DialogFooter className="m-0 shrink-0 rounded-none border-t px-5 py-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!ready || reading} onClick={insert}>Insert table</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SizeInput({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2">
      <span className="text-muted-foreground">{label}</span>
      <InputGroup>
        <InputGroupInput type="number" min={1} max={max} value={value} onChange={(event) => onChange(Math.max(1, Math.min(max, Math.round(Number(event.target.value) || 1))))} />
        <InputGroupAddon align="inline-end">max {max}</InputGroupAddon>
      </InputGroup>
    </label>
  );
}
