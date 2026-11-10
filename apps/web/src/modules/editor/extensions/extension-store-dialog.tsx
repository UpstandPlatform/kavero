"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle02Icon, Download04Icon, PuzzleIcon } from "@hugeicons/core-free-icons";
import { Badge } from "@Kavero/ui/components/badge";
import { Button } from "@Kavero/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@Kavero/ui/components/dialog";
import type { ExtensionCapability, ExtensionManifest } from "@Kavero/extensions";

export interface ExtensionStoreEntry {
  manifest: ExtensionManifest;
  installed: boolean;
  enabled: boolean;
  updateAvailable: boolean;
  canUpdate: boolean;
}

export const CAPABILITY_LABELS: Record<ExtensionCapability, string> = {
  "catalog.read": "Catalog data",
  "catalog.write": "Edit catalog",
  "catalog.storage": "Private extension storage",
  "editor.ui": "Editor panels and tools",
  "editor.render": "Render slide elements",
  "assets.read": "Read media",
  "assets.write": "Manage media",
  "network.fetch": "External network access",
  "ai.invoke": "AI requests",
  "extension.messaging": "Communicate with other extensions",
};

export function describeCapability(capability: ExtensionCapability) {
  return CAPABILITY_LABELS[capability];
}

export function ExtensionStoreDialog({ extensions, onAction, onClose }: {
  extensions: ExtensionStoreEntry[];
  onAction: (id: string, action: "install" | "enable" | "disable" | "update" | "uninstall") => void | Promise<void>;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[min(82vh,720px)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><HugeiconsIcon icon={PuzzleIcon} /> Extension store</DialogTitle>
          <DialogDescription>Install editor extensions into this catalog. Each extension declares the capabilities it needs.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {extensions.length === 0 ? (
            <div className="grid justify-items-center gap-2 rounded-2xl border border-dashed px-6 py-10 text-center">
              <HugeiconsIcon icon={PuzzleIcon} className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium">No compatible extensions yet</p>
              <p className="max-w-md text-xs text-muted-foreground">Extensions become available here after they are published for this Kavero version.</p>
            </div>
          ) : extensions.map(({ manifest, installed, enabled, updateAvailable, canUpdate }) => {
            const action = updateAvailable ? "update" : !installed ? "install" : enabled ? "disable" : "enable";
            const label = action === "update" ? (canUpdate ? "Update" : "Update unavailable") : !installed ? "Install" : enabled ? "Disable" : "Enable";
            return (
              <article key={manifest.id} className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <div className="grid min-w-0 gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">{manifest.name}</h3>
                    <Badge variant="outline">{manifest.publisher.name}</Badge>
                    {installed && <Badge variant={enabled ? "secondary" : "ghost"}><HugeiconsIcon icon={CheckmarkCircle02Icon} />{enabled ? "Enabled" : "Disabled"}</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">{manifest.description}</p>
                  <p className="text-xs text-muted-foreground">Version {manifest.version}{manifest.license ? ` · ${manifest.license}` : ""}</p>
                  <div className="flex flex-wrap gap-1.5" aria-label="Requested capabilities">
                    {manifest.capabilities.map((capability) => (
                      <Badge key={capability} variant="outline" className="font-normal">{CAPABILITY_LABELS[capability] ?? capability}</Badge>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 sm:flex-col sm:items-stretch">
                  <Button size="sm" disabled={action === "update" && !canUpdate} variant={action === "disable" ? "outline" : "default"} onClick={() => onAction(manifest.id, action)}>
                    {!installed && <HugeiconsIcon icon={Download04Icon} />}{label}
                  </Button>
                  {installed && !enabled && !manifest.defaultEnabled && (
                    <Button size="sm" variant="ghost" onClick={() => onAction(manifest.id, "uninstall")}>Uninstall</Button>
                  )}
                </div>
                {updateAvailable && !canUpdate && <p className="text-xs text-destructive sm:col-span-2">This extension’s stored data has no migration path to the available version. Keep the current bundle or contact its publisher.</p>}
              </article>
            );
          })}
        </div>
        <DialogFooter>
          <p className="me-auto max-w-lg text-start text-xs text-muted-foreground">Only extensions bundled and approved by this Kavero deployment appear in this store.</p>
          <Button variant="outline" onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
