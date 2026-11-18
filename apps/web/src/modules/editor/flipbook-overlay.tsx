"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import type { CatalogDocument } from "@Kavero/catalog-engine";
import { CatalogFonts, Flipbook, type ExtensionEffectRegistry, type ExtensionRendererRegistry } from "@Kavero/renderer";
import { Button } from "@Kavero/ui/components/button";
import { useEffect } from "react";

/** Full-screen flipbook preview of the catalog, opened from the editor toolbar. */
export function FlipbookOverlay({ doc, startSlide, assetUrls, onClose, extensionRenderers, extensionEffects }: {
  doc: CatalogDocument;
  startSlide: number;
  assetUrls: Record<string, string>;
  onClose: () => void;
  extensionRenderers?: ExtensionRendererRegistry;
  extensionEffects?: ExtensionEffectRegistry;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#1b1b22] text-white" role="dialog" aria-modal="true" aria-label="Flipbook preview">
      <Button variant="ghost" size="icon-sm" className="absolute right-3 top-3 z-10 text-white hover:bg-white/10" title="Close (Esc)" aria-label="Close" onClick={onClose}>
        <HugeiconsIcon icon={Cancel01Icon} />
      </Button>
      <div className="min-h-0 flex-1">
        <Flipbook
          doc={doc}
          initialSlide={startSlide}
          resolveAsset={(id) => assetUrls[id]}
          extensionRenderers={extensionRenderers}
          extensionEffects={extensionEffects}
        />
      </div>
    </div>
  );
}
