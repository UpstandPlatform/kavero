import { resolveToken, type CatalogDocument } from "@Kavero/catalog-engine";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Small SVG preview of the first slide for the dashboard. Images show as
 * placeholders; the real renderer package will replace this later.
 */
export function slideThumbnail(doc: CatalogDocument): string {
  const slide = doc.slides[0];
  const { width: W, height: H } = doc.settings;
  const c = (v: string) => esc(resolveToken(doc, v));
  const parts: string[] = [];
  if (slide) {
    const bg = slide.background;
    parts.push(`<rect width="${W}" height="${H}" fill="${bg.kind === "color" ? c(bg.color) : bg.kind === "gradient" ? c(bg.from) : "#e5e7eb"}"/>`);
    for (const el of [...slide.elements].sort((a, b) => a.zIndex - b.zIndex)) {
      if (el.hidden) continue;
      const { x, y, width: w, height: h, rotation } = el.position;
      const t = rotation ? ` transform="rotate(${rotation} ${x + w / 2} ${y + h / 2})"` : "";
      switch (el.type) {
        case "shape":
          parts.push(el.content.shape === "ellipse"
            ? `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${c(el.style.fill)}"${t}/>`
            : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${el.style.borderRadius}" fill="${c(el.style.fill)}"${t}/>`);
          break;
        case "text": {
          const line = el.content.paragraphs[0]?.map((r) => r.text).join("") ?? "";
          const anchor = el.style.align === "center" ? "middle" : el.style.align === "right" ? "end" : "start";
          const tx = anchor === "middle" ? x + w / 2 : anchor === "end" ? x + w : x;
          parts.push(`<text x="${tx}" y="${y + el.style.fontSize}" font-size="${el.style.fontSize}" font-weight="${el.style.fontWeight}" font-family="${esc(resolveToken(doc, el.style.fontFamily, "fonts"))}, sans-serif" text-anchor="${anchor}" fill="${c(el.style.color)}"${t}>${esc(line.slice(0, 60))}</text>`);
          break;
        }
        case "image":
        case "video":
          parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#d1d5db"${t}/>`);
          break;
        case "product-grid": {
          const cols = el.content.columns;
          const gap = el.style.gap;
          const cw = (w - gap * (cols - 1)) / cols;
          for (let i = 0; i < cols; i++) parts.push(`<rect x="${x + i * (cw + gap)}" y="${y}" width="${cw}" height="${Math.min(h, cw * 1.3)}" rx="${el.style.borderRadius}" fill="#9ca3af" fill-opacity="0.25"/>`);
          break;
        }
        default:
          parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#9ca3af" fill-opacity="0.25"${t}/>`);
      }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
