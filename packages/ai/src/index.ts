import type { CatalogDocument, PagePreset, Product } from "@Kavero/catalog-engine";
import type { EditorCommand } from "@Kavero/editor-core";

import { buildCatalog } from "./build";
import { EDITOR_SYSTEM, editPlanSchema, editorPrompt, opsToCommands } from "./edit";
import { PLANNER_SYSTEM, catalogPlanSchema, chooseTemplate, heuristicPlan, normalizePlan, plannerPrompt, type CatalogPlan } from "./plan";
import { AiError, type LlmProvider } from "./providers";

export * from "./providers";
export * from "./plan";
export * from "./build";
export * from "./edit";

export interface GenerateInput {
  brief: string;
  products: Product[];
  templateId?: string;
  page?: PagePreset;
  language?: string;
  currency?: string;
}

export interface GenerateResult {
  document: CatalogDocument;
  plan: CatalogPlan;
  /** "ai" when a model planned it, "offline" for the built-in planner. */
  source: "ai" | "offline";
  model?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/**
 * Plan → build → validate. With no provider, uses the offline planner so
 * generation works without a model (local-first).
 */
export async function generateCatalog(provider: LlmProvider | null, input: GenerateInput, signal?: AbortSignal): Promise<GenerateResult> {
  const fallbackTemplate = chooseTemplate(input.brief, input.templateId);
  if (!provider) {
    const plan = heuristicPlan(input);
    return { plan, document: buildCatalog(plan, input), source: "offline" };
  }
  const r = await provider.generateObject({ system: PLANNER_SYSTEM, prompt: plannerPrompt(input), schema: catalogPlanSchema, schemaName: "catalog_plan", signal });
  const plan = normalizePlan({ ...r.value, templateId: input.templateId ?? r.value.templateId }, input.products, fallbackTemplate);
  return { plan, document: buildCatalog(plan, input), source: "ai", model: r.model, usage: r.usage };
}

export interface EditResult {
  summary: string;
  commands: EditorCommand[];
  skipped: string[];
  model: string;
}

/** Ask the model for an edit; returns validated editor commands for the user to approve. */
export async function proposeEdit(provider: LlmProvider | null, doc: CatalogDocument, slideId: string, instruction: string, signal?: AbortSignal): Promise<EditResult> {
  if (!provider) throw new AiError("AI editing needs an AI provider. Ask your administrator to configure one.", "not_configured");
  if (!doc.slides.some((s) => s.id === slideId)) throw new AiError("Slide not found", "bad_request");
  const r = await provider.generateObject({ system: EDITOR_SYSTEM, prompt: editorPrompt(doc, slideId, instruction), schema: editPlanSchema, schemaName: "slide_edit", maxTokens: 8000, signal });
  const { commands, skipped } = opsToCommands(doc, slideId, r.value);
  return { summary: r.value.summary, commands, skipped, model: r.model };
}
