"use client";

import { ChevronRight } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type MenuItem =
  | { type?: "item"; label: string; icon?: ReactNode; shortcut?: string; disabled?: boolean; danger?: boolean; checked?: boolean; onSelect: () => void }
  | { type: "submenu"; label: string; icon?: ReactNode; disabled?: boolean; items: MenuItem[] }
  | { type: "separator" }
  | { type: "label"; label: string };

type Open = (e: { clientX: number; clientY: number; preventDefault?: () => void }, items: MenuItem[]) => void;

const Ctx = createContext<Open>(() => undefined);

/** Open a context menu at the pointer: `const open = useContextMenu(); onContextMenu={(e) => open(e, items)}` */
export function useContextMenu() {
  return useContext(Ctx);
}

/** Provides one shared, keyboard-accessible context menu for its subtree. */
export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const open = useCallback<Open>((e, items) => {
    e.preventDefault?.();
    if (!items.some((i) => i.type !== "separator" && i.type !== "label")) return;
    setMenu({ x: e.clientX, y: e.clientY, items });
  }, []);
  return (
    <Ctx.Provider value={open}>
      {children}
      {menu && typeof document !== "undefined" && createPortal(<MenuList x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} root />, document.body)}
    </Ctx.Provider>
  );
}

const isActionable = (i: MenuItem) => (i.type === undefined || i.type === "item" || i.type === "submenu") && !("disabled" in i && i.disabled);

function MenuList({ x, y, items, onClose, root, onBack, focus }: { x: number; y: number; items: MenuItem[]; onClose: () => void; root?: boolean; onBack?: () => void; focus?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [active, setActive] = useState(-1);
  const [sub, setSub] = useState<{ index: number; x: number; y: number; kb?: boolean } | null>(null);

  // Keep the menu inside the viewport.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) });
    if (root || focus) {
      el.focus();
      if (focus) setActive(items.findIndex(isActionable));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, root, focus]);

  useEffect(() => {
    if (!root) return;
    const close = (e: Event) => {
      if (e.type === "pointerdown" && (e.target as HTMLElement).closest?.("[data-kv-menu]")) return;
      onClose();
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("wheel", close, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("wheel", close);
    };
  }, [root, onClose]);

  const openSub = (index: number, target: HTMLElement, kb = false) => {
    const r = target.getBoundingClientRect();
    setSub({ index, x: r.right - 2, y: r.top - 4, kb });
  };

  const choose = (index: number, target: HTMLElement, kb = false) => {
    const item = items[index];
    if (!item || !isActionable(item)) return;
    if (item.type === "submenu") return openSub(index, target, kb);
    if (item.type === undefined || item.type === "item") {
      onClose();
      item.onSelect();
    }
  };

  const move = (dir: 1 | -1) => {
    for (let i = 1; i <= items.length; i++) {
      const next = (active + dir * i + items.length) % items.length;
      if (isActionable(items[next]!)) return setActive(next);
    }
  };

  return (
    <div
      ref={ref}
      data-kv-menu
      role="menu"
      tabIndex={-1}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
        else if (e.key === "Escape") { e.preventDefault(); onBack ? onBack() : onClose(); }
        else if (e.key === "ArrowLeft" && onBack) { e.preventDefault(); onBack(); }
        else if ((e.key === "Enter" || e.key === " " || e.key === "ArrowRight") && active >= 0) {
          e.preventDefault();
          const el = ref.current?.querySelectorAll<HTMLElement>("[data-index]")[active];
          if (el && (e.key !== "ArrowRight" || items[active]?.type === "submenu")) choose(active, el, true);
        }
      }}
      className="fixed z-[1000] min-w-52 rounded-lg border bg-popover p-1 text-xs text-popover-foreground shadow-lg outline-none"
      style={{ left: pos.x, top: pos.y }}
    >
      {items.map((item, i) => {
        if (item.type === "separator") return <div key={i} role="separator" className="-mx-1 my-1 h-px bg-border" />;
        if (item.type === "label") return <div key={i} className="px-2 py-1 text-[11px] font-medium text-muted-foreground">{item.label}</div>;
        const disabled = !!item.disabled;
        return (
          <div
            key={i}
            data-index={i}
            role="menuitem"
            aria-disabled={disabled}
            aria-haspopup={item.type === "submenu" || undefined}
            tabIndex={-1}
            onPointerEnter={(e) => {
              setActive(i);
              if (item.type === "submenu" && !disabled) openSub(i, e.currentTarget);
              else setSub(null);
            }}
            onClick={(e) => choose(i, e.currentTarget)}
            className={`flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 select-none ${active === i ? "bg-accent text-accent-foreground" : ""} ${disabled ? "opacity-40" : ""} ${"danger" in item && item.danger ? "text-destructive" : ""} [&_svg]:size-3.5 [&_svg]:shrink-0`}
          >
            <span className="flex size-3.5 items-center justify-center">{item.icon ?? ("checked" in item && item.checked ? "✓" : null)}</span>
            <span className="flex-1">{item.label}</span>
            {"shortcut" in item && item.shortcut && <kbd className="ml-4 font-sans text-[10px] tracking-wide text-muted-foreground">{item.shortcut}</kbd>}
            {item.type === "submenu" && <ChevronRight className="text-muted-foreground" />}
          </div>
        );
      })}
      {sub && items[sub.index]?.type === "submenu" && (
        <MenuList x={sub.x} y={sub.y} items={(items[sub.index] as { items: MenuItem[] }).items} onClose={onClose} focus={sub.kb} onBack={() => { setSub(null); ref.current?.focus(); }} />
      )}
    </div>
  );
}
