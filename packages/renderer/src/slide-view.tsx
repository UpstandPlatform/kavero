import {
  resolveToken,
  type CatalogDocument,
  type CatalogElement,
  type CatalogSlide,
  type ElementPosition,
  type Product,
} from "@Kavero/catalog-engine";
import { elementStateAt, scheduleSlide, stateToCss, type ScheduledAnimation } from "@Kavero/animation-engine";
import { createContext, memo, useContext, useMemo, type CSSProperties, type ReactNode } from "react";

import { embeddedFamilies, fontFaceCss, googleFontsUrl, usedFonts } from "./fonts";

/** Turns an asset id into a displayable URL (blob:, https:, data:). */
export type AssetResolver = (assetId: string) => string | undefined;

interface RenderContext {
  doc: CatalogDocument;
  resolveAsset: AssetResolver;
  /** "edit" shows placeholders for empty content; "present" hides them. */
  mode: "edit" | "present";
}

const Ctx = createContext<RenderContext | null>(null);
const useRender = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("Element rendered outside <SlideView>");
  return c;
};

export interface SlideViewProps {
  doc: CatalogDocument;
  slide: CatalogSlide;
  resolveAsset?: AssetResolver;
  mode?: "edit" | "present";
  /** Rendered scale; the slide is laid out at its native size and scaled with a transform. */
  scale?: number;
  /** Live position overrides (e.g. while dragging) so the document is only committed once. */
  overrides?: Record<string, Partial<ElementPosition>>;
  /** Element ids to skip, e.g. the text being edited inline. */
  hiddenIds?: Set<string>;
  /** Slide-local time in ms. When set, element animations are applied at that moment. */
  timeMs?: number;
  className?: string;
  children?: ReactNode;
}

/**
 * Deterministic slide renderer shared by the editor, presentation mode and
 * exports. Positions are in document pixels; nothing here depends on the editor.
 */
export const SlideView = memo(function SlideView({
  doc,
  slide,
  resolveAsset = () => undefined,
  mode = "present",
  scale = 1,
  overrides,
  hiddenIds,
  timeMs,
  className,
  children,
}: SlideViewProps) {
  const schedule = useMemo(() => (timeMs === undefined ? null : scheduleSlide(slide)), [slide, timeMs === undefined]);
  const { width: W, height: H } = doc.settings;
  const color = (v: string) => resolveToken(doc, v);
  const bg = slide.background;
  const background: CSSProperties =
    bg.kind === "color" ? { background: color(bg.color) }
    : bg.kind === "gradient" ? { background: `linear-gradient(${bg.angle}deg, ${color(bg.from)}, ${color(bg.to)})` }
    : { backgroundImage: `url("${resolveAsset(bg.assetId) ?? ""}")`, backgroundSize: bg.fit, backgroundPosition: "center" };

  const elements = [...slide.elements].sort((a, b) => a.zIndex - b.zIndex);

  return (
    <Ctx.Provider value={{ doc, resolveAsset, mode }}>
      <div className={className} style={{ width: W * scale, height: H * scale, overflow: "hidden", position: "relative" }}>
        <div
          data-slide-id={slide.id}
          style={{
            width: W, height: H, position: "absolute", left: 0, top: 0,
            transform: `scale(${scale})`, transformOrigin: "0 0",
            fontFamily: `${resolveToken(doc, "token:body", "fonts")}, system-ui, sans-serif`,
            color: color("token:text"),
            ...background,
          }}
        >
          {elements.map((el) =>
            el.hidden || hiddenIds?.has(el.id) ? null : (
              <ElementFrame key={el.id} element={el} position={{ ...el.position, ...overrides?.[el.id] }} schedule={schedule} timeMs={timeMs} />
            ),
          )}
          {children}
        </div>
      </div>
    </Ctx.Provider>
  );
});

function ElementFrame({ element, position: p, schedule, timeMs }: {
  element: CatalogElement;
  position: ElementPosition;
  schedule: ScheduledAnimation[] | null;
  timeMs?: number;
}) {
  // Animation transforms sit on an inner layer so they compose with the element's own rotation.
  const anim = schedule && timeMs !== undefined && element.animations.length ? stateToCss(elementStateAt(schedule, element.id, timeMs)) : null;
  return (
    <div
      data-element-id={element.id}
      style={{
        position: "absolute", left: p.x, top: p.y, width: p.width, height: p.height,
        transform: p.rotation ? `rotate(${p.rotation}deg)` : undefined,
        opacity: element.opacity, boxSizing: "border-box",
      }}
    >
      {anim ? (
        <div style={{ width: "100%", height: "100%", opacity: anim.opacity, transform: anim.transform, filter: anim.filter, transformOrigin: "50% 50%" }}>
          <ElementBody element={element} />
        </div>
      ) : (
        <ElementBody element={element} />
      )}
    </div>
  );
}

export function ElementBody({ element: el }: { element: CatalogElement }) {
  const { doc, resolveAsset, mode } = useRender();
  const color = (v: string) => resolveToken(doc, v);
  const fill: CSSProperties = { width: "100%", height: "100%" };

  switch (el.type) {
    case "text": {
      const s = el.style;
      return (
        <div
          style={{
            ...fill,
            fontFamily: `${resolveToken(doc, s.fontFamily, "fonts")}, system-ui, sans-serif`,
            fontSize: s.fontSize, fontWeight: s.fontWeight, lineHeight: s.lineHeight,
            letterSpacing: s.letterSpacing, textAlign: s.align, color: color(s.color),
            textDecoration: s.decoration === "none" ? undefined : s.decoration,
            fontStyle: s.italic ? "italic" : undefined,
            whiteSpace: "pre-wrap", overflowWrap: "break-word",
          }}
        >
          {el.content.paragraphs.map((runs, i) => (
            <p key={i} style={{ margin: 0, minHeight: "1em" }}>
              {runs.map((r, j) => {
                const style: CSSProperties = {
                  fontWeight: r.bold ? 700 : undefined, fontStyle: r.italic ? "italic" : undefined,
                  textDecoration: r.underline ? "underline" : undefined, color: r.color ? color(r.color) : undefined,
                };
                return r.href && mode === "present"
                  ? <a key={j} href={r.href} target="_blank" rel="noopener noreferrer" style={{ ...style, color: "inherit" }}>{r.text}</a>
                  : <span key={j} style={style}>{r.text}</span>;
              })}
            </p>
          ))}
        </div>
      );
    }
    case "shape": {
      const s = el.style;
      const stroke = s.stroke ? color(s.stroke) : "none";
      const common = { fill: color(s.fill), stroke, strokeWidth: s.strokeWidth, vectorEffect: "non-scaling-stroke" as const };
      const { width: w, height: h } = el.position;
      return (
        <svg width="100%" height="100%" viewBox={`0 0 ${Math.max(w, 1)} ${Math.max(h, 1)}`} preserveAspectRatio="none" style={{ display: "block", overflow: "visible" }}>
          {el.content.shape === "ellipse" && <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} {...common} />}
          {el.content.shape === "rect" && <rect width={w} height={h} rx={s.borderRadius} {...common} />}
          {el.content.shape === "triangle" && <polygon points={`${w / 2},0 ${w},${h} 0,${h}`} {...common} />}
          {(el.content.shape === "line" || el.content.shape === "arrow") && (
            <>
              <line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke={color(s.stroke ?? s.fill)} strokeWidth={Math.max(s.strokeWidth, 2)} />
              {el.content.shape === "arrow" && <polygon points={`${w},${h / 2} ${w - 14},${h / 2 - 8} ${w - 14},${h / 2 + 8}`} fill={color(s.stroke ?? s.fill)} />}
            </>
          )}
        </svg>
      );
    }
    case "image": {
      const s = el.style;
      const src = resolveAsset(el.content.assetId);
      const f = s.filters;
      const filter = f ? `brightness(${f.brightness}) contrast(${f.contrast}) saturate(${f.saturate}) grayscale(${f.grayscale})` : undefined;
      if (!src) return <Placeholder label="Image" radius={s.borderRadius} show={mode === "edit"} />;
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={el.content.alt} draggable={false} style={{ ...fill, objectFit: s.fit, borderRadius: s.borderRadius, filter, display: "block", userSelect: "none" }} />
      );
    }
    case "product": {
      const product = doc.products.find((p) => p.id === el.content.productId);
      return <ProductCard product={product} style={el.style} />;
    }
    case "product-grid": {
      const { columns, products } = el.content;
      const items: (Product | undefined)[] = products.length
        ? products.map((r) => doc.products.find((p) => p.id === r.productId))
        : mode === "edit" ? Array.from({ length: columns }, () => undefined) : [];
      return (
        // Rows share the element's height so cards (and their images) fill it.
        <div style={{ ...fill, display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${Math.max(1, Math.ceil(items.length / columns))}, minmax(0, 1fr))`, gap: el.style.gap }}>
          {items.map((p, i) => <ProductCard key={i} product={p} style={el.style} />)}
        </div>
      );
    }
    case "button":
      return (
        <a
          href={mode === "present" ? el.content.href : undefined}
          target="_blank"
          rel="noopener noreferrer"
          style={{ ...fill, display: "flex", alignItems: "center", justifyContent: "center", background: color(el.style.background), color: color(el.style.color), borderRadius: el.style.borderRadius, textDecoration: "none", fontWeight: 600 }}
        >
          {el.content.label}
        </a>
      );
    case "video": {
      const src = el.content.assetId ? resolveAsset(el.content.assetId) : el.content.url;
      const poster = el.content.posterAssetId ? resolveAsset(el.content.posterAssetId) : undefined;
      if (!src) return <Placeholder label="Video" show={mode === "edit"} />;
      return <video src={src} poster={poster} autoPlay={mode === "present" && el.style.autoplay} loop={el.style.loop} muted={el.style.muted} controls={mode === "present"} playsInline style={{ ...fill, objectFit: "cover", display: "block" }} />;
    }
    case "icon":
      return <Placeholder label={el.content.name} show={mode === "edit"} />;
    case "html":
      return <HtmlBlock html={el.content.html} css={el.content.css} background={el.style.background ? color(el.style.background) : undefined} interactive={mode === "present"} />;
  }
}

function ProductCard({ product, style: s }: { product: Product | undefined; style: { layout: string; showPrice: boolean; showDescription: boolean; background?: string; borderRadius: number } }) {
  const { doc, resolveAsset, mode } = useRender();
  if (!product) return <Placeholder label="Product" radius={s.borderRadius} show={mode === "edit"} minHeight={120} />;
  const img = product.imageAssetIds[0] ? resolveAsset(product.imageAssetIds[0]) : undefined;
  const price = product.price !== undefined
    ? new Intl.NumberFormat(doc.metadata.language, { style: "currency", currency: product.currency ?? doc.metadata.currency }).format(product.price)
    : null;
  const horizontal = s.layout === "horizontal";
  return (
    <div style={{
      width: "100%", height: "100%", display: "flex", flexDirection: horizontal ? "row" : "column", overflow: "hidden",
      borderRadius: s.borderRadius, background: s.background ? resolveToken(doc, s.background) : "transparent", gap: 12,
    }}>
      <div style={{ flex: horizontal ? "0 0 45%" : "1 1 0", minHeight: 0, background: "rgba(127,127,127,0.12)", borderRadius: s.borderRadius, overflow: "hidden" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {img && <img src={img} alt={product.name} draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
      </div>
      <div style={{ flex: "0 0 auto", padding: horizontal ? "8px 0" : 0 }}>
        <div style={{ fontWeight: 600, fontSize: 22, fontFamily: `${resolveToken(doc, "token:heading", "fonts")}, system-ui, sans-serif` }}>{product.name}</div>
        {s.showDescription && product.description && <div style={{ fontSize: 15, opacity: 0.7, marginTop: 4 }}>{product.description}</div>}
        {s.showPrice && price && <div style={{ fontSize: 18, fontWeight: 600, marginTop: 6, color: resolveToken(doc, "token:primary") }}>{price}</div>}
      </div>
    </div>
  );
}

/**
 * User HTML/CSS in a sandboxed iframe: no scripts, opaque origin, strict CSP.
 * Content is already sanitized by the schema; this is the hard boundary.
 */
function HtmlBlock({ html, css, background, interactive }: { html: string; css: string; background?: string; interactive: boolean }) {
  const { doc, resolveAsset } = useRender();
  const fonts = googleFontsUrl(usedFonts(doc), embeddedFamilies(doc));
  // Embedded fonts only reach the sandbox as data: URLs (blob: URLs are origin-bound).
  const faces = fontFaceCss(doc, (id) => { const u = resolveAsset(id); return u?.startsWith("data:") ? u : undefined; });
  const vars = Object.entries(doc.theme.colors).map(([k, v]) => `--kv-${k}:${v};`).join("");
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; media-src https: data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:">
<base target="_blank">${fonts ? `<link rel="stylesheet" href="${fonts}">` : ""}
<style>${faces}</style><style>:root{${vars}--kv-heading:'${resolveToken(doc, "token:heading", "fonts")}';--kv-body:'${resolveToken(doc, "token:body", "fonts")}'}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${background ?? "transparent"};color:var(--kv-text);font-family:var(--kv-body),system-ui,sans-serif}
*{box-sizing:border-box}</style><style>${css.replace(/<\/style/gi, "")}</style></head><body>${html}</body></html>`;
  return (
    <iframe
      title="Custom HTML"
      srcDoc={srcDoc}
      sandbox={interactive ? "allow-popups allow-popups-to-escape-sandbox" : ""}
      referrerPolicy="no-referrer"
      loading="eager"
      style={{ width: "100%", height: "100%", border: 0, display: "block", background: "transparent", pointerEvents: interactive ? "auto" : "none" }}
    />
  );
}

function Placeholder({ label, radius = 0, show, minHeight }: { label: string; radius?: number; show: boolean; minHeight?: number }) {
  if (!show) return null;
  return (
    <div style={{
      width: "100%", height: "100%", minHeight, display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(127,127,127,0.12)", border: "2px dashed rgba(127,127,127,0.4)", borderRadius: radius,
      color: "rgba(127,127,127,0.9)", fontSize: 18, boxSizing: "border-box",
    }}>
      {label}
    </div>
  );
}
