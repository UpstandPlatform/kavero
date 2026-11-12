"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { PuzzleIcon } from "@hugeicons/core-free-icons";
import { createId, parseCatalogDocument, type CatalogDocument, type CatalogElement, type CatalogSlide } from "@Kavero/catalog-engine";
import type { Editor } from "@Kavero/editor-core";
import { compareSemver, createGrantConfirmationStore, type ExtensionInstalledState, type GrantStorageBackend, type JsonValue } from "@Kavero/extensions";
import type { ExtensionEffectRegistry, ExtensionRendererRegistry } from "@Kavero/renderer";
import type { PptxExtensionRendererRegistry } from "@Kavero/export-pptx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { confirmAction } from "@/components/confirm-dialog";
import { makeTRPCClient } from "@/utils/trpc";

import type { MenuItem } from "../context-menu";
import type { EditorState } from "@Kavero/editor-core";
import type { ProductUi } from "../product-picker";
import type { ExtensionDesignPropertyContent } from "../properties-panel";
import type { RailTool } from "../tool-rail";
import { describeCapability, type ExtensionStoreEntry } from "./extension-store-dialog";
import { ExtensionUiBoundary } from "./extension-ui-boundary";
import { builtInExtensionEffects, builtInExtensionRenderers, createEditorExtensionHost } from "./registry";
import {
  scopeEditorExtensionContext,
  type EditorExportFormat,
  type EditorExtensionDesignPropertySection,
  type EditorExtensionDesignPropertyTarget,
  type EditorExtensionHostContext,
  type EditorIntegrationCallRequest,
} from "./types";

let extensionApiClient: ReturnType<typeof makeTRPCClient> | null = null;
const extensionApi = () => (extensionApiClient ??= makeTRPCClient());

function browserStorage(): GrantStorageBackend | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function ContributedDesignPropertySection({ extensionId, section, target }: {
  extensionId: string;
  section: EditorExtensionDesignPropertySection;
  target: EditorExtensionDesignPropertyTarget;
}) {
  return <ExtensionUiBoundary extensionId={`${extensionId}/${section.id}`}><ContributedDesignPropertyContent section={section} target={target} /></ExtensionUiBoundary>;
}

function ContributedDesignPropertyContent({ section, target }: { section: EditorExtensionDesignPropertySection; target: EditorExtensionDesignPropertyTarget }) {
  return <>{section.render(target)}</>;
}

/** Private copies are only made when a section actually reads them. */
function createDesignTarget(kind: "slide" | "elements", document: CatalogDocument, slide: CatalogSlide, elements: readonly CatalogElement[]): EditorExtensionDesignPropertyTarget {
  let documentCopy: CatalogDocument | undefined;
  let slideCopy: CatalogSlide | undefined;
  let elementsCopy: CatalogElement[] | undefined;
  return {
    kind,
    get document() { return (documentCopy ??= structuredClone(document)); },
    get slide() { return (slideCopy ??= structuredClone(slide)); },
    get elements() { return (elementsCopy ??= structuredClone([...elements])); },
  };
}

/** Keep a registry object stable while its keys and functions are unchanged, so memoized slide views do not re-render. */
function useStableRegistry<T>(next: Record<string, T>): Readonly<Record<string, T>> {
  const ref = useRef(next);
  const previous = ref.current;
  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  const same = previousKeys.length === nextKeys.length && nextKeys.every((key) => previous[key] === next[key]);
  if (!same) ref.current = next;
  return ref.current;
}

function describeArgs(args: Record<string, JsonValue>) {
  try {
    const json = JSON.stringify(args);
    return json.length > 700 ? `${json.slice(0, 700)}…` : json;
  } catch {
    return "(arguments cannot be shown)";
  }
}

export interface UseEditorExtensionsOptions {
  editor: Editor;
  state: EditorState;
  slide: CatalogSlide | undefined;
  assetUrls: Record<string, string>;
  userId: string | null;
  productUi: ProductUi;
  insertProduct(productId: string): void;
  insertGrid(productIds: string[]): void;
  importProducts(): void;
  /** Show an extension panel in the sidebar ("slides" closes it). */
  showSidebar(id: string): void;
  closeStore(): void;
}

/**
 * All editor-side extension wiring: consent-aware host, capability-scoped contributions,
 * activation lifecycle, store actions and context-menu items.
 */
export function useEditorExtensions({ editor, state, slide, assetUrls, userId, productUi, insertProduct, insertGrid, importProducts, showSidebar, closeStore }: UseEditorExtensionsOptions) {
  const doc = state.document;
  const consentStore = useMemo(() => createGrantConfirmationStore({ userId, catalogId: doc.id }, browserStorage()), [userId, doc.id]);
  const consentRef = useRef(consentStore);
  consentRef.current = consentStore;
  // Bumped whenever the local consent record changes, since it lives outside React state.
  const [consentVersion, setConsentVersion] = useState(0);
  const host = useMemo(() => createEditorExtensionHost({ confirmedGrants: (id) => consentRef.current.get(id)?.capabilities }), []);

  // Latest render values behind stable getters, so activated extensions never see stale context.
  const live = useRef({ activeSlideId: state.activeSlideId, assetUrls, productUi, insertProduct, insertGrid, importProducts });
  live.current = { activeSlideId: state.activeSlideId, assetUrls, productUi, insertProduct, insertGrid, importProducts };
  const hostContext = useMemo<EditorExtensionHostContext>(() => ({
    editor,
    get activeSlideId() { return live.current.activeSlideId; },
    get assetUrls() { return live.current.assetUrls; },
    products: {
      pick: (options) => live.current.productUi.pick(options),
      edit: (productId, onSaved) => live.current.productUi.edit(productId, onSaved),
      import: () => live.current.productUi.import(),
    },
    insertProduct: (productId) => live.current.insertProduct(productId),
    insertGrid: (productIds) => live.current.insertGrid(productIds),
    importProducts: () => live.current.importProducts(),
    integrations: {
      listConnections: async () => {
        const connections = await extensionApi().integrations.connections.list.query();
        return connections.map(({ id, name, status, tools }) => ({
          id,
          name,
          status: status as "unknown" | "ok" | "error",
          tools: tools.map(({ name: toolName, title, description }) => ({ name: toolName, title, description })),
        }));
      },
      callTool: (connectionId, tool, args) => extensionApi().integrations.connections.invokeTool.mutate({ id: connectionId, tool, args }),
    },
    integrationConsent: {
      isConnectionAllowed: (extensionId, connectionId) => consentRef.current.get(extensionId)?.connections.includes(connectionId) ?? false,
      allowConnection: (extensionId, connectionId) => consentRef.current.allowConnection(extensionId, connectionId),
      confirmCall: ({ extensionName, connection, tool, args, firstUse }: EditorIntegrationCallRequest) => confirmAction({
        title: `Run ${connection.tools.find((candidate) => candidate.name === tool)?.title || tool}?`,
        description: `${extensionName} wants to call “${tool}” on ${connection.name}. It may read or change data in that service.${firstUse ? `\n\nThis is the first time ${extensionName} uses ${connection.name} in this catalog; continuing allows it to request calls to this service.` : ""}\n\nArguments: ${describeArgs(args)}`,
        confirmLabel: "Run tool",
      }),
    },
  }), [editor]);

  const grantSignature = useMemo(() => host.list().map(({ manifest }) => {
    const record = doc.extensions[manifest.id];
    return `${manifest.id}@${record?.version ?? "-"}:${host.isEnabled(manifest.id, doc.extensions) ? 1 : 0}:${host.grantsFor(manifest.id, doc.extensions).granted.join(",")}`;
  // consentVersion changes what grantsFor returns.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }).join("|"), [host, doc.extensions, consentVersion]);
  const enabledSignature = grantSignature.split("|").filter((entry) => entry.includes(":1:")).join("|");

  const contributions = useMemo(() => host.contribute(hostContext, doc.extensions, (definition, context) =>
    scopeEditorExtensionContext(context, definition.manifest, host.grantsFor(definition.manifest.id, doc.extensions).granted)),
  // Re-contribute when the document, the active slide, asset URLs or effective grants change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [host, hostContext, doc, state.activeSlideId, assetUrls, grantSignature]);

  const panels = useMemo(() => contributions.flatMap(({ definition, contribution }) =>
    (contribution.panels ?? []).map((panel) => ({ ...panel, id: `${definition.manifest.id}/${panel.id}` }))), [contributions]);

  const properties = useMemo<ExtensionDesignPropertyContent[]>(() => !slide ? [] : contributions.flatMap(({ definition, contribution }) =>
    (contribution.designProperties ?? []).flatMap((section) => {
      const selection = slide.elements.filter((element) => state.selection.includes(element.id));
      const targetKind = section.target ?? "elements";
      if (targetKind === "slide" ? selection.length > 0 : selection.length === 0) return [];
      if (targetKind === "elements" && section.elementTypes && selection.some((element) => !section.elementTypes!.includes(element.type))) return [];
      if (targetKind === "elements" && selection.length > 1 && section.supportsMultiple !== true) return [];
      const extensionId = definition.manifest.id;
      const target = createDesignTarget(targetKind, doc, slide, targetKind === "elements" ? selection : []);
      return [{
        id: `${extensionId}/${section.id}`,
        extensionId,
        title: section.title,
        content: <ContributedDesignPropertySection extensionId={extensionId} section={section} target={target} />,
      }];
    })), [contributions, slide, state.selection, doc]);

  const canvasWidgets = useMemo(() => contributions.flatMap(({ definition, contribution }) =>
    (contribution.canvasWidgets ?? []).map((widget) => ({ ...widget, id: `${definition.manifest.id}/${widget.id}`, extensionId: definition.manifest.id }))), [contributions]);

  const toolGroups = useMemo<RailTool[][]>(() => contributions.flatMap(({ definition, contribution }) =>
    (contribution.toolGroups ?? []).map((group) => group.map((tool) => ({
      ...tool,
      id: `${definition.manifest.id}/${tool.id}`,
      onClick: () => {
        const report = (error: unknown) => {
          console.error(`[extension-tool:${definition.manifest.id}/${tool.id}]`, error);
          toast.error(`Could not run ${tool.label}.`);
        };
        try {
          const result = (tool.onClick as () => unknown)();
          if (result && typeof (result as PromiseLike<unknown>).then === "function") void Promise.resolve(result).catch(report);
        } catch (error) {
          report(error);
        }
      },
    })))), [contributions]);

  const renderers: ExtensionRendererRegistry = useStableRegistry(Object.assign({}, builtInExtensionRenderers, ...contributions.map(({ contribution }) => contribution.renderers ?? {})));
  const effects: ExtensionEffectRegistry = useStableRegistry(Object.assign(
    {},
    builtInExtensionEffects,
    ...contributions.map(({ definition, contribution }) => Object.fromEntries(
      (contribution.effects ?? []).map((effect) => [`${definition.manifest.id}/${effect.id}`, effect.render]),
    )),
  ));
  const pptxRenderers: PptxExtensionRendererRegistry = useStableRegistry(Object.assign({}, ...contributions.map(({ contribution }) => contribution.pptxRenderers ?? {})));

  const prepareDocumentForExport = useCallback(async (format: EditorExportFormat, source: CatalogDocument) => {
    const prepared = await host.runHook("catalog.export.prepare", { document: structuredClone(source), format });
    if (prepared.document.id !== source.id) throw new Error("An extension cannot change the catalog identity during export preparation.");
    const parsed = parseCatalogDocument(prepared.document);
    if (!parsed.ok) throw new Error(`Export preparation returned an invalid catalog: ${parsed.issues.slice(0, 3).map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
    return parsed.document;
  }, [host]);

  // Activation lifecycle: re-run only when the catalog or its effectively enabled set changes.
  useEffect(() => {
    let disposed = false;
    const cleanups: (() => void)[] = [];
    const selection = { current: editor.getState().selection };
    let wasDirty = editor.getState().dirty;
    const unsubscribe = editor.subscribe((next, command) => {
      if (command) {
        host.events.emit("editor.command", { catalogId: doc.id, commandType: command.type });
        if (command.type === "extension.install") host.events.emit("extension.installed", { catalogId: doc.id, extensionId: command.extensionId, version: command.version });
        if (command.type === "extension.setEnabled") host.events.emit(command.enabled ? "extension.enabled" : "extension.disabled", { catalogId: doc.id, extensionId: command.extensionId });
        if (command.type === "asset.add") host.events.emit("asset.added", { catalogId: doc.id, assetId: command.asset.id, kind: command.asset.kind });
      }
      if (wasDirty && !next.dirty) host.events.emit("catalog.saved", { catalogId: doc.id, revision: next.document.revision });
      wasDirty = next.dirty;
      if (selection.current !== next.selection) {
        selection.current = next.selection;
        host.events.emit("editor.selectionChanged", { catalogId: doc.id, elementIds: next.selection });
      }
    });
    host.events.emit("catalog.opened", { catalogId: doc.id });

    void Promise.all(host.list()
      .filter((definition) => host.isEnabled(definition.manifest.id, editor.getDocument().extensions))
      .map(async (definition) => {
        const extensionId = definition.manifest.id;
        const createStorageArea = (area: "data" | "settings") => ({
          get: <T extends JsonValue = JsonValue>(key: string) => editor.getDocument().extensions[extensionId]?.[area][key] as T | undefined,
          set: (key: string, value: JsonValue) => {
            const installed = editor.getDocument().extensions;
            if (!installed[extensionId]) {
              // Only trusted default-enabled bundles run without a record; store exactly the grants in effect.
              editor.execute({ type: "extension.install", extensionId, version: definition.manifest.version, grantedCapabilities: host.grantsFor(extensionId, installed).granted }, { history: false });
            }
            // Extension storage is not a user edit: keep it out of undo/redo.
            editor.execute({ type: area === "data" ? "extension.setData" : "extension.setSetting", extensionId, key, value }, { history: false });
          },
          delete: (key: string) => {
            if (editor.getDocument().extensions[extensionId]?.[area][key] !== undefined) {
              editor.execute({ type: area === "data" ? "extension.deleteData" : "extension.deleteSetting", extensionId, key }, { history: false });
            }
          },
        });
        const storage = { data: createStorageArea("data"), settings: createStorageArea("settings") };
        try {
          const granted = host.grantsFor(extensionId, editor.getDocument().extensions).granted;
          // Keep capability-gated properties as getters; spreading the facade would read them eagerly.
          const extensionContext = scopeEditorExtensionContext(hostContext, definition.manifest, granted);
          const dispose = await host.activate(extensionId, extensionContext, { storage }, editor.getDocument().extensions[extensionId]);
          if (disposed) await dispose();
          else cleanups.push(() => { void dispose(); });
        } catch (error) {
          console.error(`[extension:${extensionId}] activation failed`, error);
          toast.error(`The ${definition.manifest.name} extension could not start.`);
        }
      }));

    return () => {
      disposed = true;
      unsubscribe();
      cleanups.forEach((dispose) => dispose());
      void host.deactivateAll();
      host.events.emit("catalog.closed", { catalogId: doc.id });
    };
  }, [editor, host, hostContext, doc.id, enabledSignature]);

  // A catalog may arrive (shared, imported or synced) with extensions turned on that this user never
  // approved. They stay inactive until the user confirms their access on this device.
  const pendingConsent = useMemo(() => host.list()
    .filter(({ manifest }) => host.needsConsent(manifest.id, doc.extensions))
    .map(({ manifest }) => ({ manifest, unconfirmed: host.grantsFor(manifest.id, doc.extensions).unconfirmed })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [host, doc.extensions, consentVersion]);
  const askedConsent = useRef(new Set<string>());
  const [consentPrompting, setConsentPrompting] = useState(false);
  useEffect(() => {
    if (consentPrompting) return;
    const next = pendingConsent.find(({ manifest, unconfirmed }) => !askedConsent.current.has(`${doc.id}:${manifest.id}:${unconfirmed.join(",")}`));
    if (!next) return;
    askedConsent.current.add(`${doc.id}:${next.manifest.id}:${next.unconfirmed.join(",")}`);
    setConsentPrompting(true);
    const store = consentStore;
    void confirmAction({
      title: `Allow ${next.manifest.name} in this catalog?`,
      description: `This catalog has ${next.manifest.name} turned on. It stays off for you until you allow its access on this device:\n\n${next.unconfirmed.map((capability) => `• ${describeCapability(capability)}`).join("\n")}`,
      confirmLabel: "Allow",
      cancelLabel: "Not now",
    }).then((approved) => {
      if (approved) {
        store.confirm(next.manifest.id, next.unconfirmed);
        setConsentVersion((version) => version + 1);
      }
    }).finally(() => setConsentPrompting(false));
  }, [pendingConsent, consentPrompting, consentStore, doc.id]);

  const storeEntries: ExtensionStoreEntry[] = useMemo(() => host.list().map((definition) => {
    const record = doc.extensions[definition.manifest.id];
    const compatible = !!record && host.isCompatibleVersion(definition.manifest.id, record.version);
    return {
      manifest: definition.manifest,
      installed: !!record || definition.manifest.defaultEnabled === true,
      enabled: host.isEnabled(definition.manifest.id, doc.extensions),
      // Same-major versions run as is; offer an update only when it is required or a migration exists.
      updateAvailable: !!record && compareSemver(record.version, definition.manifest.version) < 0 && (!compatible || !!definition.migrations?.[record.version]),
      canUpdate: !!record && host.canMigrate(definition.manifest.id, record.version),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [host, doc.extensions, consentVersion]);

  async function actOnExtension(extensionId: string, action: "install" | "enable" | "disable" | "update" | "uninstall") {
    const definition = host.get(extensionId);
    if (!definition) return;
    const { manifest } = definition;
    try {
      const currentState = editor.getDocument().extensions[extensionId];
      if (action === "install" || action === "enable") {
        if (currentState && !host.isCompatibleVersion(extensionId, currentState.version)) {
          if (compareSemver(currentState.version, manifest.version) > 0) throw new Error(`This catalog uses ${manifest.name} ${currentState.version}, which is newer than this app supports. Update Kavero to use it.`);
          throw new Error(`Update ${manifest.name} before enabling it in this catalog.`);
        }
        const confirmed = consentStore.get(extensionId)?.capabilities ?? [];
        const requested = manifest.defaultEnabled ? [] : manifest.capabilities.filter((capability) => !confirmed.includes(capability));
        if (requested.length) {
          const approved = await confirmAction({
            title: `${action === "install" && !currentState ? "Install" : "Enable"} ${manifest.name}?`,
            description: `This extension requests the following access for this catalog:\n\n${requested.map((capability) => `• ${describeCapability(capability)}`).join("\n")}\n\nThese capabilities are required for the extension to run. Review the request before continuing.`,
            confirmLabel: action === "install" && !currentState ? "Review and install" : "Review and enable",
          });
          if (!approved) return;
        }
        consentStore.confirm(extensionId, manifest.capabilities);
        setConsentVersion((version) => version + 1);
        const grantedCapabilities = [...new Set([...(currentState?.grantedCapabilities ?? []), ...manifest.capabilities])];
        // Keep a newer compatible version recorded by another client instead of downgrading it.
        const version = currentState && compareSemver(currentState.version, manifest.version) > 0 ? currentState.version : manifest.version;
        if (!currentState) editor.execute({ type: "extension.install", extensionId, version, grantedCapabilities });
        else editor.execute({ type: "extension.setEnabled", extensionId, version, enabled: true, grantedCapabilities });
      } else if (action === "disable") {
        editor.execute({ type: "extension.setEnabled", extensionId, version: currentState?.version ?? manifest.version, enabled: false, grantedCapabilities: [...(currentState?.grantedCapabilities ?? [])] });
      } else if (action === "update") {
        if (!currentState) throw new Error("Extension is not installed.");
        const migrated = host.migrateState(extensionId, currentState as unknown as ExtensionInstalledState);
        editor.execute({ type: "extension.update", extensionId, version: migrated.version, settings: migrated.settings, data: migrated.data });
      } else {
        editor.execute({ type: "extension.uninstall", extensionId });
        consentStore.revoke(extensionId);
        setConsentVersion((version) => version + 1);
      }
      if (action === "disable" || action === "uninstall") showSidebar("slides");
      toast.success(action === "install" ? `${manifest.name} installed.` : action === "uninstall" ? `${manifest.name} uninstalled.` : action === "update" ? `${manifest.name} updated.` : `${manifest.name} ${action === "enable" ? "enabled" : "disabled"}.`);
    } catch (error) {
      toast.error((error as Error).message || `Could not ${action} ${manifest.name}.`);
    }
  }

  function runExtension(extensionId: string) {
    const panel = panels.find((item) => item.id.startsWith(`${extensionId}/`));
    if (panel) {
      showSidebar(panel.id);
      closeStore();
      return;
    }
    const tool = toolGroups.flat().find((item) => item.id.startsWith(`${extensionId}/`));
    if (!tool) {
      toast.info("This extension has no panel or run action yet.");
      return;
    }
    closeStore();
    tool.onClick();
  }

  /** Capabilities the extension may use right now, as a set. */
  const grantedSet = (extensionId: string, installed = editor.getDocument().extensions) => new Set(host.grantsFor(extensionId, installed).granted);

  function applyExtensionEffect(extensionId: string, targetElementIds: readonly string[] = state.selection, effectId?: string) {
    const extension = contributions.find((item) => item.definition.manifest.id === extensionId);
    const effect = effectId ? extension?.contribution.effects?.find((item) => item.id === effectId) : extension?.contribution.effects?.[0];
    if (!extension || !effect) {
      toast.error("This extension has no effect to apply.");
      return;
    }
    const currentDocument = editor.getDocument();
    const { manifest } = extension.definition;
    const grants = grantedSet(extensionId, currentDocument.extensions);
    if (!host.isEnabled(extensionId, currentDocument.extensions) || !grants.has("catalog.write") || !grants.has("editor.render")) {
      toast.error(`${manifest.name} does not have permission to apply this effect.`);
      return;
    }
    const selectedIds = new Set(targetElementIds);
    const selectedElements = currentDocument.slides.flatMap((candidate) => candidate.elements).filter((element) => selectedIds.has(element.id));
    const targets = selectedElements.filter((element) => !element.locked && (!effect.elementTypes || effect.elementTypes.includes(element.type)));
    if (!targets.length) {
      toast.info(selectedElements.length ? "No unlocked selected layer supports this effect." : "Select a layer on the canvas first.");
      return;
    }
    const commands = targets.flatMap((element) => {
      const remaining = (element.effects ?? []).filter((item) => item.extensionId !== extensionId || item.effectId !== effect.id);
      if (remaining.length >= 8) return [];
      return [{
        type: "element.update" as const,
        elementId: element.id,
        changes: { effects: [...remaining, { id: createId("fx"), extensionId, effectId: effect.id, type: effect.type, parameters: structuredClone(effect.defaultParameters ?? {}) }] },
      }];
    });
    if (!commands.length) {
      toast.info("Selected layers already have the maximum of 8 effects.");
      return;
    }
    try {
      editor.execute({ type: "batch", commands });
      toast.success(`${effect.name} applied to ${commands.length} ${commands.length === 1 ? "layer" : "layers"}.`);
    } catch (error) {
      toast.error((error as Error).message || `Could not apply ${effect.name}.`);
    }
  }

  function removeExtensionEffect(extensionId: string, effectId: string, targetElementIds: readonly string[]) {
    const extension = contributions.find((item) => item.definition.manifest.id === extensionId);
    const effect = extension?.contribution.effects?.find((item) => item.id === effectId);
    if (!extension || !effect) return;
    const currentDocument = editor.getDocument();
    const { manifest } = extension.definition;
    if (!host.isEnabled(extensionId, currentDocument.extensions) || !grantedSet(extensionId, currentDocument.extensions).has("catalog.write")) {
      toast.error(`${manifest.name} does not have permission to update this layer.`);
      return;
    }
    const selectedIds = new Set(targetElementIds);
    const targets = currentDocument.slides.flatMap((candidate) => candidate.elements).filter((element) =>
      selectedIds.has(element.id) && !element.locked && (!effect.elementTypes || effect.elementTypes.includes(element.type))
      && element.effects.some((item) => item.extensionId === extensionId && item.effectId === effectId));
    if (!targets.length) return;
    try {
      editor.execute({
        type: "batch",
        commands: targets.map((element) => ({
          type: "element.update" as const,
          elementId: element.id,
          changes: { effects: element.effects.filter((item) => item.extensionId !== extensionId || item.effectId !== effectId) },
        })),
      });
      toast.success(`${effect.name} removed from ${targets.length} ${targets.length === 1 ? "layer" : "layers"}.`);
    } catch (error) {
      toast.error((error as Error).message || `Could not remove ${effect.name}.`);
    }
  }

  function getExtensionElementMenuItems(targetElements: readonly CatalogElement[]): MenuItem[] {
    const extensionItems: MenuItem[] = [];
    for (const { definition, contribution } of contributions) {
      const { manifest } = definition;
      const extensionId = manifest.id;
      if (!host.isEnabled(extensionId, doc.extensions)) continue;
      const grants = grantedSet(extensionId, doc.extensions);
      const items: MenuItem[] = [];

      if (grants.has("editor.ui")) {
        for (const action of contribution.elementMenuActions ?? []) {
          if (!action.requiredCapabilities.every((capability) => grants.has(capability))) continue;
          const eligibleElements = targetElements.filter((element) => (action.allowLocked || !element.locked) && (!action.elementTypes || action.elementTypes.includes(element.type)));
          if (!eligibleElements.length || (action.supportsMultiple === false && eligibleElements.length !== 1)) continue;
          const targets = eligibleElements.map(({ id, type }) => ({ id, type }));
          try {
            if (action.isAvailable && !action.isAvailable(targets)) continue;
          } catch (error) {
            console.error(`[extension-menu:${extensionId}/${action.id}] availability check failed`, error);
            continue;
          }
          items.push({
            label: action.label,
            icon: action.icon,
            onSelect: () => {
              const reportError = (error: unknown) => {
                console.error(`[extension-menu:${extensionId}/${action.id}] action failed`, error);
                toast.error(`Could not run ${action.label}.`);
              };
              try { void Promise.resolve(action.onSelect(targets)).catch(reportError); } catch (error) { reportError(error); }
            },
          });
        }
      }

      if (grants.has("catalog.write") && grants.has("editor.render")) {
        for (const effect of contribution.effects ?? []) {
          const compatibleTargets = targetElements.filter((element) => !element.locked && (!effect.elementTypes || effect.elementTypes.includes(element.type)));
          if (!compatibleTargets.length) continue;
          const hasEffect = (element: CatalogElement) => element.effects.some((item) => item.extensionId === extensionId && item.effectId === effect.id);
          if (compatibleTargets.some((element) => hasEffect(element) || element.effects.length < 8)) {
            items.push({ label: `Apply ${effect.name}`, onSelect: () => applyExtensionEffect(extensionId, compatibleTargets.map((element) => element.id), effect.id) });
          }
          const appliedTargets = compatibleTargets.filter(hasEffect);
          if (appliedTargets.length) {
            items.push({ label: `Remove ${effect.name}`, onSelect: () => removeExtensionEffect(extensionId, effect.id, appliedTargets.map((element) => element.id)) });
          }
        }
      }

      if (items.length) extensionItems.push({ type: "submenu", label: manifest.name, icon: <HugeiconsIcon icon={PuzzleIcon} />, items });
    }
    return extensionItems.length ? [{ type: "submenu", label: "Extensions", icon: <HugeiconsIcon icon={PuzzleIcon} />, items: extensionItems }] : [];
  }

  return {
    host,
    contributions,
    panels,
    properties,
    canvasWidgets,
    toolGroups,
    renderers,
    effects,
    pptxRenderers,
    prepareDocumentForExport,
    storeEntries,
    actOnExtension,
    runExtension,
    applyExtensionEffect,
    getExtensionElementMenuItems,
  };
}
