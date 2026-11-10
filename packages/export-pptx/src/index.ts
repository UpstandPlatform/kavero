import {
  AVAILABILITY_LABELS, cardDisplay, discountPercent, documentDirection, formatMoney, resolveToken,
  productCardStyleSchema, productGridStyleSchema, PRODUCTS_EXTENSION_ID,
  type CatalogDocument, type CatalogElement, type ExtensionElement, type Product, type ProductCardStyle,
} from "@Kavero/catalog-engine";
import PptxGenJS from "pptxgenjs";

/**
 * Editable PowerPoint export. Every element becomes a native object (text box,
 * shape, picture) rather than a screenshot, so it can be edited in PowerPoint.
 *
 * Capability mapping:
 *   text          → editable text box (runs keep bold/italic/underline/color/links)
 *   shape         → native shape (rect, rounded rect, ellipse, triangle, line, arrow)
 *   image         → picture (cover/contain/fill, rounding)
 *   product/grid  → picture + text boxes per card
 *   button        → rounded shape with a hyperlink
 *   html          → its text as an editable text box (styling is web-only)
 *   video         → poster image or placeholder
 *   transitions / animations → not supported by PptxGenJS; reported as warnings
 */

export type PptxExtensionElementRenderer = (context: {
  slide: PptxGenJS.Slide;
  doc: CatalogDocument;
  element: ExtensionElement;
  assets: Record<string, string>;
}) => void;

export type PptxExtensionRendererRegistry = Readonly<Record<string, PptxExtensionElementRenderer>>;

export interface PptxOptions {
  /** assetId → data: URL for images. Missing images become placeholders. */
  assets: Record<string, string>;
  outputType?: "blob" | "nodebuffer" | "uint8array" | "arraybuffer";
  /** Extension exporters receive each extension element and may add native PowerPoint objects. */
  extensionRenderers?: PptxExtensionRendererRegistry;
}

export interface PptxResult<T> {
  data: T;
  warnings: string[];
}

const PX_PER_IN = 96;
const inch = (px: number) => px / PX_PER_IN;
const pt = (px: number) => Math.max(1, Math.round(px * 0.75 * 10) / 10);

/** PowerPoint wants 6-digit hex without '#'. */
export function toHex(color: string | undefined, fallback = "000000"): string {
  if (!color) return fallback;
  const c = color.trim();
  let m = /^#?([0-9a-f]{6})$/i.exec(c);
  if (m) return m[1]!.toUpperCase();
  m = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
  if (m) return `${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toUpperCase();
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(c);
  if (m) return [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("").toUpperCase();
  return fallback;
}

/** First strong character decides direction (like CSS dir="auto"). */
export function textIsRtl(text: string, fallback: boolean): boolean {
  const m = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]|[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.exec(text);
  return m ? /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(m[0]) : fallback;
}

function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function exportPptx<T = Blob>(doc: CatalogDocument, opts: PptxOptions): Promise<PptxResult<T>> {
  const warnings = new Set<string>();
  const pptx = new PptxGenJS();
  const { width: W, height: H } = doc.settings;
  pptx.defineLayout({ name: "KAVERO", width: inch(W), height: inch(H) });
  pptx.layout = "KAVERO";
  pptx.title = doc.metadata.title;
  if (doc.metadata.author) pptx.author = doc.metadata.author;
  pptx.company = "Kavero";

  const docRtl = documentDirection(doc) === "rtl";
  const color = (v: string | undefined, fallback?: string) => toHex(v ? resolveToken(doc, v) : undefined, fallback);
  const font = (v: string) => resolveToken(doc, v, "fonts");
  const asset = (id: string | undefined) => (id ? opts.assets[id] : undefined);

  if (doc.assets.some((a) => a.kind === "font")) {
    warnings.add("Fonts saved in the catalog can't be embedded in PowerPoint. Install them on the computer that opens the file.");
  }

  function box(el: CatalogElement) {
    const p = el.position;
    return { x: inch(p.x), y: inch(p.y), w: inch(Math.max(1, p.width)), h: inch(Math.max(1, p.height)), rotate: p.rotation || undefined };
  }
  const transparency = (el: CatalogElement) => (el.opacity < 1 ? Math.round((1 - el.opacity) * 100) : undefined);

  function addElement(s: PptxGenJS.Slide, el: CatalogElement) {
    switch (el.type) {
      case "text": {
        const st = el.style;
        const runs: PptxGenJS.TextProps[] = [];
        el.content.paragraphs.forEach((para, i) => {
          const last = i === el.content.paragraphs.length - 1;
          const items = para.length ? para : [{ text: "" }];
          items.forEach((r, j) => {
            runs.push({
              text: r.text,
              options: {
                bold: r.bold ?? st.fontWeight >= 600,
                italic: r.italic ?? st.italic,
                underline: r.underline || st.decoration === "underline" ? { style: "sng" } : undefined,
                strike: st.decoration === "line-through" ? "sngStrike" : undefined,
                color: r.color ? color(r.color) : undefined,
                hyperlink: r.href ? { url: r.href } : undefined,
                breakLine: j === items.length - 1 && !last,
              },
            });
          });
        });
        s.addText(runs, {
          ...box(el),
          fontFace: font(st.fontFamily),
          fontSize: pt(st.fontSize),
          color: color(st.color),
          ...(() => {
            const plain = el.content.paragraphs.map((p) => p.map((r) => r.text).join("")).join(" ");
            const rtl = st.direction === "rtl" || (st.direction === "auto" && textIsRtl(plain, docRtl));
            const align = st.align === "start" ? (rtl ? "right" : "left") : st.align === "end" ? (rtl ? "left" : "right") : st.align;
            return { align, rtlMode: rtl || undefined, lang: doc.metadata.language };
          })(),
          valign: "top",
          lineSpacingMultiple: st.lineHeight,
          charSpacing: st.letterSpacing ? st.letterSpacing * 0.75 : undefined,
          margin: 0,
          transparency: transparency(el),
          fit: "none",
        });
        return;
      }
      case "shape": {
        const st = el.style;
        const b = box(el);
        const line = st.stroke && st.strokeWidth > 0 ? { color: color(st.stroke), width: pt(st.strokeWidth) } : undefined;
        const fill = { color: color(st.fill), transparency: transparency(el) };
        switch (el.content.shape) {
          case "rect": {
            const r = st.borderRadius > 0 ? Math.min(1, st.borderRadius / (Math.min(el.position.width, el.position.height) / 2)) : 0;
            s.addShape(r ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, { ...b, fill, line, rectRadius: r || undefined });
            return;
          }
          case "ellipse": s.addShape(pptx.ShapeType.ellipse, { ...b, fill, line }); return;
          case "triangle": s.addShape(pptx.ShapeType.triangle, { ...b, fill, line }); return;
          case "line":
          case "arrow": {
            const y = b.y + b.h / 2;
            s.addShape(pptx.ShapeType.line, {
              x: b.x, y, w: b.w, h: 0, rotate: b.rotate,
              line: { color: color(st.stroke ?? st.fill), width: pt(Math.max(st.strokeWidth, 2)), endArrowType: el.content.shape === "arrow" ? "triangle" : undefined },
            });
            return;
          }
        }
        return;
      }
      case "image": {
        const data = asset(el.content.assetId);
        if (!data) return placeholder(s, el, "Missing image");
        const b = box(el);
        s.addImage({
          data, ...b, altText: el.content.alt || undefined, transparency: transparency(el),
          rounding: el.style.borderRadius >= Math.min(el.position.width, el.position.height) / 2 ? true : undefined,
          sizing: el.style.fit === "fill" ? undefined : { type: el.style.fit === "cover" ? "cover" : "contain", w: b.w, h: b.h },
        });
        if (el.style.borderRadius > 0 && el.style.borderRadius < Math.min(el.position.width, el.position.height) / 2) warnings.add("Rounded image corners are square in PowerPoint (fully round images are kept).");
        return;
      }
      case "product": {
        const product = doc.products.find((p) => p.id === el.content.productId);
        productCard(s, el.position, product, el.style);
        return;
      }
      case "product-grid": {
        const { columns, products } = el.content;
        const gap = el.style.gap;
        const p = el.position;
        const cw = (p.width - gap * (columns - 1)) / columns;
        const rows = Math.max(1, Math.ceil(products.length / columns));
        const ch = Math.min(cw * 1.4, (p.height - gap * (rows - 1)) / rows);
        if (p.rotation) warnings.add("Rotated product grids are exported unrotated.");
        products.forEach((ref, i) => {
          const product = doc.products.find((x) => x.id === ref.productId);
          const pos = { x: p.x + (i % columns) * (cw + gap), y: p.y + Math.floor(i / columns) * (ch + gap), width: cw, height: ch, rotation: 0 };
          productCard(s, pos, product, el.style);
        });
        return;
      }
      case "extension": {
        const exporter = opts.extensionRenderers?.[el.extensionId];
        if (exporter) {
          exporter({ slide: s, doc, element: el, assets: opts.assets });
          return;
        }
        if (el.extensionId === PRODUCTS_EXTENSION_ID && el.kind === "card") {
          if (el.elementVersion !== 1) {
            warnings.add(`Products element version ${el.elementVersion} has no PowerPoint converter.`);
            placeholder(s, el, "Unsupported product element");
            return;
          }
          const productId = el.content.productId;
          const style = productCardStyleSchema.safeParse(el.style);
          if (typeof productId === "string") productCard(s, el.position, doc.products.find((product) => product.id === productId), style.success ? style.data : productCardStyleSchema.parse({}));
          else placeholder(s, el, "Invalid product card");
          return;
        }
        if (el.extensionId === PRODUCTS_EXTENSION_ID && el.kind === "grid") {
          if (el.elementVersion !== 1) {
            warnings.add(`Products element version ${el.elementVersion} has no PowerPoint converter.`);
            placeholder(s, el, "Unsupported product grid");
            return;
          }
          const productIds = Array.isArray(el.content.products) ? el.content.products.flatMap((item) => {
            if (typeof item !== "object" || item === null || !("productId" in item) || typeof item.productId !== "string") return [];
            return [item.productId];
          }) : [];
          const columnsValue = el.content.columns;
          const columns = typeof columnsValue === "number" && Number.isInteger(columnsValue) ? Math.min(8, Math.max(1, columnsValue)) : 3;
          const style = productGridStyleSchema.safeParse(el.style);
          const gridStyle = style.success ? style.data : productGridStyleSchema.parse({});
          const gap = gridStyle.gap;
          const p = el.position;
          const cw = (p.width - gap * (columns - 1)) / columns;
          const rows = Math.max(1, Math.ceil(productIds.length / columns));
          const ch = Math.min(cw * 1.4, (p.height - gap * (rows - 1)) / rows);
          if (p.rotation) warnings.add("Rotated product grids are exported unrotated.");
          productIds.forEach((productId, i) => {
            const product = doc.products.find((item) => item.id === productId);
            const pos = { x: p.x + (i % columns) * (cw + gap), y: p.y + Math.floor(i / columns) * (ch + gap), width: cw, height: ch, rotation: 0 };
            productCard(s, pos, product, gridStyle);
          });
          return;
        }
        warnings.add(`Extension element "${el.extensionId}" has no PowerPoint exporter and was replaced with a placeholder.`);
        placeholder(s, el, `${el.extensionId} element`);
        return;
      }
      case "button": {
        s.addText(el.content.label, {
          ...box(el), shape: pptx.ShapeType.roundRect,
          rectRadius: Math.min(1, el.style.borderRadius / (Math.min(el.position.width, el.position.height) / 2)),
          fill: { color: color(el.style.background) }, color: color(el.style.color),
          align: "center", valign: "middle", bold: true, fontSize: pt(Math.min(28, el.position.height * 0.4)),
          hyperlink: { url: el.content.href }, margin: 0,
        });
        return;
      }
      case "html": {
        warnings.add("HTML blocks become plain editable text in PowerPoint; their CSS styling is web/PDF/video only.");
        const text = htmlToText(el.content.html);
        if (text) s.addText(text, { ...box(el), fontFace: font("token:body"), fontSize: 18, color: color("token:text"), valign: "top", margin: 0.1, fit: "shrink" });
        return;
      }
      case "video": {
        const poster = asset(el.content.posterAssetId);
        warnings.add("Videos are exported as their poster image.");
        if (poster) s.addImage({ data: poster, ...box(el), sizing: { type: "cover", w: box(el).w, h: box(el).h } });
        else placeholder(s, el, "Video");
        return;
      }
      case "icon":
        placeholder(s, el, el.content.name);
        return;
    }
  }

  function productCard(
    s: PptxGenJS.Slide,
    p: { x: number; y: number; width: number; height: number; rotation: number },
    product: Product | undefined,
    style: Partial<ProductCardStyle> & { layout: string; background?: string; borderRadius: number },
  ) {
    if (!product) {
      warnings.add("Some product cards had no product selected and were left out.");
      return;
    }
    const d = cardDisplay(style);
    const horizontal = style.layout === "horizontal";
    // Extra rows for the newer fields; cards without them keep their original proportions.
    const extra = [
      d.showBrand && product.brand, d.showSubtitle && product.subtitle, d.showRating && product.rating !== undefined,
      (d.showAvailability && product.availability) || (d.showSku && product.sku), d.showLink && product.url,
      d.showAttributes && Object.keys(product.attributes ?? {}).length > 0,
    ].filter(Boolean).length;
    const textH = extra ? Math.min(p.height * 0.5, 110 + extra * 18) : Math.min(p.height * 0.4, 110);
    const img = d.showImage
      ? { x: p.x, y: p.y, width: horizontal ? p.width * 0.45 : p.width, height: horizontal ? p.height : p.height - textH - 8 }
      : null;
    const txt = !img ? { x: p.x, y: p.y, width: p.width, height: p.height }
      : horizontal
        ? { x: p.x + p.width * 0.45 + 12, y: p.y, width: p.width * 0.55 - 12, height: p.height }
        : { x: p.x, y: p.y + img.height + 8, width: p.width, height: textH };
    if (style.background) s.addShape(pptx.ShapeType.rect, { x: inch(p.x), y: inch(p.y), w: inch(p.width), h: inch(p.height), fill: { color: color(style.background) } });
    const badge = d.showBadge && product.badge?.trim() ? product.badge.trim() : null;
    if (img) {
      const data = asset(product.imageAssetIds[0]);
      if (data) s.addImage({ data, x: inch(img.x), y: inch(img.y), w: inch(img.width), h: inch(img.height), sizing: { type: "cover", w: inch(img.width), h: inch(img.height) }, altText: product.name });
      else s.addShape(pptx.ShapeType.rect, { x: inch(img.x), y: inch(img.y), w: inch(img.width), h: inch(img.height), fill: { color: "EEEEEE" } });
      if (badge) {
        const bw = Math.min(img.width - 20, 24 + badge.length * 8), bh = 24;
        const bx = docRtl ? img.x + img.width - 10 - bw : img.x + 10;
        s.addText(badge, {
          x: inch(bx), y: inch(img.y + 10), w: inch(bw), h: inch(bh), shape: pptx.ShapeType.roundRect, rectRadius: 1,
          fill: { color: color("token:primary") }, color: color("token:on-primary"), bold: true, fontSize: 9, align: "center", valign: "middle", margin: 0, fontFace: font("token:body"),
        });
      }
    }

    const lang = doc.metadata.language;
    const currency = product.currency ?? doc.metadata.currency;
    const price = d.showPrice ? formatMoney(product.price, currency, lang) : null;
    const discount = discountPercent(product);
    const compareAt = d.showPrice && d.showCompareAtPrice && discount !== null ? formatMoney(product.compareAtPrice, currency, lang) : null;
    const muted = color("token:muted");
    const runs: PptxGenJS.TextProps[] = [];
    const line = (text: string, options: PptxGenJS.TextPropsOptions = {}) => runs.push({ text, options: { ...options, breakLine: true } });
    if (!img && badge) line(badge, { bold: true, fontSize: 9, color: color("token:primary") });
    if (d.showBrand && product.brand) line(product.brand.toUpperCase(), { bold: true, fontSize: 9, color: muted, charSpacing: 1 });
    if (d.showName) line(product.name, { bold: true, fontSize: 16, fontFace: font("token:heading") });
    if (d.showSubtitle && product.subtitle) line(product.subtitle, { fontSize: 11 });
    if (d.showRating && product.rating !== undefined) {
      const r = Math.round(Math.max(0, Math.min(5, product.rating)));
      line(`${"★".repeat(r)}${"☆".repeat(5 - r)} ${product.rating.toFixed(1).replace(/\.0$/, "")}`, { fontSize: 10 });
    }
    if (d.showDescription && product.description) line(product.description, { fontSize: 11, color: muted });
    if (d.showAttributes) {
      for (const [k, v] of Object.entries(product.attributes ?? {}).filter(([k, v]) => k && v).slice(0, d.maxAttributes)) line(`${k}: ${v}`, { fontSize: 9, color: muted });
    }
    if (price || compareAt) {
      if (price) runs.push({ text: price, options: { bold: true, fontSize: 13, color: color("token:primary") } });
      if (price && product.unit) runs.push({ text: ` ${product.unit}`, options: { fontSize: 10, color: muted } });
      if (compareAt) runs.push({ text: `  ${compareAt}`, options: { fontSize: 10, color: muted, strike: "sngStrike" } });
      if (compareAt) runs.push({ text: `  −${discount}%`, options: { fontSize: 10, bold: true, color: color("token:primary") } });
      runs[runs.length - 1]!.options!.breakLine = true;
    }
    const meta = [
      d.showAvailability && product.availability ? `● ${AVAILABILITY_LABELS[product.availability]}` : null,
      d.showSku && product.sku ? `SKU ${product.sku}` : null,
    ].filter(Boolean).join("   ");
    if (meta) line(meta, { fontSize: 9, color: muted });
    if (d.showLink && product.url) line("View product", { fontSize: 10, bold: true, underline: { style: "sng" }, color: color("token:primary"), hyperlink: { url: product.url } });
    if (!runs.length) return;
    // Trailing break would add an empty paragraph.
    delete runs[runs.length - 1]!.options!.breakLine;
    const rtl = textIsRtl(product.name, docRtl);
    s.addText(runs, {
      x: inch(txt.x), y: inch(txt.y), w: inch(txt.width), h: inch(txt.height), valign: "top", color: color("token:text"), fontFace: font("token:body"), margin: 0,
      align: rtl ? "right" : "left", rtlMode: rtl || undefined, lang,
      hyperlink: product.url && !(d.showLink) ? { url: product.url } : undefined, fit: "shrink",
    });
  }

  function placeholder(s: PptxGenJS.Slide, el: CatalogElement, label: string) {
    s.addText(label, { ...box(el), fill: { color: "EEEEEE" }, color: "888888", align: "center", valign: "middle", fontSize: 14 });
  }

  for (const slide of doc.slides) {
    const s = pptx.addSlide();
    const bg = slide.background;
    if (bg.kind === "color") s.background = { color: color(bg.color, "FFFFFF") };
    else if (bg.kind === "gradient") {
      s.background = { color: color(bg.from, "FFFFFF") };
      warnings.add("Gradient backgrounds use their first color in PowerPoint.");
    } else {
      const data = asset(bg.assetId);
      if (data) s.background = { data };
    }
    if (slide.transition && slide.transition.type !== "none") warnings.add("Slide transitions aren't exported to PowerPoint yet; add them in PowerPoint if needed.");

    const elements = [...slide.elements].sort((a, b) => a.zIndex - b.zIndex);
    for (const el of elements) {
      if (el.hidden) continue;
      if (el.animations.length) warnings.add("Element animations aren't exported to PowerPoint yet.");
      if (el.effects.length) warnings.add("Shader fills and effects aren't exported to PowerPoint yet.");
      addElement(s, el);
    }
  }

  const data = (await pptx.write({ outputType: opts.outputType ?? "blob", compression: true })) as T;
  return { data, warnings: [...warnings] };
}
