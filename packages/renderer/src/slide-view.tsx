import {
  AVAILABILITY_LABELS,
  cardDisplay,
  discountPercent,
  documentDirection,
  formatMoney,
  resolveToken,
  type ProductCardStyle,
  type CatalogDocument,
  type CatalogElement,
  type ExtensionElement,
  type CatalogSlide,
  type ElementEffect,
  type ElementPosition,
  type Product,
} from "@Kavero/catalog-engine";
import { elementStateAt, matchMorph, morphElement, scheduleSlide, stateToCss, type ScheduledAnimation } from "@Kavero/animation-engine";
import { Component, createContext, memo, useContext, useMemo, type CSSProperties, type ErrorInfo, type ReactNode } from "react";

import { fontFaceCss, googleFontsUrls } from "./fonts";

/** Turns an asset id into a displayable URL (blob:, https:, data:). */
export type AssetResolver = (assetId: string) => string | undefined;

interface RenderContext {
  doc: CatalogDocument;
  resolveAsset: AssetResolver;
  /** "edit" shows placeholders for empty content; "present" hides them. */
  mode: "edit" | "present";
  extensionRenderers?: ExtensionRendererRegistry;
  extensionEffects?: ExtensionEffectRegistry;
}

export interface ExtensionRendererContext {
  doc: CatalogDocument;
  resolveAsset: AssetResolver;
  mode: "edit" | "present";
}

export type ExtensionElementRenderer = (props: { element: ExtensionElement; context: ExtensionRendererContext }) => ReactNode;
export type ExtensionRendererRegistry = Readonly<Record<string, ExtensionElementRenderer>>;
export type ExtensionElementEffectRenderer = (props: { element: CatalogElement; effect: ElementEffect; context: ExtensionRendererContext; children: ReactNode }) => ReactNode;
export type ExtensionEffectRegistry = Readonly<Record<string, ExtensionElementEffectRenderer>>;

class ExtensionRenderBoundary extends Component<{ extensionId: string; kind: string; mode: "edit" | "present"; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    console.error(`[extension-renderer:${this.props.extensionId}/${this.props.kind}]`, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.mode === "present") return null;
    return <div className="grid size-full place-items-center border border-dashed bg-muted/40 p-2 text-center text-xs text-muted-foreground">{this.props.extensionId} · {this.props.kind} could not be rendered</div>;
  }
}

/** Keeps one malformed catalog element from taking down an entire slide. */
class ElementRenderBoundary extends Component<{
  element: CatalogElement;
  mode: "edit" | "present";
  children: ReactNode;
}, { failed: boolean; lastElement: CatalogElement }> {
  state = { failed: false, lastElement: this.props.element };

  static getDerivedStateFromProps(props: { element: CatalogElement }, state: { failed: boolean; lastElement: CatalogElement }) {
    return props.element === state.lastElement ? null : { failed: false, lastElement: props.element };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error(`[slide-element:${this.props.element.id}/${this.props.element.type}]`, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.mode === "present") return null;
    return (
      <div className="grid size-full place-items-center border border-dashed border-destructive/40 bg-muted/40 p-2 text-center text-xs text-muted-foreground" title={`Element ${this.props.element.id} could not be rendered`}>
        Element could not be rendered
      </div>
    );
  }
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
  /** Elements shown at rest without their animations, e.g. ones that just arrived by Morph. */
  settledIds?: Set<string>;
  /** Temporarily emphasize an element while it is referenced elsewhere in the editor UI. */
  highlightedElementId?: string;
  /** Namespaced renderers contributed by installed extensions. */
  extensionRenderers?: ExtensionRendererRegistry;
  /** Trusted extension effect renderers keyed by `${extensionId}/${effectId}`. */
  extensionEffects?: ExtensionEffectRegistry;
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
  settledIds,
  highlightedElementId,
  extensionRenderers,
  extensionEffects,
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
    <Ctx.Provider value={{ doc, resolveAsset, mode, extensionRenderers, extensionEffects }}>
      <div className={className} style={{ width: W * scale, height: H * scale, overflow: "hidden", position: "relative" }}>
        <div
          data-slide-id={slide.id}
          dir={documentDirection(doc)}
          lang={doc.metadata.language}
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
      <ElementFrame key={el.id} element={el} position={{ ...el.position, ...overrides?.[el.id] }} schedule={settledIds?.has(el.id) ? null : schedule} timeMs={timeMs} highlighted={highlightedElementId === el.id} />
            ),
          )}
          {children}
        </div>
      </div>
    </Ctx.Provider>
  );
});

/** A time after every element animation has finished. */
const SETTLED_MS = 1e9;

export interface MorphViewProps {
  doc: CatalogDocument;
  from: CatalogSlide;
  to: CatalogSlide;
  /** Eased transition progress, 0 → 1. */
  progress: number;
  scale?: number;
  resolveAsset?: AssetResolver;
  /** Local time of the incoming slide, so its other elements can start their animations. */
  timeMs?: number;
  extensionRenderers?: ExtensionRendererRegistry;
  extensionEffects?: ExtensionEffectRegistry;
}

/**
 * Morph transition: both slides cross-fade without the elements they share, and
 * the shared elements are drawn once on top, moving from their old geometry and
 * style to the new one (PowerPoint's Morph, Keynote's Magic Move).
 */
export function MorphView({ doc, from, to, progress, scale = 1, resolveAsset = () => undefined, timeMs, extensionRenderers, extensionEffects }: MorphViewProps) {
  const pairs = useMemo(() => matchMorph(from, to), [from, to]);
  const hideFrom = useMemo(() => new Set(pairs.map(([a]) => a.id)), [pairs]);
  const hideTo = useMemo(() => new Set(pairs.map(([, b]) => b.id)), [pairs]);
  const { width: W, height: H } = doc.settings;
  const resolve = (v: string) => resolveToken(doc, v);
  const layer: CSSProperties = { position: "absolute", inset: 0 };
  return (
    <div style={{ position: "relative", width: W * scale, height: H * scale, overflow: "hidden" }}>
      <div style={layer}><SlideView doc={doc} slide={from} scale={scale} timeMs={SETTLED_MS} hiddenIds={hideFrom} resolveAsset={resolveAsset} extensionRenderers={extensionRenderers} extensionEffects={extensionEffects} /></div>
      <div style={{ ...layer, opacity: progress }}><SlideView doc={doc} slide={to} scale={scale} timeMs={timeMs} hiddenIds={hideTo} resolveAsset={resolveAsset} extensionRenderers={extensionRenderers} extensionEffects={extensionEffects} /></div>
      <Ctx.Provider value={{ doc, resolveAsset, mode: "present", extensionRenderers, extensionEffects }}>
        <div
          dir={documentDirection(doc)}
          lang={doc.metadata.language}
          style={{
            width: W, height: H, position: "absolute", left: 0, top: 0, transform: `scale(${scale})`, transformOrigin: "0 0",
            fontFamily: `${resolveToken(doc, "token:body", "fonts")}, system-ui, sans-serif`, color: resolve("token:text"),
          }}
        >
          {pairs.map(([a, b]) => {
            const f = morphElement(a, b, progress, resolve);
            if (!f.from) return <ElementFrame key={b.id} element={f.to} position={f.to.position} schedule={null} />;
            return (
              <div key={b.id} style={layer}>
                <div style={{ ...layer, opacity: 1 - f.mix }}><ElementFrame element={f.from} position={f.from.position} schedule={null} /></div>
                <div style={{ ...layer, opacity: f.mix }}><ElementFrame element={f.to} position={f.to.position} schedule={null} /></div>
              </div>
            );
          })}
        </div>
      </Ctx.Provider>
    </div>
  );
}

function ElementFrame({ element, position: p, schedule, timeMs, highlighted = false }: {
  element: CatalogElement;
  position: ElementPosition;
  schedule: ScheduledAnimation[] | null;
  timeMs?: number;
  highlighted?: boolean;
}) {
  // Animation transforms sit on an inner layer so they compose with the element's own rotation.
  const anim = schedule && timeMs !== undefined && element.animations.length ? stateToCss(elementStateAt(schedule, element.id, timeMs)) : null;
  const { doc, resolveAsset, mode, extensionEffects } = useRender();
  const effectContext = { doc, resolveAsset, mode } as const;
  const activeEffects = element.effects.filter((effect) => {
    const installed = doc.extensions[effect.extensionId];
    return installed?.enabled && installed.grantedCapabilities.includes("editor.render") && extensionEffects?.[`${effect.extensionId}/${effect.effectId}`];
  });
  const body = activeEffects.reduceRight<ReactNode>((children, effect) => {
    const Renderer = extensionEffects?.[`${effect.extensionId}/${effect.effectId}`];
    if (!Renderer) return children;
    return (
      <ExtensionRenderBoundary key={`${effect.id}:${effect.effectId}`} extensionId={effect.extensionId} kind={effect.effectId} mode={mode}>
        <Renderer element={element} effect={effect} context={effectContext}>{children}</Renderer>
      </ExtensionRenderBoundary>
    );
  }, <ElementBody element={element} />);
  return (
    <div
      data-element-id={element.id}
      data-annotation-highlight={highlighted ? "true" : undefined}
      style={{
        position: "absolute", left: p.x, top: p.y, width: p.width, height: p.height,
        transform: p.rotation ? `rotate(${p.rotation}deg)` : undefined,
        opacity: element.opacity, boxSizing: "border-box",
        ...(highlighted ? {
          outline: "2px solid var(--primary)", outlineOffset: 2,
          boxShadow: "0 0 0 4px color-mix(in srgb, var(--primary) 20%, transparent)",
          zIndex: 1, transition: "outline-color 120ms ease, box-shadow 120ms ease",
        } : {}),
      }}
    >
      {anim ? (
        <div style={{ width: "100%", height: "100%", opacity: anim.opacity, transform: anim.transform, filter: anim.filter, transformOrigin: "50% 50%" }}>
          <ElementRenderBoundary element={element} mode={mode}>{body}</ElementRenderBoundary>
        </div>
      ) : <ElementRenderBoundary element={element} mode={mode}>{body}</ElementRenderBoundary>}
    </div>
  );
}

export function ElementBody({ element: el }: { element: CatalogElement }) {
  const { doc, resolveAsset, mode, extensionRenderers } = useRender();
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
          dir={s.direction === "auto" ? undefined : s.direction}
        >
          {el.content.paragraphs.map((runs, i) => (
            // dir="auto": each paragraph takes its direction from its own first strong letter,
            // so mixed Persian/Latin lines lay out correctly without control characters.
            <p key={i} dir={s.direction === "auto" ? "auto" : s.direction} style={{ margin: 0, minHeight: "1em" }}>
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
      return <ProductCard product={product} style={el.style} doc={doc} resolveAsset={resolveAsset} mode={mode} />;
    }
    case "product-grid": {
      const { columns, products } = el.content;
      const items: (Product | undefined)[] = products.length
        ? products.map((r) => doc.products.find((p) => p.id === r.productId))
        : mode === "edit" ? Array.from({ length: columns }, () => undefined) : [];
      return (
        // Rows share the element's height so cards (and their images) fill it.
        <div style={{ ...fill, display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${Math.max(1, Math.ceil(items.length / columns))}, minmax(0, 1fr))`, gap: el.style.gap }}>
          {items.map((p, i) => <ProductCard key={i} product={p} style={el.style} doc={doc} resolveAsset={resolveAsset} mode={mode} />)}
        </div>
      );
    }
    case "extension": {
      const Renderer = extensionRenderers?.[el.extensionId];
      if (Renderer) return (
        <ExtensionRenderBoundary extensionId={el.extensionId} kind={el.kind} mode={mode}>
          <Renderer element={el} context={{ doc, resolveAsset, mode }} />
        </ExtensionRenderBoundary>
      );
      return <Placeholder label={`${el.extensionId} · ${el.kind} extension unavailable`} show={mode === "edit"} />;
    }
    case "button":
      return (
        <a
          href={mode === "present" ? el.content.href : undefined}
          target="_blank"
          rel="noopener noreferrer"
          // Label scales with the button (like the PowerPoint export), so buttons read at any page size.
          style={{ ...fill, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 0.8em", boxSizing: "border-box", overflow: "hidden", whiteSpace: "nowrap", fontSize: Math.max(12, Math.round(Math.min(el.position.height * 0.36, 28))), background: color(el.style.background), color: color(el.style.color), borderRadius: el.style.borderRadius, textDecoration: "none", fontWeight: 600 }}
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

const clamp = (lines: number): CSSProperties => ({ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: lines, overflow: "hidden", overflowWrap: "anywhere" });

const AVAILABILITY_DOT: Record<string, string> = { "in-stock": "#16a34a", "out-of-stock": "#dc2626", "pre-order": "#2563eb", limited: "#d97706" };

function Stars({ rating }: { rating: number }) {
  const r = Math.max(0, Math.min(5, rating));
  return (
    <span role="img" aria-label={`Rated ${r} out of 5`} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13 }}>
      {/* Filled stars are clipped over empty ones so half ratings show. */}
      <span aria-hidden style={{ position: "relative", letterSpacing: 1, lineHeight: 1 }}>
        <span style={{ opacity: 0.25 }}>★★★★★</span>
        <span style={{ position: "absolute", insetInlineStart: 0, top: 0, width: `${(r / 5) * 100}%`, overflow: "hidden", whiteSpace: "nowrap" }}>★★★★★</span>
      </span>
      <span style={{ opacity: 0.7, fontVariantNumeric: "tabular-nums" }}>{r.toFixed(1).replace(/\.0$/, "")}</span>
    </span>
  );
}

export function ProductCard({ product, style: s, doc, resolveAsset, mode }: {
  product: Product | undefined;
  style: Partial<ProductCardStyle> & { layout: string; borderRadius: number };
  doc: CatalogDocument;
  resolveAsset: AssetResolver;
  mode: "edit" | "present";
}) {
  if (!product) return <Placeholder label="Product" radius={s.borderRadius} show={mode === "edit"} minHeight={120} />;
  const d = cardDisplay(s);
  const lang = doc.metadata.language;
  const currency = product.currency ?? doc.metadata.currency;
  const img = d.showImage && product.imageAssetIds[0] ? resolveAsset(product.imageAssetIds[0]) : undefined;
  const price = d.showPrice ? formatMoney(product.price, currency, lang) : null;
  const discount = discountPercent(product);
  const compareAt = d.showPrice && d.showCompareAtPrice && discount !== null ? formatMoney(product.compareAtPrice, currency, lang) : null;
  const badge = d.showBadge && product.badge?.trim() ? product.badge.trim() : null;
  const attributes = d.showAttributes ? Object.entries(product.attributes ?? {}).filter(([k, v]) => k && v).slice(0, d.maxAttributes) : [];
  const availability = d.showAvailability ? product.availability : undefined;
  const sku = d.showSku ? product.sku : undefined;
  const link = d.showLink ? product.url : undefined;
  const rating = d.showRating ? product.rating : undefined;
  const horizontal = s.layout === "horizontal";
  const primary = resolveToken(doc, "token:primary");
  const badgeEl = badge && (
    <span dir="auto" style={{
      display: "inline-block", maxWidth: "calc(100% - 20px)", padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, lineHeight: 1.4,
      background: primary, color: resolveToken(doc, "token:on-primary"), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    }}>{badge}</span>
  );
  return (
    <div style={{
      width: "100%", height: "100%", display: "flex", flexDirection: horizontal ? "row" : "column", overflow: "hidden",
      borderRadius: s.borderRadius, background: s.background ? resolveToken(doc, s.background) : "transparent", gap: 12,
    }}>
      {d.showImage && (
        <div style={{ position: "relative", flex: horizontal ? "0 0 45%" : "1 1 0", minHeight: 0, background: "rgba(127,127,127,0.12)", borderRadius: s.borderRadius, overflow: "hidden" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {img && <img src={img} alt={product.name} draggable={false} style={{ width: "100%", height: "100%", objectFit: s.imageFit ?? "contain", display: "block" }} />}
          {badgeEl && <div style={{ position: "absolute", top: 10, insetInlineStart: 10, insetInlineEnd: 0 }}>{badgeEl}</div>}
        </div>
      )}
      <div style={{ flex: d.showImage ? "0 0 auto" : "1 1 auto", minWidth: 0, minHeight: 0, overflow: "hidden", padding: horizontal ? "8px 0" : 0, textAlign: "start" }}>
        {!d.showImage && badgeEl && <div style={{ marginBottom: 6 }}>{badgeEl}</div>}
        {d.showBrand && product.brand && <div dir="auto" style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.6, marginBottom: 2, ...clamp(1) }}>{product.brand}</div>}
        {d.showName && <div dir="auto" style={{ fontWeight: 600, fontSize: 22, fontFamily: `${resolveToken(doc, "token:heading", "fonts")}, system-ui, sans-serif`, ...clamp(3) }}>{product.name}</div>}
        {d.showSubtitle && product.subtitle && <div dir="auto" style={{ fontSize: 15, opacity: 0.8, marginTop: 2, ...clamp(2) }}>{product.subtitle}</div>}
        {rating !== undefined && <div style={{ marginTop: 4 }}><Stars rating={rating} /></div>}
        {d.showDescription && product.description && <div dir="auto" style={{ fontSize: 15, opacity: 0.7, marginTop: 4, ...clamp(4) }}>{product.description}</div>}
        {attributes.length > 0 && (
          <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none", fontSize: 13, opacity: 0.8, lineHeight: 1.45 }}>
            {attributes.map(([k, v]) => (
              <li key={k} dir="auto" style={clamp(1)}><span style={{ opacity: 0.7 }}>{k}:</span> {v}</li>
            ))}
          </ul>
        )}
        {(price || compareAt) && (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: 8, rowGap: 2, marginTop: 6 }}>
            {price && <span style={{ fontSize: 18, fontWeight: 600, color: primary }}>{price}{product.unit && <span dir="auto" style={{ fontSize: 13, fontWeight: 400, opacity: 0.75, marginInlineStart: 4 }}>{product.unit}</span>}</span>}
            {compareAt && <span style={{ fontSize: 14, opacity: 0.6, textDecoration: "line-through" }}>{compareAt}</span>}
            {compareAt && <span style={{ fontSize: 12, fontWeight: 600, color: primary }}>−{discount}%</span>}
          </div>
        )}
        {(availability || sku || link) && (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 10, rowGap: 4, marginTop: 6, fontSize: 12 }}>
            {availability && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 999, border: "1px solid rgba(127,127,127,0.35)", whiteSpace: "nowrap" }}>
                <span aria-hidden style={{ width: 7, height: 7, borderRadius: 999, background: AVAILABILITY_DOT[availability] }} />
                {AVAILABILITY_LABELS[availability]}
              </span>
            )}
            {sku && <span dir="auto" style={{ opacity: 0.6, ...clamp(1) }}>SKU {sku}</span>}
            {link && (mode === "present"
              ? <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: primary, fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 2 }}>View product</a>
              : <span style={{ color: primary, fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 2 }}>View product</span>)}
          </div>
        )}
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
  const fonts = googleFontsUrls(doc);
  // Embedded fonts only reach the sandbox as data: URLs (blob: URLs are origin-bound).
  const faces = fontFaceCss(doc, (id) => { const u = resolveAsset(id); return u?.startsWith("data:") ? u : undefined; });
  const vars = Object.entries(doc.theme.colors).map(([k, v]) => `--kv-${k}:${v};`).join("");
  const srcDoc = `<!doctype html><html dir="${documentDirection(doc)}" lang="${doc.metadata.language.replace(/[^\w-]/g, "")}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; media-src https: data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:">
<base target="_blank">${fonts.map((href) => `<link rel="stylesheet" href="${href}">`).join("")}
<style>${faces}</style><style>:root{${vars}--kv-heading:'${resolveToken(doc, "token:heading", "fonts")}';--kv-body:'${resolveToken(doc, "token:body", "fonts")}'}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${background ?? "transparent"};color:var(--kv-text);font-family:var(--kv-body),system-ui,sans-serif}
*{box-sizing:border-box}</style><style>${css.replace(/<\/style/gi, "")}</style></head><body>${html}</body></html>`;
  return (
    <iframe
      aria-label="Custom HTML"
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
