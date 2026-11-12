import type { CatalogDocument } from "@Kavero/catalog-engine";

import { applyCommand, CommandError, type EditorCommand } from "./commands";

/**
 * Fingerprints of everything another extension owns on the slides: its extension elements and the
 * effects it attached to any element. Keys are stable ids, values are serialized state.
 */
function foreignState(doc: CatalogDocument, extensionId: string) {
  const owned = new Map<string, string>();
  for (const slide of doc.slides) {
    for (const element of slide.elements) {
      if (element.type === "extension" && element.extensionId !== extensionId) {
        owned.set(`element:${element.id}`, `${slide.id}\u0000${JSON.stringify(element)}`);
      }
      for (const effect of element.effects ?? []) {
        if (effect.extensionId !== extensionId) owned.set(`effect:${element.id}:${effect.id}`, JSON.stringify(effect));
      }
    }
  }
  return owned;
}

/**
 * Throws when applying `after` (the result of an extension's command) added, removed or changed
 * slide elements or element effects that belong to a different extension.
 */
export function assertExtensionOwnership(before: CatalogDocument, after: CatalogDocument, extensionId: string) {
  const previous = foreignState(before, extensionId);
  const next = foreignState(after, extensionId);
  for (const [key, value] of next) {
    if (previous.get(key) !== value) throw new CommandError(`Extension "${extensionId}" cannot create or change content owned by another extension (${key.split(":")[0]}).`);
  }
  for (const key of previous.keys()) {
    if (!next.has(key)) throw new CommandError(`Extension "${extensionId}" cannot remove content owned by another extension (${key.split(":")[0]}).`);
  }
}

/** Dry-run `command` on a copy of `doc` and reject it if it touches another extension's content. */
export function checkExtensionCommandOwnership(doc: CatalogDocument, command: EditorCommand, extensionId: string) {
  const draft = structuredClone(doc);
  applyCommand(draft, structuredClone(command));
  assertExtensionOwnership(doc, draft, extensionId);
}
