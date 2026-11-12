import { z } from "zod";
import { sanitizeCss, sanitizeHtml } from "./sanitize";
import { svgPathToAnchors } from "./path";

export const CURRENT_SCHEMA_VERSION = 1;

const id = z.string().min(1);
const color = z.string().min(1); // hex, rgb() or a theme token like "token:primary"
/** Links viewers can follow: never javascript:, data: or other schemes. */
const linkUrl = z.url().refine((u) => /^(https?|mailto|tel):/i.test(u), {
  message: "Links must use https, http, mailto or tel",
});
/** Media the renderer (and headless Chrome on the server) loads itself: https only. */
const mediaUrl = z
  .url()
  .refine((u) => /^https:/i.test(u), { message: "Media URLs must use https" });
/** Page size bounds keep exports (Chrome viewports, PDF pages) reasonable. */
const pageSize = z.number().min(100).max(10_000);

const forbiddenJsonKeys = new Set(["__proto__", "prototype", "constructor"]);
const safeJsonKey = z
  .string()
  .min(1)
  .max(128)
  .refine((key) => !forbiddenJsonKeys.has(key), "Reserved object key.");
const MAX_EXTENSION_MAP_CHARACTERS = 250_000;

/** Limits untrusted extension JSON so deeply nested or oversized values cannot exhaust the parser or editor. */
function isJsonMap(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  let nodes = 0;
  let characters = 0;
  try {
    while (stack.length) {
      const entry = stack.pop()!;
      const current = entry.value;
      nodes += 1;
      if (nodes > 20_000 || entry.depth > 32) return false;
      if (current === null || typeof current === "boolean") continue;
      if (typeof current === "number") {
        if (!Number.isFinite(current)) return false;
        continue;
      }
      if (typeof current === "string") {
        characters += current.length;
        if (
          current.length > 100_000 ||
          characters > MAX_EXTENSION_MAP_CHARACTERS
        )
          return false;
        continue;
      }
      if (typeof current !== "object") return false;
      if (seen.has(current)) return false;
      seen.add(current);
      if (Array.isArray(current)) {
        if (current.length > 10_000) return false;
        for (const item of current)
          stack.push({ value: item, depth: entry.depth + 1 });
        continue;
      }
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) return false;
      const keys = Reflect.ownKeys(current);
      if (
        keys.length > 5_000 ||
        keys.some(
          (key) => typeof key !== "string" || forbiddenJsonKeys.has(key),
        )
      )
        return false;
      for (const key of keys as string[]) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor || !("value" in descriptor)) return false;
        characters += key.length;
        if (characters > MAX_EXTENSION_MAP_CHARACTERS) return false;
        stack.push({ value: descriptor.value, depth: entry.depth + 1 });
      }
    }
    return true;
  } catch {
    return false;
  }
}

const jsonMap = z
  .record(safeJsonKey, z.unknown())
  .refine(
    isJsonMap,
    `Extension data must be plain JSON and stay within ${MAX_EXTENSION_MAP_CHARACTERS.toLocaleString()} characters and 32 levels of nesting.`,
  );

const extensionIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;
export const extensionIdSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(extensionIdPattern, "Use a reverse-domain extension id.");
export const extensionDataKeySchema = z
  .string()
  .min(1)
  .max(128)
  .refine(
    (key) =>
      key
        .split(/[.:/]/)
        .every((part) => part.length > 0 && !forbiddenJsonKeys.has(part)),
    "Extension keys cannot use reserved object names or empty path segments.",
  );

export const easingSchema = z.enum([
  "linear",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "spring",
]);
export const directionSchema = z.enum(["left", "right", "up", "down"]);

export const springSchema = z.object({
  stiffness: z.number().positive(),
  damping: z.number().nonnegative(),
  mass: z.number().positive().default(1),
});

// ---- Animation (declarative data only, never code) ----

export const slideTransitionSchema = z.object({
  type: z.enum([
    "none",
    "fade",
    "slide",
    "push",
    "zoom",
    "wipe",
    "flip",
    "morph",
  ]),
  durationMs: z.number().int().min(0).max(10_000).default(500),
  delayMs: z.number().int().min(0).default(0),
  easing: easingSchema.default("ease-in-out"),
  direction: directionSchema.optional(),
  spring: springSchema.optional(),
});

/** Animatable properties of a keyframe; values are offsets from the element's resting state. */
export const KEYFRAME_PROPERTIES = ["x", "y", "scale", "rotation", "opacity", "drawProgress"] as const;
export type KeyframeProperty = (typeof KEYFRAME_PROPERTIES)[number];

/**
 * One keyframe of a "keyframes" animation. Properties left out are interpolated
 * between the neighbouring keyframes that set them (like CSS @keyframes).
 * `easing` shapes the motion from this keyframe to the next one.
 */
export const keyframeSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  /** Position in the animation, 0 (start) to 1 (end). */
  offset: z.number().min(0).max(1),
  /** Horizontal offset in px. */
  x: z.number().min(-100_000).max(100_000).optional(),
  /** Vertical offset in px. */
  y: z.number().min(-100_000).max(100_000).optional(),
  scale: z.number().min(0).max(100).optional(),
  /** Degrees, added to the element's rotation. */
  rotation: z.number().min(-36_000).max(36_000).optional(),
  opacity: z.number().min(0).max(1).optional(),
  /** Paths only: visible fraction of the stroke, 0 to 1. */
  drawProgress: z.number().min(0).max(1).optional(),
  easing: easingSchema.default("linear"),
});

export const elementAnimationSchema = z.object({
  id,
  category: z.enum(["entrance", "exit", "emphasis", "motion-path", "keyframes"]),
  preset: z.enum([
    "appear",
    "fade",
    "slide",
    "scale",
    "bounce",
    "rotate",
    "spin",
    "flip",
    "zoom",
    "grow",
    "shrink",
    "rise",
    "blur",
    "float",
    "pulse",
    "custom",
    // Paths: reveal the stroke from start to end (entrance), remove it (exit), run a dash along it (emphasis).
    "draw",
    "erase",
    "trace",
  ]),
  trigger: z
    .enum(["on-enter", "after-previous", "with-previous", "on-click"])
    .default("on-enter"),
  startMs: z.number().int().min(0).default(0),
  durationMs: z.number().int().min(1).max(60_000).default(600),
  delayMs: z.number().int().min(0).default(0),
  /** Stable order across all animated objects on the slide. Missing values retain legacy stacking order. */
  order: z.number().int().nonnegative().optional(),
  /** Split text entrance/exit into one separately sequenced animation per paragraph. */
  byParagraph: z.boolean().optional(),
  easing: easingSchema.default("ease-out"),
  direction: directionSchema.optional(),
  // motion-path / custom: points relative to the element's origin
  path: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
  /** Keyframes animations: the keyframes, kept in offset order. */
  keyframes: z.array(keyframeSchema).max(50).optional(),
  /** Emphasis and keyframes: how many times to play (default 1). */
  iterations: z.number().int().min(1).max(100).optional(),
  /** Emphasis and keyframes: repeat until the slide ends. */
  loop: z.boolean().optional(),
  /** Emphasis and keyframes: "alternate" plays every second iteration backwards. */
  playDirection: z.enum(["normal", "alternate"]).optional(),
  /** Draw, erase and trace: run along the path from its end to its start. */
  reverse: z.boolean().optional(),
  /** Draw: fade the fill in after the stroke is complete (erase: fade it out first). */
  fillAfterDraw: z.boolean().optional(),
});

/** A serializable reference to a trusted extension effect; no shader source is stored in a catalog. */
export const elementEffectSchema = z
  .object({
    id,
    extensionId: extensionIdSchema,
    effectId: z
      .string()
      .min(1)
      .max(96)
      .regex(/^[a-z0-9][a-z0-9._-]*$/),
    type: z.enum(["shader-effect", "shader-fill"]),
    parameters: jsonMap.default({}),
  })
  .strict();

// ---- Elements (discriminated union on `type`) ----

export const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  rotation: z.number().default(0),
});

const elementBase = {
  id,
  name: z.string().optional(),
  position: positionSchema,
  zIndex: z.number().int().default(0),
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
  opacity: z.number().min(0).max(1).default(1),
  groupId: id.optional(),
  /** Identity shared by copies of an element (duplicated slides, copy/paste) so Morph can match them. */
  morphKey: z.string().max(100).optional(),
  /** Slot created by a slide layout. Reapplying a layout replaces only these elements. */
  layoutSlot: z.enum([
    "title", "subtitle", "body", "left-column", "right-column", "caption",
    "section-title", "section-description", "number", "media",
  ]).optional(),
  animations: z.array(elementAnimationSchema).default([]),
  effects: z.array(elementEffectSchema).max(8).default([]),
};

export const textStyleSchema = z.object({
  fontFamily: z.string().default("token:body"),
  fontSize: z.number().positive().default(24),
  fontWeight: z.number().int().min(100).max(900).default(400),
  lineHeight: z.number().positive().default(1.3),
  letterSpacing: z.number().default(0),
  /** "start"/"end" follow the text direction (right in RTL catalogs). */
  align: z
    .enum(["start", "end", "left", "center", "right", "justify"])
    .default("start"),
  /** "auto" picks the direction per paragraph from its first strong character; force "ltr" for e.g. phone numbers in RTL text. */
  direction: z.enum(["auto", "ltr", "rtl"]).default("auto"),
  color: color.default("token:text"),
  decoration: z.enum(["none", "underline", "line-through"]).default("none"),
  italic: z.boolean().default(false),
});

/**
 * Older AI integrations sometimes persisted text as `{ body: string }`.
 * Unwrap that known shape while validating so legacy catalogs can still open.
 */
const catalogText = z.preprocess((value) => {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "body" in value
  ) {
    const body = (value as { body?: unknown }).body;
    if (typeof body === "string") return body;
  }
  return value;
}, z.string());

/** Rich text as runs; no HTML stored in the document. */
export const textRunSchema = z.object({
  text: catalogText,
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  color: color.optional(),
  href: linkUrl.optional(),
});

export const textElementSchema = z.object({
  ...elementBase,
  type: z.literal("text"),
  content: z.object({ paragraphs: z.array(z.array(textRunSchema)) }),
  style: textStyleSchema.default(textStyleSchema.parse({})),
});

export const imageElementSchema = z.object({
  ...elementBase,
  type: z.literal("image"),
  content: z.object({ assetId: id, alt: z.string().default("") }),
  style: z
    .object({
      fit: z.enum(["cover", "contain", "fill"]).default("cover"),
      crop: z
        .object({
          x: z.number(),
          y: z.number(),
          width: z.number(),
          height: z.number(),
        })
        .optional(),
      borderRadius: z.number().min(0).default(0),
      filters: z
        .object({
          brightness: z.number().default(1),
          contrast: z.number().default(1),
          saturate: z.number().default(1),
          grayscale: z.number().min(0).max(1).default(0),
        })
        .optional(),
    })
    .default({ fit: "cover", borderRadius: 0 }),
});

export const shapeElementSchema = z.object({
  ...elementBase,
  type: z.literal("shape"),
  content: z.object({
    shape: z.enum(["rect", "ellipse", "triangle", "line", "arrow"]),
  }),
  style: z
    .object({
      fill: color.default("token:primary"),
      stroke: color.optional(),
      strokeWidth: z.number().min(0).default(0),
      borderRadius: z.number().min(0).default(0),
    })
    .default({ fill: "token:primary", strokeWidth: 0, borderRadius: 0 }),
});

export const productRefSchema = z.object({
  productId: id,
  source: z.string().optional(), // e.g. MCP connection id, "manual"
});

export const productCardStyleSchema = z.object({
  layout: z.enum(["vertical", "horizontal", "overlay"]).default("vertical"),
  showPrice: z.boolean().default(true),
  showDescription: z.boolean().default(true),
  background: color.optional(),
  borderRadius: z.number().min(0).default(8),
  /** How product photos fit their box: "contain" shows the whole photo, "cover" fills and crops. */
  imageFit: z.enum(["contain", "cover"]).default("contain"),
  /** Show product attributes (specs) as a small list. */
  showAttributes: z.boolean().default(false),
  // Optional so cards saved before these existed keep their look; see CARD_DISPLAY_DEFAULTS.
  showImage: z.boolean().optional(),
  showName: z.boolean().optional(),
  showBrand: z.boolean().optional(),
  showSubtitle: z.boolean().optional(),
  /** Original price struck through next to the price, when the product has one. */
  showCompareAtPrice: z.boolean().optional(),
  showBadge: z.boolean().optional(),
  showAvailability: z.boolean().optional(),
  showRating: z.boolean().optional(),
  showSku: z.boolean().optional(),
  /** "View product" link when the product has a url. */
  showLink: z.boolean().optional(),
  /** How many attributes (specs) to list. */
  maxAttributes: z.number().int().min(1).max(20).optional(),
});

/** What a product card shows when an optional display flag is unset. */
export const CARD_DISPLAY_DEFAULTS = {
  showImage: true,
  showName: true,
  showBrand: true,
  showSubtitle: true,
  showCompareAtPrice: true,
  showBadge: true,
  showAvailability: true,
  showRating: true,
  showSku: false,
  showLink: false,
  maxAttributes: 8,
} as const;

export type ProductCardStyle = z.infer<typeof productCardStyleSchema>;
export const productGridStyleSchema = productCardStyleSchema.extend({
  gap: z.number().min(0).default(16),
});

/** Card display options with defaults applied. */
export function cardDisplay(style: Partial<ProductCardStyle>) {
  const d = CARD_DISPLAY_DEFAULTS;
  return {
    showImage: style.showImage ?? d.showImage,
    showName: style.showName ?? d.showName,
    showBrand: style.showBrand ?? d.showBrand,
    showSubtitle: style.showSubtitle ?? d.showSubtitle,
    showPrice: style.showPrice ?? true,
    showCompareAtPrice: style.showCompareAtPrice ?? d.showCompareAtPrice,
    showDescription: style.showDescription ?? true,
    showAttributes: style.showAttributes ?? false,
    maxAttributes: style.maxAttributes ?? d.maxAttributes,
    showBadge: style.showBadge ?? d.showBadge,
    showAvailability: style.showAvailability ?? d.showAvailability,
    showRating: style.showRating ?? d.showRating,
    showSku: style.showSku ?? d.showSku,
    showLink: style.showLink ?? d.showLink,
  };
}

export const productElementSchema = z.object({
  ...elementBase,
  type: z.literal("product"),
  content: productRefSchema,
  style: productCardStyleSchema.default(productCardStyleSchema.parse({})),
});

export const productGridElementSchema = z.object({
  ...elementBase,
  type: z.literal("product-grid"),
  content: z.object({
    products: z.array(productRefSchema),
    columns: z.number().int().min(1).max(8).default(3),
  }),
  style: productGridStyleSchema.default({
    ...productCardStyleSchema.parse({}),
    gap: 16,
  }),
});

/** SVG primitives an icon may use. Icons are stored as data, never as raw SVG markup. */
export const ICON_SVG_TAGS = ["path", "circle", "rect", "line", "polyline", "polygon", "ellipse"] as const;
export const ICON_SVG_ATTRIBUTES = ["d", "cx", "cy", "r", "rx", "ry", "x", "y", "width", "height", "x1", "y1", "x2", "y2", "points", "fill"] as const;
const ICON_ATTRIBUTE_SET = new Set<string>(ICON_SVG_ATTRIBUTES);
/** Geometry only: digits, path commands, separators. `fill` is limited to currentColor or none. */
const ICON_VALUE = /^[0-9A-Za-z .,+-]*$/;
export const iconNodeSchema = z
  .tuple([
    z.enum(ICON_SVG_TAGS),
    z.record(z.string(), z.union([z.string().max(8_000), z.number().finite()])),
  ])
  .refine(
    ([, attributes]) =>
      Object.entries(attributes).every(([key, value]) =>
        ICON_ATTRIBUTE_SET.has(key) &&
        (key === "fill" ? value === "currentColor" || value === "none" : typeof value === "number" || ICON_VALUE.test(value)),
      ),
    "Icon shapes may only use geometry attributes.",
  );
export type IconNode = z.infer<typeof iconNodeSchema>;

/**
 * A vector icon on a 24×24 grid (Lucide-compatible). `nodes` holds the shapes so the icon renders
 * offline, on published pages and in exports without the icon library; icons without `nodes`
 * render as a named placeholder.
 */
export const iconElementSchema = z.object({
  ...elementBase,
  type: z.literal("icon"),
  content: z.object({
    name: catalogText,
    library: z.enum(["lucide"]).optional(),
    nodes: z.array(iconNodeSchema).max(64).optional(),
  }),
  style: z
    .object({ color: color.default("token:text"), strokeWidth: z.number().min(0.25).max(6).optional() })
    .default({ color: "token:text" }),
});

/** A versioned extension-owned element. Its plugin payload is JSON data only. */
export const extensionElementSchema = z.object({
  ...elementBase,
  type: z.literal("extension"),
  extensionId: extensionIdSchema,
  kind: z
    .string()
    .min(1)
    .max(96)
    .regex(/^[a-z0-9][a-z0-9._-]*$/),
  elementVersion: z.number().int().min(1).default(1),
  content: jsonMap.default({}),
  style: jsonMap.default({}),
});

export const videoElementSchema = z.object({
  ...elementBase,
  type: z.literal("video"),
  content: z.object({
    assetId: id.optional(),
    url: mediaUrl.optional(),
    posterAssetId: id.optional(),
  }),
  style: z
    .object({
      autoplay: z.boolean().default(false),
      loop: z.boolean().default(false),
      muted: z.boolean().default(true),
    })
    .default({ autoplay: false, loop: false, muted: true }),
});

export const buttonElementSchema = z.object({
  ...elementBase,
  type: z.literal("button"),
  content: z.object({ label: catalogText, href: linkUrl }),
  style: z
    .object({
      background: color.default("token:primary"),
      color: color.default("token:on-primary"),
      borderRadius: z.number().default(6),
    })
    .default({
      background: "token:primary",
      color: "token:on-primary",
      borderRadius: 6,
    }),
});

/**
 * Custom HTML + CSS block. Stored sanitized (see sanitize.ts) and always rendered
 * inside a sandboxed iframe with scripts disabled, so it can style but never run code.
 */
export const htmlElementSchema = z.object({
  ...elementBase,
  type: z.literal("html"),
  content: z.object({
    html: z
      .string()
      .max(100_000)
      .transform((v) => sanitizeHtml(v)),
    css: z
      .string()
      .max(50_000)
      .default("")
      .transform((v) => sanitizeCss(v)),
  }),
  style: z.object({ background: color.optional() }).default({}),
});

// ---- Markdown and table elements (content blocks) ----

/** Longest markdown source a markdown element stores. */
export const MAX_MARKDOWN_CHARACTERS = 20_000;
/** Table limits keep the editor, renderer and PowerPoint export responsive. */
export const TABLE_LIMITS = { columns: 50, rows: 500, cellCharacters: 1_000, labelCharacters: 200, totalCharacters: 200_000 } as const;

const blockAlign = z.enum(["start", "center", "end", "justify"]);
const blockDirection = z.enum(["auto", "ltr", "rtl"]);

/**
 * GitHub-flavored markdown, rendered without raw HTML (HTML in the source is shown as text or dropped).
 * Sizes are document pixels, like text elements.
 */
export const markdownStyleSchema = z.object({
  fontFamily: z.string().max(200).default("token:body"),
  headingFontFamily: z.string().max(200).default("token:heading"),
  baseFontSize: z.number().min(4).max(400).default(20),
  color: color.default("token:text"),
  headingColor: color.default("token:text"),
  linkColor: color.default("token:primary"),
  lineHeight: z.number().min(0.8).max(4).default(1.45),
  align: blockAlign.default("start"),
  direction: blockDirection.default("auto"),
  background: color.optional(),
});

export const markdownElementSchema = z.object({
  ...elementBase,
  type: z.literal("markdown"),
  content: z.object({ markdown: z.string().max(MAX_MARKDOWN_CHARACTERS) }),
  style: markdownStyleSchema.default(markdownStyleSchema.parse({})),
});

export const TABLE_COLUMN_FORMATS = ["text", "number", "currency", "percent", "date"] as const;

export const tableColumnSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().max(TABLE_LIMITS.labelCharacters).default(""),
  align: z.enum(["start", "center", "end"]).default("start"),
  /** Relative width; columns without one share the remaining space equally. */
  width: z.number().min(0.1).max(100).optional(),
  format: z.enum(TABLE_COLUMN_FORMATS).default("text"),
});

/**
 * Tabular data: columns describe the header and formatting, rows hold cell text in column order.
 * Shorter rows are padded with empty cells; rows longer than the column list are rejected.
 */
export const tableContentSchema = z
  .object({
    columns: z.array(tableColumnSchema).min(1).max(TABLE_LIMITS.columns),
    rows: z.array(z.array(z.string().max(TABLE_LIMITS.cellCharacters)).max(TABLE_LIMITS.columns)).max(TABLE_LIMITS.rows),
    /** Show column labels as a header row. */
    header: z.boolean().default(true),
  })
  .superRefine((table, ctx) => {
    const ids = new Set<string>();
    table.columns.forEach((column, index) => {
      if (ids.has(column.id)) ctx.addIssue({ code: "custom", path: ["columns", index, "id"], message: `Duplicate column id "${column.id}".` });
      ids.add(column.id);
    });
    let characters = 0;
    for (const [index, row] of table.rows.entries()) {
      if (row.length > table.columns.length) {
        ctx.addIssue({ code: "custom", path: ["rows", index], message: `Row ${index + 1} has ${row.length} cells but the table has ${table.columns.length} columns.` });
        return;
      }
      for (const cell of row) characters += cell.length;
    }
    if (characters > TABLE_LIMITS.totalCharacters) ctx.addIssue({ code: "custom", path: ["rows"], message: `A table can hold at most ${TABLE_LIMITS.totalCharacters.toLocaleString()} characters.` });
  })
  .transform((table) => ({
    ...table,
    rows: table.rows.map((row) => (row.length === table.columns.length ? row : [...row, ...Array<string>(table.columns.length - row.length).fill("")])),
  }));

export const tableStyleSchema = z.object({
  fontFamily: z.string().max(200).default("token:body"),
  fontSize: z.number().min(4).max(200).default(18),
  color: color.default("token:text"),
  headerBackground: color.default("token:primary"),
  headerColor: color.default("token:on-primary"),
  /** Alternate row shading. Without a zebraColor, rows are tinted with the theme's muted color. */
  zebra: z.boolean().default(true),
  zebraColor: color.optional(),
  /** Body cell background; transparent when unset. */
  background: color.optional(),
  borderColor: color.default("token:muted"),
  borderWidth: z.number().min(0).max(8).default(1),
  /** Cell padding in document pixels, scaled by density. */
  cellPadding: z.number().min(0).max(64).default(10),
  density: z.enum(["compact", "normal", "comfortable"]).default("normal"),
  direction: blockDirection.default("auto"),
});

export const tableElementSchema = z.object({
  ...elementBase,
  type: z.literal("table"),
  content: tableContentSchema,
  style: tableStyleSchema.default(tableStyleSchema.parse({})),
});

const pathCoordinate = z.number().min(-1_000).max(1_000);
const pathVec = z.object({ x: pathCoordinate, y: pathCoordinate });

/** One anchor of a vector path, normalized to the element box (0..1); handles are offsets from the anchor. */
export const pathPointSchema = z.object({
  x: pathCoordinate,
  y: pathCoordinate,
  in: pathVec.optional(),
  out: pathVec.optional(),
  kind: z.enum(["corner", "smooth"]).optional(),
});

/**
 * Path geometry. Agents may send SVG path data instead of anchors:
 * `{ "d": "M0 0 C…", "viewBox": { "width": 100, "height": 100 } }` is converted
 * to anchors (first subpath only) when the element is validated.
 */
export const pathContentSchema = z.preprocess(
  (value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
    const raw = value as Record<string, unknown>;
    if (typeof raw.d !== "string" || Array.isArray(raw.points)) return value;
    const { d, viewBox, ...rest } = raw;
    try {
      const box = typeof viewBox === "object" && viewBox !== null ? viewBox as { x?: number; y?: number; width: number; height: number } : undefined;
      const parsed = svgPathToAnchors((d as string).slice(0, 50_000), box && Number(box.width) > 0 && Number(box.height) > 0 ? box : undefined);
      return { ...rest, points: parsed.points, closed: typeof rest.closed === "boolean" ? rest.closed : parsed.closed };
    } catch {
      return value; // reported as a missing `points` issue below
    }
  },
  z.object({
    points: z.array(pathPointSchema).min(2, { message: "A path needs at least two points" }).max(2_000),
    closed: z.boolean().default(false),
  }),
);

export const pathStyleSchema = z.object({
  stroke: color.default("token:text"),
  strokeWidth: z.number().min(0).max(500).default(4),
  lineCap: z.enum(["butt", "round", "square"]).default("round"),
  lineJoin: z.enum(["miter", "round", "bevel"]).default("round"),
  /** Dash pattern in px (e.g. [12, 8]); empty for a solid line. */
  dash: z.array(z.number().min(0).max(1_000)).max(8).default([]),
  /** Optional fill; leave unset (or "none") for an open stroke. */
  fill: color.optional(),
});

/** A freeform vector path drawn with the pen tool, scaled to its element box. */
export const pathElementSchema = z.object({
  ...elementBase,
  type: z.literal("path"),
  content: pathContentSchema,
  style: pathStyleSchema.default(pathStyleSchema.parse({})),
});

export const catalogElementSchema = z.discriminatedUnion("type", [
  markdownElementSchema,
  tableElementSchema,
  htmlElementSchema,
  textElementSchema,
  imageElementSchema,
  shapeElementSchema,
  productElementSchema,
  productGridElementSchema,
  extensionElementSchema,
  iconElementSchema,
  videoElementSchema,
  buttonElementSchema,
  pathElementSchema,
]);

// ---- Slides, assets, products, document ----

export const slideBackgroundSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("color"), color }),
  z.object({
    kind: z.literal("image"),
    assetId: id,
    fit: z.enum(["cover", "contain"]).default("cover"),
  }),
  z.object({
    kind: z.literal("gradient"),
    from: color,
    to: color,
    angle: z.number().default(180),
  }),
]);

export const catalogSlideSchema = z.object({
  id,
  name: z.string(),
  layoutId: z.enum([
    "title-slide", "section-header", "title-body", "title-two-columns", "title-only",
    "one-column-text", "main-point", "section-title-description", "caption", "big-number", "blank",
  ]).optional(),
  background: slideBackgroundSchema.default({
    kind: "color",
    color: "token:background",
  }),
  elements: z.array(catalogElementSchema).default([]),
  transition: slideTransitionSchema.optional(),
  durationMs: z.number().int().positive().optional(),
});

/** Assets are references only; binaries live in IndexedDB / object storage. */
export const catalogAssetSchema = z
  .object({
    id,
    kind: z.enum(["image", "video", "font"]),
    mimeType: z.string(),
    name: z.string(),
    uri: z.string(), // "local://<hash>" or "https://..." or "s3://..."
    width: z.number().int().optional(),
    height: z.number().int().optional(),
    bytes: z.number().int().nonnegative().optional(),
    hash: z.string().optional(),
    /** Source and license details for media imported from external libraries. */
    attribution: z.object({
      provider: z.string().max(80),
      /** Provider item id used to resolve media again without persisting a transient CDN URL. */
      providerAssetId: z.string().max(200).optional(),
      creator: z.string().max(300).optional(),
      creatorUrl: linkUrl.optional(),
      license: z.string().max(100).optional(),
      licenseUrl: linkUrl.optional(),
      sourceUrl: linkUrl.optional(),
    }).optional(),
    /** Font assets: the CSS family name text elements refer to, plus the face this file provides. */
    family: z.string().optional(),
    fontWeight: z.number().int().min(1).max(1000).optional(),
    fontStyle: z.enum(["normal", "italic"]).optional(),
    /** Where the font came from; "local" fonts are copied from the user's computer. */
    fontSource: z.enum(["local", "upload", "google"]).optional(),
  })
  .refine((a) => a.kind !== "font" || !!a.family, {
    message: "Font assets need a family name",
    path: ["family"],
  });

export const PRODUCT_AVAILABILITY = [
  "in-stock",
  "out-of-stock",
  "pre-order",
  "limited",
] as const;
export const AVAILABILITY_LABELS: Record<
  (typeof PRODUCT_AVAILABILITY)[number],
  string
> = {
  "in-stock": "In stock",
  "out-of-stock": "Out of stock",
  "pre-order": "Pre-order",
  limited: "Limited stock",
};

/** Everything except id and name is optional, so catalogs saved before a field existed stay valid. */
export const productSchema = z.object({
  id,
  name: catalogText,
  /** Short tagline under the name. */
  subtitle: catalogText.pipe(z.string().max(200)).optional(),
  description: catalogText.optional(),
  sku: catalogText.optional(),
  brand: catalogText.pipe(z.string().max(100)).optional(),
  price: z.number().optional(),
  /** Original price, shown struck through to signal a discount. */
  compareAtPrice: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  /** Shown after the price, e.g. "per m²" or "/ kg". */
  unit: catalogText.pipe(z.string().max(30)).optional(),
  /** Short label over the photo, e.g. "New", "Sale". */
  badge: catalogText.pipe(z.string().max(30)).optional(),
  availability: z.enum(PRODUCT_AVAILABILITY).optional(),
  rating: z.number().min(0).max(5).optional(),
  /** First image is the primary one. */
  imageAssetIds: z.array(id).default([]),
  url: linkUrl.optional(),
  category: catalogText.optional(),
  /** Search keywords; not shown on cards. */
  tags: z.array(z.string().max(50)).max(30).optional(),
  /** Specs as label → value, in display order. */
  attributes: z.record(z.string(), catalogText).default({}),
  source: z.string().optional(),
});

/** Plugin-owned catalog data is persisted in versioned, namespaced JSON. */
export const catalogExtensionSchema = z.object({
  version: z
    .string()
    .max(80)
    .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  enabled: z.boolean().default(false),
  grantedCapabilities: z
    .array(z.string().min(1).max(64))
    .max(32)
    .refine((values) => new Set(values).size === values.length)
    .default([]),
  settings: jsonMap.default({}),
  data: jsonMap.default({}),
});

const MAX_TOTAL_EXTENSION_CHARACTERS = 8_000_000;

function jsonCharacterCount(value: unknown, stopAt: number): number {
  const pending: unknown[] = [value];
  let characters = 0;
  while (pending.length) {
    const current = pending.pop();
    if (typeof current === "string") characters += current.length;
    else if (Array.isArray(current)) pending.push(...current);
    else if (typeof current === "object" && current !== null) {
      for (const [key, child] of Object.entries(current)) {
        characters += key.length;
        pending.push(child);
      }
    }
    if (characters > stopAt) return stopAt + 1;
  }
  return characters;
}

export const catalogDocumentSchema = z
  .object({
    id,
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    revision: z.number().int().nonnegative().default(0),
    metadata: z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      author: z.string().optional(),
      language: z.string().default("en"),
      currency: z.string().length(3).default("USD"),
    }),
    settings: z.object({
      width: pageSize,
      height: pageSize,
      unit: z.enum(["px"]).default("px"),
      background: color.default("token:background"),
    }),
    theme: z.object({
      colors: z.record(z.string(), z.string()),
      fonts: z.record(z.string(), z.string()),
    }),
    slides: z
      .array(catalogSlideSchema)
      .min(1, { message: "A catalog needs at least one slide" }),
    assets: z.array(catalogAssetSchema).default([]),
    products: z.array(productSchema).default([]),
    extensions: z
      .record(extensionIdSchema, catalogExtensionSchema)
      .refine(
        (value) => Object.keys(value).length <= 32,
        "A catalog can have at most 32 extensions.",
      )
      .default({}),
  })
  .superRefine((document, ctx) => {
    let totalCharacters = 0;
    let extensionElements = 0;
    const add = (value: unknown, path: (string | number)[]) => {
      const remaining = MAX_TOTAL_EXTENSION_CHARACTERS - totalCharacters;
      totalCharacters += jsonCharacterCount(value, remaining);
      if (totalCharacters > MAX_TOTAL_EXTENSION_CHARACTERS) {
        ctx.addIssue({
          code: "custom",
          path,
          message: `Extension data in a catalog cannot exceed ${MAX_TOTAL_EXTENSION_CHARACTERS.toLocaleString()} characters in total.`,
        });
        return false;
      }
      return true;
    };
    for (const [extensionId, state] of Object.entries(document.extensions)) {
      if (
        !add(state.settings, ["extensions", extensionId, "settings"]) ||
        !add(state.data, ["extensions", extensionId, "data"])
      )
        return;
    }
    for (const [slideIndex, slide] of document.slides.entries()) {
      for (const [elementIndex, element] of slide.elements.entries()) {
        if (
          element.effects.length &&
          !add(element.effects, [
            "slides",
            slideIndex,
            "elements",
            elementIndex,
            "effects",
          ])
        )
          return;
        if (element.type !== "extension") continue;
        extensionElements += 1;
        if (extensionElements > 2_000) {
          ctx.addIssue({
            code: "custom",
            path: ["slides", slideIndex, "elements", elementIndex],
            message:
              "A catalog cannot contain more than 2,000 extension elements.",
          });
          return;
        }
        if (
          !add(element.content, [
            "slides",
            slideIndex,
            "elements",
            elementIndex,
            "content",
          ]) ||
          !add(element.style, [
            "slides",
            slideIndex,
            "elements",
            elementIndex,
            "style",
          ])
        )
          return;
      }
    }
  });

export type SlideTransition = z.infer<typeof slideTransitionSchema>;
export type ElementAnimation = z.infer<typeof elementAnimationSchema>;
export type ElementEffect = z.infer<typeof elementEffectSchema>;
export type CatalogElement = z.infer<typeof catalogElementSchema>;
export type CatalogElementType = CatalogElement["type"];
export type CatalogSlide = z.infer<typeof catalogSlideSchema>;
export type CatalogAsset = z.infer<typeof catalogAssetSchema>;
export type Product = z.infer<typeof productSchema>;
export type ExtensionElement = z.infer<typeof extensionElementSchema>;
export type CatalogExtensionState = z.infer<typeof catalogExtensionSchema>;
export type CatalogDocument = z.infer<typeof catalogDocumentSchema>;
export type ElementPosition = z.infer<typeof positionSchema>;
export type MarkdownElement = z.infer<typeof markdownElementSchema>;
export type MarkdownStyle = z.infer<typeof markdownStyleSchema>;
export type TableElement = z.infer<typeof tableElementSchema>;
export type TableContent = z.infer<typeof tableContentSchema>;
export type TableColumn = z.infer<typeof tableColumnSchema>;
export type TableStyle = z.infer<typeof tableStyleSchema>;
export type TableColumnFormat = (typeof TABLE_COLUMN_FORMATS)[number];
export type Keyframe = z.infer<typeof keyframeSchema>;
export type PathPoint = z.infer<typeof pathPointSchema>;
export type PathElement = z.infer<typeof pathElementSchema>;
