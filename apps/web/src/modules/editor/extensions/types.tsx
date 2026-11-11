import type { CatalogDocument, CatalogElement, CatalogElementType, CatalogSlide, ElementEffect } from "@Kavero/catalog-engine";
import type { Editor, EditorCommand } from "@Kavero/editor-core";
import type { ExtensionCapability, ExtensionDefinition, ExtensionEvents, ExtensionHost, ExtensionManifest, JsonValue } from "@Kavero/extensions";
import type { ExtensionElementEffectRenderer, ExtensionElementRenderer } from "@Kavero/renderer";
import type { PptxExtensionElementRenderer } from "@Kavero/export-pptx";
import type { ReactNode } from "react";

import type { PickOptions, ProductUi } from "../product-picker";
import type { RailTool } from "../tool-rail";

export interface ExtensionEditorApi {
  getDocument(): CatalogDocument;
  execute(command: EditorCommand): ReturnType<Editor["execute"]>;
}

export interface EditorMcpConnection {
  id: string;
  name: string;
  status: "unknown" | "ok" | "error";
  tools: { name: string; title?: string; description?: string }[];
}

export interface EditorExtensionIntegrationApi {
  listConnections(): Promise<EditorMcpConnection[]>;
  callTool(connectionId: string, tool: string, args: Record<string, JsonValue>): Promise<unknown>;
}

/** Raw host context stays inside the editor shell and is converted to a capability-scoped facade before contribution. */
export interface EditorExtensionHostContext {
  editor: Editor;
  activeSlideId: string;
  assetUrls: Record<string, string>;
  products: ProductUi;
  insertProduct(productId: string): void;
  insertGrid(productIds: string[]): void;
  importProducts(): void;
  integrations: EditorExtensionIntegrationApi;
}

export interface EditorExtensionContext {
  editor: ExtensionEditorApi;
  readonly doc: CatalogDocument;
  readonly activeSlideId: string;
  readonly assetUrls: Record<string, string>;
  products: ProductUi;
  integrations: EditorExtensionIntegrationApi;
  insertProduct(productId: string): void;
  insertGrid(productIds: string[]): void;
  importProducts(): void;
}

export interface EditorExtensionPanel {
  id: string;
  label: string;
  icon: ReactNode;
  content: ReactNode;
}

export interface EditorExtensionDesignPropertyTarget {
  /** Discriminates slide-wide settings from selected-element settings. */
  kind: "slide" | "elements";
  document: CatalogDocument;
  slide: CatalogSlide;
  elements: readonly CatalogElement[];
}

/** An extension-owned inspector section shown in the matching Design selection context. */
export interface EditorExtensionDesignPropertySection {
  id: string;
  title: string;
  /** Defaults to elements. Slide sections are shown only when no element is selected. */
  target?: "slide" | "elements";
  /** Restrict the section to these element types; omitted means any catalog element. */
  elementTypes?: readonly CatalogElementType[];
  /** Defaults to false so a section only receives a single unambiguous target. */
  supportsMultiple?: boolean;
  render: (target: EditorExtensionDesignPropertyTarget) => ReactNode;
}

export interface EditorExtensionContribution {
  toolGroups?: RailTool[][];
  panels?: EditorExtensionPanel[];
  designProperties?: EditorExtensionDesignPropertySection[];
  canvasWidgets?: EditorExtensionCanvasWidget[];
  elementMenuActions?: EditorExtensionElementMenuAction[];
  renderers?: Record<string, ExtensionElementRenderer>;
  effects?: EditorExtensionEffect[];
  pptxRenderers?: Record<string, PptxExtensionElementRenderer>;
}

/** Compact extension UI anchored over the editor canvas, outside the scrollable slide surface. */
export interface EditorExtensionCanvasWidget {
  id: string;
  content: ReactNode;
}

export interface EditorExtensionElementMenuTarget {
  id: string;
  type: CatalogElementType;
}

/** An action contributed to the right-click menu for compatible selected elements. */
export interface EditorExtensionElementMenuAction {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Restrict the action to these catalog element types; omitted means any type. */
  elementTypes?: readonly CatalogElementType[];
  /** Capabilities this action uses, in addition to the editor.ui capability needed to add menu UI. */
  requiredCapabilities: readonly ExtensionCapability[];
  /** Defaults to true. */
  supportsMultiple?: boolean;
  /** Defaults to false. */
  allowLocked?: boolean;
  /** Optional dynamic target filter. Request catalog.read when it reads document data. */
  isAvailable?: (targets: readonly EditorExtensionElementMenuTarget[]) => boolean;
  onSelect: (targets: readonly EditorExtensionElementMenuTarget[]) => void | Promise<void>;
}

export interface EditorExtensionEffect {
  id: string;
  name: string;
  description: string;
  type: ElementEffect["type"];
  /** Restrict application to these catalog element types; omitted means any type. */
  elementTypes?: readonly CatalogElementType[];
  defaultParameters?: Record<string, JsonValue>;
  render: ExtensionElementEffectRenderer;
}

export type EditorExportFormat = "pdf" | "images" | "pptx" | "html" | "video";

export interface EditorExtensionHooks extends Record<string, unknown> {
  "catalog.export.prepare": { document: CatalogDocument; format: EditorExportFormat };
}

export type EditorExtension = ExtensionDefinition<EditorExtensionContext, EditorExtensionContribution, ExtensionEvents, EditorExtensionHooks>;
export type EditorExtensionHost = ExtensionHost<EditorExtensionContext, EditorExtensionContribution, ExtensionEvents, EditorExtensionHooks>;

const EDITOR_ELEMENT_TYPES = new Set(["text", "image", "shape", "product", "product-grid", "icon", "extension", "video", "button", "html"]);

export function validateEditorExtensionContribution(manifest: ExtensionManifest, contribution: EditorExtensionContribution) {
  if (!contribution || typeof contribution !== "object") throw new Error("Extension contribution must be an object.");
  const panels = contribution.panels ?? [];
  const designProperties = contribution.designProperties ?? [];
  const groups = contribution.toolGroups ?? [];
  const canvasWidgets = contribution.canvasWidgets ?? [];
  const elementMenuActions = contribution.elementMenuActions ?? [];
  const renderers = contribution.renderers ?? {};
  const effects = contribution.effects ?? [];
  const pptxRenderers = contribution.pptxRenderers ?? {};
  if ((panels.length || designProperties.length || groups.length || canvasWidgets.length || elementMenuActions.length) && !manifest.capabilities.includes("editor.ui")) {
    throw new Error(`Extension "${manifest.id}" contributes editor UI without requesting editor.ui.`);
  }
  if (designProperties.length && !manifest.capabilities.includes("catalog.read")) {
    throw new Error(`Extension "${manifest.id}" contributes design properties without requesting catalog.read.`);
  }
  if ((Object.keys(renderers).length || effects.length || Object.keys(pptxRenderers).length) && !manifest.capabilities.includes("editor.render")) {
    throw new Error(`Extension "${manifest.id}" contributes renderers without requesting editor.render.`);
  }
  if (panels.length > 32 || designProperties.length > 32 || groups.length > 24 || canvasWidgets.length > 16 || elementMenuActions.length > 32) throw new Error(`Extension "${manifest.id}" exceeds editor contribution limits.`);
  const panelIds = new Set<string>();
  for (const panel of panels) {
    if (!panel || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(panel.id) || !panel.label.trim() || panel.label.length > 80 || !panel.icon) {
      throw new Error(`Extension "${manifest.id}" has an invalid panel contribution.`);
    }
    if (panelIds.has(panel.id)) throw new Error(`Extension "${manifest.id}" contributes duplicate panel id "${panel.id}".`);
    panelIds.add(panel.id);
  }
  const designPropertyIds = new Set<string>();
  for (const section of designProperties) {
    if (!section || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(section.id) || !section.title.trim() || section.title.length > 80 || typeof section.render !== "function") {
      throw new Error(`Extension "${manifest.id}" has an invalid design property section.`);
    }
    if (designPropertyIds.has(section.id)) throw new Error(`Extension "${manifest.id}" contributes duplicate design property id "${section.id}".`);
    designPropertyIds.add(section.id);
    if (section.target !== undefined && section.target !== "slide" && section.target !== "elements") {
      throw new Error(`Extension "${manifest.id}" design property section "${section.id}" has an invalid target.`);
    }
    if (section.elementTypes !== undefined && (!Array.isArray(section.elementTypes) || !section.elementTypes.length || new Set(section.elementTypes).size !== section.elementTypes.length || section.elementTypes.some((type) => !EDITOR_ELEMENT_TYPES.has(type)))) {
      throw new Error(`Extension "${manifest.id}" design property section "${section.id}" has an invalid element type filter.`);
    }
    if (section.supportsMultiple !== undefined && typeof section.supportsMultiple !== "boolean") {
      throw new Error(`Extension "${manifest.id}" design property section "${section.id}" has invalid target options.`);
    }
    if (section.target === "slide" && (section.elementTypes !== undefined || section.supportsMultiple !== undefined)) {
      throw new Error(`Extension "${manifest.id}" slide property section "${section.id}" cannot declare element selection options.`);
    }
  }
  const widgetIds = new Set<string>();
  for (const widget of canvasWidgets) {
    if (!widget || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(widget.id) || widget.content === null || widget.content === undefined) {
      throw new Error(`Extension "${manifest.id}" has an invalid canvas widget contribution.`);
    }
    if (widgetIds.has(widget.id)) throw new Error(`Extension "${manifest.id}" contributes duplicate canvas widget id "${widget.id}".`);
    widgetIds.add(widget.id);
  }
  for (const group of groups) {
    if (!Array.isArray(group) || group.length > 32) throw new Error(`Extension "${manifest.id}" has an invalid tool group.`);
    const toolIds = new Set<string>();
    for (const tool of group) {
      if (!tool || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(tool.id) || !tool.label.trim() || tool.label.length > 80 || typeof tool.onClick !== "function") {
        throw new Error(`Extension "${manifest.id}" has an invalid tool contribution.`);
      }
      if (toolIds.has(tool.id)) throw new Error(`Extension "${manifest.id}" contributes duplicate tool id "${tool.id}".`);
      toolIds.add(tool.id);
    }
  }
  const elementActionIds = new Set<string>();
  for (const action of elementMenuActions) {
    if (!action || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(action.id) || !action.label.trim() || action.label.length > 80 || typeof action.onSelect !== "function") {
      throw new Error(`Extension "${manifest.id}" has an invalid element menu action.`);
    }
    if (elementActionIds.has(action.id)) throw new Error(`Extension "${manifest.id}" contributes duplicate element menu action id "${action.id}".`);
    elementActionIds.add(action.id);
    if (!Array.isArray(action.requiredCapabilities) || new Set(action.requiredCapabilities).size !== action.requiredCapabilities.length || action.requiredCapabilities.some((capability) => !manifest.capabilities.includes(capability))) {
      throw new Error(`Extension "${manifest.id}" element menu action "${action.id}" requires a capability not requested by its manifest.`);
    }
    if (action.elementTypes !== undefined && (!Array.isArray(action.elementTypes) || !action.elementTypes.length || new Set(action.elementTypes).size !== action.elementTypes.length || action.elementTypes.some((type) => !EDITOR_ELEMENT_TYPES.has(type)))) {
      throw new Error(`Extension "${manifest.id}" element menu action "${action.id}" has an invalid element type filter.`);
    }
    if ((action.supportsMultiple !== undefined && typeof action.supportsMultiple !== "boolean")
      || (action.allowLocked !== undefined && typeof action.allowLocked !== "boolean")
      || (action.isAvailable !== undefined && typeof action.isAvailable !== "function")) {
      throw new Error(`Extension "${manifest.id}" element menu action "${action.id}" has invalid target options.`);
    }
  }
  for (const [id, renderer] of Object.entries({ ...renderers, ...pptxRenderers })) {
    if (id !== manifest.id || typeof renderer !== "function") throw new Error(`Extension "${manifest.id}" can only register its own slide renderer.`);
  }
  const effectIds = new Set<string>();
  for (const effect of effects) {
    if (!/^[a-z0-9][a-z0-9._-]{0,95}$/.test(effect.id) || !effect.name.trim() || effect.name.length > 80 || !effect.description.trim() || effect.description.length > 240 || typeof effect.render !== "function") {
      throw new Error(`Extension "${manifest.id}" has an invalid shader effect contribution.`);
    }
    if (!new Set(manifest.types ?? ["plugin"]).has(effect.type)) throw new Error(`Extension "${manifest.id}" must declare the "${effect.type}" extension type to contribute this effect.`);
    if (effect.elementTypes !== undefined && (!Array.isArray(effect.elementTypes) || !effect.elementTypes.length || new Set(effect.elementTypes).size !== effect.elementTypes.length || effect.elementTypes.some((type) => !EDITOR_ELEMENT_TYPES.has(type)))) {
      throw new Error(`Extension "${manifest.id}" effect "${effect.id}" has an invalid element type filter.`);
    }
    if (effectIds.has(effect.id)) throw new Error(`Extension "${manifest.id}" contributes duplicate shader effect id "${effect.id}".`);
    effectIds.add(effect.id);
  }
}

/** Bind an extension definition to only the host APIs its manifest declares. */
export function scopeEditorExtensionContext(
  context: EditorExtensionHostContext,
  manifest: ExtensionManifest,
  grants: readonly ExtensionCapability[],
): EditorExtensionContext {
  const granted = new Set(grants);
  const requireCapability = (capability: ExtensionCapability) => {
    if (!granted.has(capability) || !manifest.capabilities.includes(capability)) {
      throw new Error(`Extension "${manifest.name}" does not have the "${capability}" capability.`);
    }
  };
  const editor: ExtensionEditorApi = Object.freeze({
    getDocument: () => {
      requireCapability("catalog.read");
      return structuredClone(context.editor.getDocument());
    },
    execute: (command: EditorCommand) => {
      requireCapability("catalog.write");
      const safeCommand = structuredClone(command);
      validateExtensionCommand(safeCommand, requireCapability);
      return context.editor.execute(safeCommand);
    },
  });
  const products: ProductUi = Object.freeze({
    pick: (options: PickOptions) => {
      requireCapability("catalog.read");
      requireCapability("editor.ui");
      context.products.pick(options);
    },
    edit: (productId?: string, onSaved?: (productId: string) => void) => {
      requireCapability("catalog.read");
      requireCapability("catalog.write");
      requireCapability("assets.write");
      requireCapability("editor.ui");
      context.products.edit(productId, onSaved);
    },
    import: () => {
      requireCapability("catalog.write");
      requireCapability("assets.write");
      requireCapability("network.fetch");
      requireCapability("editor.ui");
      context.products.import();
    },
  });
  const integrations: EditorExtensionIntegrationApi = Object.freeze({
    listConnections: () => {
      requireCapability("integrations.call");
      return context.integrations.listConnections().then((connections) => structuredClone(connections));
    },
    callTool: (connectionId: string, tool: string, args: Record<string, JsonValue>) => {
      requireCapability("integrations.call");
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(connectionId) || !tool.trim() || tool.length > 200) throw new Error("Choose a valid connected service tool.");
      return context.integrations.callTool(connectionId, tool, structuredClone(args));
    },
  });
  return Object.freeze({
    editor,
    get doc() { requireCapability("catalog.read"); return structuredClone(context.editor.getDocument()); },
    get activeSlideId() { requireCapability("catalog.read"); return context.activeSlideId; },
    get assetUrls() { requireCapability("assets.read"); return { ...context.assetUrls }; },
    products,
    integrations,
    insertProduct: (productId: string) => {
      requireCapability("catalog.write");
      requireCapability("editor.render");
      if (!context.editor.getDocument().products.some((product) => product.id === productId)) throw new Error("Choose a product from this catalog before inserting it.");
      context.insertProduct(productId);
    },
    insertGrid: (productIds: string[]) => {
      requireCapability("catalog.write");
      requireCapability("editor.render");
      if (productIds.length > 100 || new Set(productIds).size !== productIds.length) throw new Error("A product grid must contain at most 100 unique products.");
      const existingProducts = new Set(context.editor.getDocument().products.map((product) => product.id));
      if (productIds.some((productId) => !existingProducts.has(productId))) throw new Error("A product grid contains a product outside this catalog.");
      context.insertGrid(productIds);
    },
    importProducts: () => {
      requireCapability("catalog.write");
      requireCapability("assets.write");
      requireCapability("network.fetch");
      context.importProducts();
    },
  });
}

function validateExtensionCommand(command: unknown, requireCapability: (capability: ExtensionCapability) => void) {
  const pending: Array<{ value: unknown; depth: number }> = [{ value: command, depth: 0 }];
  const seen = new WeakSet<object>();
  let visited = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
      throw new Error("Extensions must submit plain editor commands.");
    }
    if (depth > 32 || ++visited > 1_000) throw new Error("The editor command batch is too large or deeply nested.");
    if (seen.has(value)) throw new Error("Editor command batches cannot contain circular or repeated command objects.");
    seen.add(value);
    const entry = value as Record<string, unknown>;
    if (typeof entry.type !== "string") throw new Error("An editor command needs a type.");
    if (entry.type.startsWith("extension.")) {
      throw new Error("Extensions must use their scoped storage API for extension-owned data and cannot manage other installations.");
    }
    if (entry.type === "asset.add" || entry.type === "asset.remove") requireCapability("assets.write");
    if (entry.type === "batch") {
      if (!Array.isArray(entry.commands)) throw new Error("An editor command batch needs a commands array.");
      for (const child of entry.commands) pending.push({ value: child, depth: depth + 1 });
    }
  }
}
