import { HugeiconsIcon } from "@hugeicons/react";
import { LayoutGridIcon } from "@hugeicons/core-free-icons";
import { Badge } from "@Kavero/ui/components/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@Kavero/ui/components/card";
import type { EditorExtension } from "./types";

function SlideOverview({ activeSlideId, doc }: { activeSlideId: string; doc: import("@Kavero/catalog-engine").CatalogDocument }) {
  const slide = doc.slides.find((candidate) => candidate.id === activeSlideId) ?? doc.slides[0];
  const typeCounts = new Map<string, number>();
  for (const element of slide?.elements ?? []) typeCounts.set(element.type, (typeCounts.get(element.type) ?? 0) + 1);
  const sortedTypes = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="grid gap-3 p-3">
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><HugeiconsIcon icon={LayoutGridIcon} /> Slide overview</CardTitle>
          <CardDescription>Quick counts for this presentation and the active slide.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <dl className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-muted/60 p-3"><dt className="text-xs text-muted-foreground">Slides</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{doc.slides.length}</dd></div>
            <div className="rounded-xl bg-muted/60 p-3"><dt className="text-xs text-muted-foreground">Active layers</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{slide?.elements.length ?? 0}</dd></div>
          </dl>
          <div className="grid gap-2">
            <h3 className="text-xs font-medium">Layers on this slide</h3>
            {sortedTypes.length ? <div className="flex flex-wrap gap-1.5">{sortedTypes.map(([type, count]) => <Badge key={type} variant="outline">{type} · {count}</Badge>)}</div> : <p className="text-xs text-muted-foreground">No layers on this slide yet.</p>}
          </div>
        </CardContent>
      </Card>
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
    panels: [{
      id: "overview",
      label: "Slide overview",
      icon: <HugeiconsIcon icon={LayoutGridIcon} />,
      content: <SlideOverview activeSlideId={activeSlideId} doc={doc} />,
    }],
  }),
};
