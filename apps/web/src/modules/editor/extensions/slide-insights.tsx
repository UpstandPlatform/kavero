import { HugeiconsIcon } from "@hugeicons/react";
import { LayoutGridIcon } from "@hugeicons/core-free-icons";
import type { EditorExtension } from "./types";

function SlideOverview({ activeSlideId, doc }: { activeSlideId: string; doc: import("@Kavero/catalog-engine").CatalogDocument }) {
  const slide = doc.slides.find((candidate) => candidate.id === activeSlideId) ?? doc.slides[0];
  const slideNumber = Math.max(0, doc.slides.findIndex((candidate) => candidate.id === slide?.id)) + 1;
  const layerCount = slide?.elements.length ?? 0;

  return (
    <div
      title={`Slide ${slideNumber} of ${doc.slides.length} · ${layerCount} layers`}
      aria-label={`Slide ${slideNumber} of ${doc.slides.length}, ${layerCount} layers`}
      className="flex h-9 items-center gap-2 rounded-lg border bg-background/90 px-2.5 text-xs shadow-sm backdrop-blur"
    >
      <HugeiconsIcon icon={LayoutGridIcon} className="size-3.5 text-muted-foreground" />
      <span className="font-medium tabular-nums">{slideNumber} / {doc.slides.length} slides</span>
      <span aria-hidden className="text-muted-foreground">·</span>
      <span className="text-muted-foreground tabular-nums">{layerCount} layers</span>
    </div>
  );
}

export const slideInsightsExtension: EditorExtension = {
  manifest: {
    id: "com.kavero.slide-insights",
    name: "Slide overview",
    description: "A compact widget with slide and layer counts while you design.",
    version: "1.0.0",
    apiVersion: "1.0.0",
    publisher: { id: "kavero", name: "Kavero" },
    capabilities: ["catalog.read", "editor.ui"],
    types: ["widget"],
    categories: ["Productivity", "Layout"],
    license: "MIT",
  },
  contribute: ({ activeSlideId, doc }) => ({
    canvasWidgets: [{ id: "overview", content: <SlideOverview activeSlideId={activeSlideId} doc={doc} /> }],
  }),
};
