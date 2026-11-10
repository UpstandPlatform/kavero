"use client";

import { Button } from "@Kavero/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@Kavero/ui/components/dropdown-menu";
import { cn } from "@Kavero/ui/lib/utils";
import { ArrowLeftToLine, ArrowRightToLine, GripVertical, LayoutPanelLeft, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The editor's customizable workspace: side panels that can be resized, hidden,
 * and dragged to the left or right of the canvas and reordered. Saved per browser.
 */

export type PanelId = "pages" | "properties" | "chat";
export type Side = "left" | "right";
interface PanelState {
  id: PanelId;
  side: Side;
  width: number;
  open: boolean;
}
export interface WorkspaceLayout {
  panels: PanelState[];
}

const STORAGE_KEY = "kavero:editor-workspace";
const MIN_W = 200;
const MAX_W = 640;
export const PANEL_TITLES: Record<PanelId, string> = { pages: "Pages", properties: "Properties", chat: "Chat" };

const DEFAULT_LAYOUT: WorkspaceLayout = {
  panels: [
    { id: "pages", side: "left", width: 232, open: true },
    { id: "properties", side: "right", width: 288, open: true },
    { id: "chat", side: "right", width: 380, open: false },
  ],
};

function load(): WorkspaceLayout {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as WorkspaceLayout | null;
    if (!raw?.panels) return DEFAULT_LAYOUT;
    // Keep known panels only, add any new ones from the defaults.
    const panels = raw.panels.filter((p) => p.id in PANEL_TITLES).map((p) => ({ ...p, width: clampW(p.width), side: p.side === "left" ? "left" : "right" }) as PanelState);
    for (const d of DEFAULT_LAYOUT.panels) if (!panels.some((p) => p.id === d.id)) panels.push(d);
    return { panels };
  } catch {
    return DEFAULT_LAYOUT;
  }
}
const clampW = (w: number) => Math.round(Math.min(MAX_W, Math.max(MIN_W, Number.isFinite(w) ? w : 280)));

export interface WorkspaceApi {
  layout: WorkspaceLayout;
  isOpen: (id: PanelId) => boolean;
  toggle: (id: PanelId, open?: boolean) => void;
  move: (id: PanelId, side: Side, index: number) => void;
  resize: (id: PanelId, width: number) => void;
  reset: () => void;
}

export function useWorkspace(): WorkspaceApi {
  const [layout, setLayout] = useState<WorkspaceLayout>(DEFAULT_LAYOUT);
  const loaded = useRef(false);
  useEffect(() => {
    setLayout(load());
    loaded.current = true;
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // storage unavailable: the layout lasts for this visit
    }
  }, [layout]);

  const update = useCallback((fn: (panels: PanelState[]) => PanelState[]) => setLayout((l) => ({ panels: fn(l.panels) })), []);
  return {
    layout,
    isOpen: (id) => layout.panels.find((p) => p.id === id)?.open ?? false,
    toggle: (id, open) => update((ps) => ps.map((p) => (p.id === id ? { ...p, open: open ?? !p.open } : p))),
    resize: (id, width) => update((ps) => ps.map((p) => (p.id === id ? { ...p, width: clampW(width) } : p))),
    move: (id, side, index) =>
      update((ps) => {
        const moving = ps.find((p) => p.id === id);
        if (!moving) return ps;
        const rest = ps.filter((p) => p.id !== id);
        // `index` counts open panels on the target side, in display order.
        const sideOpen = rest.filter((p) => p.side === side && p.open);
        const before = sideOpen[index];
        const at = before ? rest.indexOf(before) : rest.length;
        rest.splice(at, 0, { ...moving, side, open: true });
        return rest;
      }),
    reset: () => setLayout(DEFAULT_LAYOUT),
  };
}

const DRAG_TYPE = "application/x-kavero-panel";

/**
 * Lays out [rail] [left panels] [canvas] [right panels]. Panels are dragged by the
 * grip in their header onto the drop lines that appear, and resized from their inner edge.
 */
export function Workspace({
  api,
  rail,
  center,
  renderPanel,
}: {
  api: WorkspaceApi;
  rail: ReactNode;
  center: ReactNode;
  /** Header extras (e.g. tabs) and body for each panel. */
  renderPanel: (id: PanelId) => { header?: ReactNode; body: ReactNode };
}) {
  const [dragging, setDragging] = useState<PanelId | null>(null);
  const open = api.layout.panels.filter((p) => p.open);
  const left = open.filter((p) => p.side === "left");
  const right = open.filter((p) => p.side === "right");

  const dropLine = (side: Side, index: number) =>
    dragging ? (
      <div
        key={`drop-${side}-${index}`}
        className="group/drop relative z-20 w-0"
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={(e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData(DRAG_TYPE) as PanelId;
          if (id) api.move(id, side, index);
          setDragging(null);
        }}
      >
        {/* Wide invisible target with a visible line in the middle. */}
        <div className="absolute inset-y-0 -left-6 w-12">
          <div className="mx-auto h-full w-1 rounded-full bg-primary/25 group-hover/drop:bg-primary" />
        </div>
      </div>
    ) : null;

  const column = (side: Side, panels: PanelState[]) => (
    <>
      {dropLine(side, 0)}
      {panels.map((p, i) => (
        <Fragment key={p.id}>
          <PanelFrame
            panel={p}
            api={api}
            dragging={dragging === p.id}
            onDragStart={() => setDragging(p.id)}
            onDragEnd={() => setDragging(null)}
            {...renderPanel(p.id)}
          />
          {dropLine(side, i + 1)}
        </Fragment>
      ))}
    </>
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {rail}
      {column("left", left)}
      <main className="relative min-h-0 min-w-0 flex-1">{center}</main>
      {column("right", right)}
    </div>
  );
}

function PanelFrame({
  panel,
  api,
  header,
  body,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  panel: PanelState;
  api: WorkspaceApi;
  header?: ReactNode;
  body: ReactNode;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const title = PANEL_TITLES[panel.id];
  const onResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panel.width;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => api.resize(panel.id, panel.side === "left" ? startW + (ev.clientX - startX) : startW - (ev.clientX - startX));
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  };

  return (
    <aside
      aria-label={title}
      style={{ width: panel.width }}
      className={cn(
        "relative flex min-h-0 shrink-0 flex-col bg-background transition-opacity",
        panel.side === "left" ? "border-r" : "border-l",
        dragging && "opacity-40",
      )}
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-1.5">
        <button
          type="button"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_TYPE, panel.id);
            e.dataTransfer.effectAllowed = "move";
            onDragStart();
          }}
          onDragEnd={onDragEnd}
          className="grid size-6 shrink-0 cursor-grab place-items-center rounded-md text-muted-foreground hover:bg-muted active:cursor-grabbing"
          title={`Drag to move ${title}`}
          aria-label={`Move the ${title} panel (drag to the other side or reorder)`}
        >
          <GripVertical className="size-3.5" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-1">{header ?? <span className="truncate text-xs font-medium">{title}</span>}</div>
        <Button
          variant="ghost"
          size="icon-xs"
          title={panel.side === "left" ? "Move to the right side" : "Move to the left side"}
          aria-label={panel.side === "left" ? `Move ${title} to the right side` : `Move ${title} to the left side`}
          onClick={() => api.move(panel.id, panel.side === "left" ? "right" : "left", panel.side === "left" ? 0 : Number.MAX_SAFE_INTEGER)}
        >
          {panel.side === "left" ? <ArrowRightToLine /> : <ArrowLeftToLine />}
        </Button>
        <Button variant="ghost" size="icon-xs" title={`Hide ${title}`} aria-label={`Hide the ${title} panel`} onClick={() => api.toggle(panel.id, false)}><X /></Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{body}</div>
      {/* Resize from the edge facing the canvas. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${title}`}
        tabIndex={0}
        onPointerDown={onResizeStart}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            const grow = (e.key === "ArrowRight") === (panel.side === "left");
            api.resize(panel.id, panel.width + (grow ? 16 : -16));
          }
        }}
        className={cn(
          "absolute inset-y-0 z-10 w-1.5 cursor-col-resize hover:bg-primary/30 focus-visible:bg-primary/40 focus-visible:outline-none",
          panel.side === "left" ? "-right-0.75" : "-left-0.75",
        )}
      />
    </aside>
  );
}

/** Rail menu to show/hide panels and reset the layout. */
export function WorkspaceMenu({ api }: { api: WorkspaceApi }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Workspace: show, hide and reset panels" title="Workspace" />}>
        <LayoutPanelLeft />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Panels</DropdownMenuLabel>
          {api.layout.panels.map((p) => (
            <DropdownMenuCheckboxItem key={p.id} checked={p.open} onCheckedChange={(v) => api.toggle(p.id, !!v)}>
              {PANEL_TITLES[p.id]} <span className="ml-auto text-xs text-muted-foreground">{p.side}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={api.reset}>Reset layout</DropdownMenuItem>
        <p className="px-2 py-1.5 text-xs text-muted-foreground">Drag a panel by its grip to move it; drag its inner edge to resize.</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
