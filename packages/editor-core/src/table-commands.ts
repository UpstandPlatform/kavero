import { applyTableOps, TableEditError, type CatalogElement, type TableOp } from "@Kavero/catalog-engine";

import { CommandError } from "./commands";

export type { TableOp } from "@Kavero/catalog-engine";

/** The `table.edit` command: apply table ops to a table element and return the updated element. */
export function applyTableEdit(element: CatalogElement, ops: readonly TableOp[]): CatalogElement {
  if (element.type !== "table") throw new CommandError("Only table elements can be edited as tables");
  if (!ops.length) return element;
  try {
    return { ...element, content: applyTableOps(element.content, ops) };
  } catch (error) {
    if (error instanceof TableEditError) throw new CommandError(error.message);
    throw error;
  }
}
