"use client";

import { buildCatalog, heuristicPlan } from "@Kavero/ai/browser";
import { buildTimeline } from "@Kavero/animation-engine";
import type { Product } from "@Kavero/catalog-engine";
import { CatalogFonts, FrameView } from "@Kavero/renderer";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

const SAMPLE: Product[] = [
  { id: "p1", name: "Weekender Bag", description: "Full-grain leather, hand stitched.", price: 640, category: "Bags", imageAssetIds: [], attributes: {} },
  { id: "p2", name: "City Tote", description: "Everyday carry in soft calf.", price: 320, category: "Bags", imageAssetIds: [], attributes: {} },
  { id: "p3", name: "Card Holder", description: "Six slots, slim profile.", price: 85, category: "Small leather goods", imageAssetIds: [], attributes: {} },
  { id: "p4", name: "Classic Belt", description: "Solid brass buckle.", price: 120, category: "Small leather goods", imageAssetIds: [], attributes: {} },
];

/**
 * A real Kavero catalog, planned by the built-in planner and played by the same
 * renderer and animation engine used for previews, websites and video export.
 */
export function HomePreview() {
  const doc = useMemo(() => {
    const input = { brief: "Autumn Leather Collection", products: SAMPLE, templateId: "dark-luxury", page: "16:9" as const, currency: "EUR" };
    return buildCatalog(heuristicPlan(input), input);
  }, []);
  const timeline = useMemo(() => buildTimeline(doc), [doc]);
  const [time, setTime] = useState(0);
  const [scale, setScale] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(e!.contentRect.width / doc.settings.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc.settings.width]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setTime(1500);
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setTime((now - start) % timeline.totalMs);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [timeline.totalMs]);

  return (
    <div ref={box} className="aspect-video w-full overflow-hidden rounded-xl border bg-muted shadow-2xl" aria-label="Animated example catalog" role="img">
      <CatalogFonts doc={doc} />
      {scale > 0 && <FrameView doc={doc} timeline={timeline} timeMs={time} scale={scale} />}
    </div>
  );
}
