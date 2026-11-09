import { z } from "zod";
import { sanitizeCss, sanitizeHtml } from "./sanitize";

export const CURRENT_SCHEMA_VERSION = 1;

const id = z.string().min(1);
const color = z.string().min(1); // hex, rgb() or a theme token like "token:primary"

export const easingSchema = z.enum(["linear", "ease-in", "ease-out", "ease-in-out", "spring"]);
export const directionSchema = z.enum(["left", "right", "up", "down"]);

export const springSchema = z.object({
  stiffness: z.number().positive(),
  damping: z.number().nonnegative(),
  mass: z.number().positive().default(1),
});

// ---- Animation (declarative data only, never code) ----

export const slideTransitionSchema = z.object({
  type: z.enum(["none", "fade", "slide", "push", "zoom", "wipe", "flip", "morph"]),
  durationMs: z.number().int().min(0).max(10_000).default(500),
  delayMs: z.number().int().min(0).default(0),
  easing: easingSchema.default("ease-in-out"),
  direction: directionSchema.optional(),
  spring: springSchema.optional(),
});

export const elementAnimationSchema = z.object({
  id,
  category: z.enum(["entrance", "exit", "emphasis", "motion-path"]),
  preset: z.enum([
    "fade", "slide", "scale", "bounce", "rotate", "blur", "float", "pulse", "custom",
  ]),
  trigger: z.enum(["on-enter", "after-previous", "with-previous", "on-click"]).default("on-enter"),
  startMs: z.number().int().min(0).default(0),
  durationMs: z.number().int().min(1).max(60_000).default(600),
  delayMs: z.number().int().min(0).default(0),
  easing: easingSchema.default("ease-out"),
  direction: directionSchema.optional(),
  // motion-path / custom: points relative to the element's origin
  path: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
});

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
  animations: z.array(elementAnimationSchema).default([]),
};

export const textStyleSchema = z.object({
  fontFamily: z.string().default("token:body"),
  fontSize: z.number().positive().default(24),
  fontWeight: z.number().int().min(100).max(900).default(400),
  lineHeight: z.number().positive().default(1.3),
  letterSpacing: z.number().default(0),
  align: z.enum(["left", "center", "right", "justify"]).default("left"),
  color: color.default("token:text"),
  decoration: z.enum(["none", "underline", "line-through"]).default("none"),
  italic: z.boolean().default(false),
});

/** Rich text as runs; no HTML stored in the document. */
export const textRunSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  color: color.optional(),
  href: z.url().optional(),
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
  style: z.object({
    fit: z.enum(["cover", "contain", "fill"]).default("cover"),
    crop: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
    borderRadius: z.number().min(0).default(0),
    filters: z.object({
      brightness: z.number().default(1),
      contrast: z.number().default(1),
      saturate: z.number().default(1),
      grayscale: z.number().min(0).max(1).default(0),
    }).optional(),
  }).default({ fit: "cover", borderRadius: 0 }),
});

export const shapeElementSchema = z.object({
  ...elementBase,
  type: z.literal("shape"),
  content: z.object({ shape: z.enum(["rect", "ellipse", "triangle", "line", "arrow"]) }),
  style: z.object({
    fill: color.default("token:primary"),
    stroke: color.optional(),
    strokeWidth: z.number().min(0).default(0),
    borderRadius: z.number().min(0).default(0),
  }).default({ fill: "token:primary", strokeWidth: 0, borderRadius: 0 }),
});

export const productRefSchema = z.object({
  productId: id,
  source: z.string().optional(), // e.g. MCP connection id, "manual"
});

const cardStyle = z.object({
  layout: z.enum(["vertical", "horizontal", "overlay"]).default("vertical"),
  showPrice: z.boolean().default(true),
  showDescription: z.boolean().default(true),
  background: color.optional(),
  borderRadius: z.number().min(0).default(8),
});

export const productElementSchema = z.object({
  ...elementBase,
  type: z.literal("product"),
  content: productRefSchema,
  style: cardStyle.default(cardStyle.parse({})),
});

export const productGridElementSchema = z.object({
  ...elementBase,
  type: z.literal("product-grid"),
  content: z.object({ products: z.array(productRefSchema), columns: z.number().int().min(1).max(8).default(3) }),
  style: cardStyle.extend({ gap: z.number().min(0).default(16) }).default({ ...cardStyle.parse({}), gap: 16 }),
});

export const iconElementSchema = z.object({
  ...elementBase,
  type: z.literal("icon"),
  content: z.object({ name: z.string() }),
  style: z.object({ color: color.default("token:text") }).default({ color: "token:text" }),
});

export const videoElementSchema = z.object({
  ...elementBase,
  type: z.literal("video"),
  content: z.object({ assetId: id.optional(), url: z.url().optional(), posterAssetId: id.optional() }),
  style: z.object({ autoplay: z.boolean().default(false), loop: z.boolean().default(false), muted: z.boolean().default(true) })
    .default({ autoplay: false, loop: false, muted: true }),
});

export const buttonElementSchema = z.object({
  ...elementBase,
  type: z.literal("button"),
  content: z.object({ label: z.string(), href: z.url() }),
  style: z.object({ background: color.default("token:primary"), color: color.default("token:on-primary"), borderRadius: z.number().default(6) })
    .default({ background: "token:primary", color: "token:on-primary", borderRadius: 6 }),
});

/**
 * Custom HTML + CSS block. Stored sanitized (see sanitize.ts) and always rendered
 * inside a sandboxed iframe with scripts disabled, so it can style but never run code.
 */
export const htmlElementSchema = z.object({
  ...elementBase,
  type: z.literal("html"),
  content: z.object({
    html: z.string().max(100_000).transform((v) => sanitizeHtml(v)),
    css: z.string().max(50_000).default("").transform((v) => sanitizeCss(v)),
  }),
  style: z.object({ background: color.optional() }).default({}),
});

export const catalogElementSchema = z.discriminatedUnion("type", [
  htmlElementSchema,
  textElementSchema,
  imageElementSchema,
  shapeElementSchema,
  productElementSchema,
  productGridElementSchema,
  iconElementSchema,
  videoElementSchema,
  buttonElementSchema,
]);

// ---- Slides, assets, products, document ----

export const slideBackgroundSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("color"), color }),
  z.object({ kind: z.literal("image"), assetId: id, fit: z.enum(["cover", "contain"]).default("cover") }),
  z.object({ kind: z.literal("gradient"), from: color, to: color, angle: z.number().default(180) }),
]);

export const catalogSlideSchema = z.object({
  id,
  name: z.string(),
  background: slideBackgroundSchema.default({ kind: "color", color: "token:background" }),
  elements: z.array(catalogElementSchema).default([]),
  transition: slideTransitionSchema.optional(),
  durationMs: z.number().int().positive().optional(),
});

/** Assets are references only; binaries live in IndexedDB / object storage. */
export const catalogAssetSchema = z.object({
  id,
  kind: z.enum(["image", "video", "font"]),
  mimeType: z.string(),
  name: z.string(),
  uri: z.string(), // "local://<hash>" or "https://..." or "s3://..."
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  bytes: z.number().int().nonnegative().optional(),
  hash: z.string().optional(),
  /** Font assets: the CSS family name text elements refer to, plus the face this file provides. */
  family: z.string().optional(),
  fontWeight: z.number().int().min(1).max(1000).optional(),
  fontStyle: z.enum(["normal", "italic"]).optional(),
  /** Where the font came from; "local" fonts are copied from the user's computer. */
  fontSource: z.enum(["local", "upload", "google"]).optional(),
}).refine((a) => a.kind !== "font" || !!a.family, { message: "Font assets need a family name", path: ["family"] });

export const productSchema = z.object({
  id,
  name: z.string(),
  description: z.string().optional(),
  sku: z.string().optional(),
  price: z.number().optional(),
  currency: z.string().length(3).optional(),
  imageAssetIds: z.array(id).default([]),
  url: z.url().optional(),
  category: z.string().optional(),
  attributes: z.record(z.string(), z.string()).default({}),
  source: z.string().optional(),
});

export const catalogDocumentSchema = z.object({
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
    width: z.number().positive(),
    height: z.number().positive(),
    unit: z.enum(["px"]).default("px"),
    background: color.default("token:background"),
  }),
  theme: z.object({
    colors: z.record(z.string(), z.string()),
    fonts: z.record(z.string(), z.string()),
  }),
  slides: z.array(catalogSlideSchema),
  assets: z.array(catalogAssetSchema).default([]),
  products: z.array(productSchema).default([]),
});

export type SlideTransition = z.infer<typeof slideTransitionSchema>;
export type ElementAnimation = z.infer<typeof elementAnimationSchema>;
export type CatalogElement = z.infer<typeof catalogElementSchema>;
export type CatalogElementType = CatalogElement["type"];
export type CatalogSlide = z.infer<typeof catalogSlideSchema>;
export type CatalogAsset = z.infer<typeof catalogAssetSchema>;
export type Product = z.infer<typeof productSchema>;
export type CatalogDocument = z.infer<typeof catalogDocumentSchema>;
export type ElementPosition = z.infer<typeof positionSchema>;
