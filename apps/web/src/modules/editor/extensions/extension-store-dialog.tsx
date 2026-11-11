"use client";

import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CheckmarkCircle02Icon,
  Download04Icon,
  LayoutGridIcon,
  Plug01Icon,
  PuzzleIcon,
  Search01Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { Badge } from "@Kavero/ui/components/badge";
import { Button } from "@Kavero/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@Kavero/ui/components/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@Kavero/ui/components/empty";
import { Input } from "@Kavero/ui/components/input";
import { ScrollArea } from "@Kavero/ui/components/scroll-area";
import type {
  ExtensionCapability,
  ExtensionManifest,
  ExtensionType,
} from "@Kavero/extensions";
import { cn } from "@Kavero/ui/lib/utils";

export interface ExtensionStoreEntry {
  manifest: ExtensionManifest;
  installed: boolean;
  enabled: boolean;
  updateAvailable: boolean;
  canUpdate: boolean;
}

export const CAPABILITY_LABELS: Record<ExtensionCapability, string> = {
  "catalog.read": "Read catalog data",
  "catalog.write": "Edit catalog data",
  "catalog.storage": "Private extension storage",
  "editor.ui": "Editor panels and tools",
  "editor.render": "Render slide content",
  "assets.read": "Read media",
  "assets.write": "Manage media",
  "network.fetch": "External network access",
  "ai.invoke": "AI requests",
  "integrations.call": "Run tools on connected services",
  "extension.messaging": "Communicate with other extensions",
};

export const EXTENSION_TYPE_LABELS: Record<ExtensionType, string> = {
  plugin: "Plugins",
  widget: "Widgets",
  "shader-effect": "Shader effects",
  "shader-fill": "Shader fills",
  integration: "Integrations",
};

const TYPE_TABS: { value: string; label: string; type?: ExtensionType }[] = [
  { value: "all", label: "All tools" },
  { value: "plugin", label: "Plugins", type: "plugin" },
  { value: "widget", label: "Widgets", type: "widget" },
  { value: "shader-effect", label: "Effects", type: "shader-effect" },
  { value: "shader-fill", label: "Fills", type: "shader-fill" },
  { value: "integration", label: "Integrations", type: "integration" },
];

export function describeCapability(capability: ExtensionCapability) {
  return CAPABILITY_LABELS[capability];
}

function extensionTypes(manifest: ExtensionManifest): readonly ExtensionType[] {
  return manifest.types?.length ? manifest.types : ["plugin"];
}

function typeIcon(type: ExtensionType) {
  if (type === "widget") return LayoutGridIcon;
  if (type === "integration") return Plug01Icon;
  if (type === "shader-effect" || type === "shader-fill") return SparklesIcon;
  return PuzzleIcon;
}

function primaryType(manifest: ExtensionManifest) {
  return extensionTypes(manifest)[0] ?? "plugin";
}

function runLabel(manifest: ExtensionManifest) {
  const type = primaryType(manifest);
  if (type === "shader-effect" || type === "shader-fill")
    return "Apply to selection";
  if (type === "integration") return "Open integration";
  if (type === "widget") return "Open widget";
  return "Run";
}

export function ExtensionStoreDialog({
  extensions,
  selectedElementCount = 0,
  onAction,
  onRun,
  onApply,
  onClose,
}: {
  extensions: ExtensionStoreEntry[];
  selectedElementCount?: number;
  onAction: (
    id: string,
    action: "install" | "enable" | "disable" | "update" | "uninstall",
  ) => void | Promise<void>;
  onRun?: (id: string) => void | Promise<void>;
  onApply?: (id: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [activeType, setActiveType] = useState("all");
  const [installedOnly, setInstalledOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(
    extensions[0]?.manifest.id ?? null,
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return extensions.filter((entry) => {
      const types = extensionTypes(entry.manifest);
      if (activeType !== "all" && !types.includes(activeType as ExtensionType))
        return false;
      if (installedOnly && !entry.installed) return false;
      if (!needle) return true;
      return [
        entry.manifest.name,
        entry.manifest.description,
        entry.manifest.publisher.name,
        ...(entry.manifest.categories ?? []),
      ].some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [activeType, extensions, installedOnly, search]);

  const selected =
    filtered.find((entry) => entry.manifest.id === selectedId) ??
    filtered[0] ??
    null;

  function primaryAction(entry: ExtensionStoreEntry) {
    if (entry.updateAvailable)
      return {
        label: entry.canUpdate ? "Update" : "Update unavailable",
        action: "update" as const,
        disabled: !entry.canUpdate,
      };
    if (!entry.installed)
      return { label: "Install", action: "install" as const, disabled: false };
    if (!entry.enabled)
      return { label: "Enable", action: "enable" as const, disabled: false };
    return {
      label: runLabel(entry.manifest),
      action: "run" as const,
      disabled: false,
    };
  }

  function actionDisabled(entry: ExtensionStoreEntry) {
    const action = primaryAction(entry);
    if (action.disabled) return true;
    if (action.action !== "run") return false;
    return primaryType(entry.manifest).startsWith("shader")
      ? selectedElementCount === 0 || !onApply
      : !onRun;
  }

  async function activate(entry: ExtensionStoreEntry) {
    const action = primaryAction(entry);
    if (action.action !== "run") {
      await onAction(entry.manifest.id, action.action);
      return;
    }
    const type = primaryType(entry.manifest);
    if (type === "shader-effect" || type === "shader-fill")
      await onApply?.(entry.manifest.id);
    else await onRun?.(entry.manifest.id);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        style={{ width: "min(1120px, calc(100vw - 1rem))", maxWidth: "none" }}
        className="flex max-h-[min(92dvh,840px)] min-h-[min(600px,90dvh)] w-full max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-[1120px]"
      >
        <DialogHeader className="gap-4 border-b px-4 py-4 pe-12 sm:px-7 sm:py-5 sm:pe-14">
          <div className="flex min-w-0 items-start justify-between gap-4">
            <div className="grid min-w-0 gap-1">
              <DialogTitle className="flex items-center gap-2 text-lg">
                <HugeiconsIcon
                  icon={PuzzleIcon}
                  className="size-5 text-primary"
                />{" "}
                Extension store
              </DialogTitle>
              <DialogDescription className="max-w-2xl">
                Add tools to your canvas. Plugins and integrations run on
                demand; widgets and visual effects work with your selected
                elements.
              </DialogDescription>
            </div>
            <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
              Kavero verified
            </Badge>
          </div>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <HugeiconsIcon
                icon={Search01Icon}
                className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                aria-label="Search extensions"
                placeholder="Search tools, publishers, or categories"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-10 rounded-xl bg-muted/40 ps-9"
              />
            </div>
            <Button
              variant={installedOnly ? "secondary" : "outline"}
              size="sm"
              aria-pressed={installedOnly}
              onClick={() => setInstalledOnly((value) => !value)}
              className="h-10 shrink-0 gap-2 px-3"
            >
              <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-4" />
              Installed{" "}
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]">
                {extensions.filter((entry) => entry.installed).length}
              </span>
            </Button>
          </div>
          <div
            role="group"
            aria-label="Filter extension types"
            className="flex min-w-0 items-center gap-1 overflow-x-auto border-b -mb-4 pb-1 [scrollbar-width:thin]"
          >
            {TYPE_TABS.map((tab) => {
              const count = tab.type
                ? extensions.filter((entry) =>
                    extensionTypes(entry.manifest).includes(tab.type!),
                  ).length
                : extensions.length;
              return (
                <button
                  key={tab.value}
                  type="button"
                  aria-pressed={activeType === tab.value}
                  onClick={() => setActiveType(tab.value)}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-primary aria-pressed:text-foreground sm:text-sm",
                    activeType === tab.value &&
                      "border-primary text-foreground",
                  )}
                >
                  {tab.label}
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-rows-[minmax(145px,0.8fr)_minmax(0,1.2fr)] lg:grid-cols-[minmax(320px,0.85fr)_minmax(0,1.15fr)] lg:grid-rows-1">
          <section
            aria-label="Available extensions"
            className="flex min-h-0 min-w-0 flex-col border-b lg:border-b-0 lg:border-e"
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
              <span className="text-sm font-semibold">
                Browse tools{" "}
                <span className="ms-1 text-xs font-normal text-muted-foreground">
                  {filtered.length}
                </span>
              </span>
              <span className="text-[11px] text-muted-foreground">
                Verified for this deployment
              </span>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              {filtered.length ? (
                <div
                  role="group"
                  aria-label="Extensions"
                  className="grid gap-2 px-3 pb-4 sm:px-4"
                >
                  {filtered.map((entry) => {
                    const { manifest } = entry;
                    const active = selected?.manifest.id === manifest.id;
                    const type = primaryType(manifest);
                    return (
                      <button
                        key={manifest.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setSelectedId(manifest.id)}
                        className={cn(
                          "group flex min-w-0 items-center gap-3 rounded-xl border p-3 text-start transition-colors outline-none hover:border-border hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring",
                          active
                            ? "border-primary/40 bg-primary/5 shadow-sm"
                            : "border-transparent",
                        )}
                      >
                        <span
                          className={cn(
                            "grid size-12 shrink-0 place-items-center rounded-xl border bg-gradient-to-br from-muted to-background text-foreground shadow-sm",
                            type.startsWith("shader") &&
                              "border-primary/20 from-primary/15 to-primary/5 text-primary",
                            type === "integration" &&
                              "from-secondary to-background text-secondary-foreground",
                          )}
                        >
                          <HugeiconsIcon
                            icon={typeIcon(type)}
                            className="size-5"
                          />
                        </span>
                        <span className="grid min-w-0 flex-1 gap-1">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-sm font-semibold">
                              {manifest.name}
                            </span>
                            {entry.updateAvailable && (
                              <Badge
                                variant="secondary"
                                className="shrink-0 px-1.5 py-0 text-[10px]"
                              >
                                Update
                              </Badge>
                            )}
                          </span>
                          <span className="line-clamp-1 text-xs leading-relaxed text-muted-foreground">
                            {manifest.description}
                          </span>
                          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                            <span className="truncate">
                              {manifest.publisher.name}
                            </span>
                            <span aria-hidden>·</span>
                            <span className="truncate">
                              {EXTENSION_TYPE_LABELS[type]}
                            </span>
                          </span>
                        </span>
                        {entry.installed && (
                          <span
                            className={cn(
                              "shrink-0 rounded-full px-2 py-1 text-[10px] font-medium",
                              entry.enabled
                                ? "bg-primary/10 text-primary"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {entry.enabled ? "Added" : "Off"}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <Empty className="min-h-64 border-0 px-6 py-12">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <HugeiconsIcon icon={PuzzleIcon} />
                    </EmptyMedia>
                    <EmptyTitle>No tools found</EmptyTitle>
                    <EmptyDescription>
                      Try another search or choose a different type.
                    </EmptyDescription>
                  </EmptyHeader>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearch("");
                      setActiveType("all");
                      setInstalledOnly(false);
                    }}
                  >
                    Clear filters
                  </Button>
                </Empty>
              )}
            </ScrollArea>
          </section>

          <aside
            aria-label="Selected extension details"
            className="flex min-h-0 min-w-0 flex-col bg-muted/10"
          >
            {selected ? (
              <>
                <ScrollArea className="min-h-0 flex-1">
                  <div className="grid gap-6 p-5 sm:p-7">
                    <div className="flex items-start gap-4">
                      <span
                        className={cn(
                          "grid size-14 shrink-0 place-items-center rounded-2xl border bg-gradient-to-br from-muted to-background shadow-sm",
                          primaryType(selected.manifest).startsWith("shader") &&
                            "border-primary/20 from-primary/15 to-primary/5 text-primary",
                        )}
                      >
                        <HugeiconsIcon
                          icon={typeIcon(primaryType(selected.manifest))}
                          className="size-6"
                        />
                      </span>
                      <div className="grid min-w-0 gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-xl font-semibold tracking-tight">
                            {selected.manifest.name}
                          </h2>
                          {selected.installed && (
                            <Badge
                              variant={
                                selected.enabled ? "secondary" : "outline"
                              }
                            >
                              {selected.enabled ? "Installed" : "Disabled"}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          By {selected.manifest.publisher.name}{" "}
                          <span aria-hidden>·</span> Version{" "}
                          {selected.manifest.version}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {extensionTypes(selected.manifest).map((item) => (
                            <Badge key={item} variant="secondary">
                              {EXTENSION_TYPE_LABELS[item]}
                            </Badge>
                          ))}
                          {selected.manifest.license && (
                            <Badge variant="outline">
                              {selected.manifest.license}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
                      {selected.manifest.description}
                    </p>
                    {selected.manifest.categories?.length ? (
                      <div className="grid gap-2">
                        <h3 className="text-xs font-semibold">Categories</h3>
                        <div className="flex flex-wrap gap-1.5">
                          {selected.manifest.categories.map((category) => (
                            <Badge key={category} variant="outline">
                              {category}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className="grid gap-3 rounded-xl border bg-background/70 p-4">
                      <div>
                        <h3 className="text-sm font-semibold">
                          Access requested
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Review what this tool can access before adding it.
                        </p>
                      </div>
                      <ul className="grid gap-2 sm:grid-cols-2">
                        {selected.manifest.capabilities.map((capability) => (
                          <li
                            key={capability}
                            className="flex min-w-0 items-start gap-2 text-xs text-muted-foreground"
                          >
                            <HugeiconsIcon
                              icon={CheckmarkCircle02Icon}
                              className="mt-0.5 size-4 shrink-0 text-primary"
                            />
                            {CAPABILITY_LABELS[capability]}
                          </li>
                        ))}
                        {selected.manifest.capabilities.length === 0 && (
                          <li className="text-xs text-muted-foreground">
                            No special access requested.
                          </li>
                        )}
                      </ul>
                    </div>
                    <div className="rounded-xl border border-primary/15 bg-primary/5 p-4 text-xs leading-relaxed text-muted-foreground">
                      Only code bundled and approved by this Kavero deployment
                      can run. External integrations use connections you choose;
                      stored credentials stay on the server.
                    </div>
                  </div>
                </ScrollArea>
                <div className="grid gap-2 border-t bg-background/90 p-4 sm:px-5">
                  <Button
                    className="w-full"
                    disabled={actionDisabled(selected)}
                    onClick={() => void activate(selected)}
                  >
                    {primaryAction(selected).action === "install" && (
                      <HugeiconsIcon
                        icon={Download04Icon}
                        data-icon="inline-start"
                      />
                    )}
                    {primaryAction(selected).label}
                  </Button>
                  {selected.installed &&
                    !selected.enabled &&
                    !selected.manifest.defaultEnabled && (
                      <Button
                        variant="ghost"
                        className="w-full"
                        onClick={() =>
                          void onAction(selected.manifest.id, "uninstall")
                        }
                      >
                        Uninstall
                      </Button>
                    )}
                  {selected.installed && selected.enabled && (
                    <Button
                      variant="ghost"
                      className="w-full"
                      onClick={() =>
                        void onAction(selected.manifest.id, "disable")
                      }
                    >
                      Disable
                    </Button>
                  )}
                  {primaryType(selected.manifest).startsWith("shader") &&
                    selectedElementCount === 0 && (
                      <p className="text-center text-xs text-muted-foreground">
                        Select an element on the canvas to apply this effect.
                      </p>
                    )}
                </div>
              </>
            ) : (
              <Empty className="min-h-64 border-0 p-6">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <HugeiconsIcon icon={PuzzleIcon} />
                  </EmptyMedia>
                  <EmptyTitle>Choose a tool</EmptyTitle>
                  <EmptyDescription>
                    Tool details and install actions will appear here.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </aside>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t px-4 py-3 text-xs text-muted-foreground sm:px-6">
          <span>
            {extensions.length} verified{" "}
            {extensions.length === 1 ? "tool" : "tools"}{" "}
            <span className="hidden sm:inline">available in this store</span>
          </span>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
