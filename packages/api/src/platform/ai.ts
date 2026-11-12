import { providerFromEnv, type LlmProvider } from "@Kavero/ai";

import type { SectionValues } from "./runtime-config";

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);

/** The server-wide AI provider from the resolved `ai` settings section, or null (built-in planner only). */
export function providerFromSettings(ai: SectionValues): LlmProvider | null {
  const provider = str(ai.provider);
  return providerFromEnv({
    AI_PROVIDER: provider === "auto" ? undefined : provider,
    AI_MODEL: str(ai.model),
    ANTHROPIC_API_KEY: str(ai.anthropicApiKey),
    OPENAI_API_KEY: str(ai.openaiApiKey),
    AI_BASE_URL: str(ai.baseUrl),
  });
}
