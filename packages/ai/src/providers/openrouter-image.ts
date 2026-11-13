import { Buffer } from "node:buffer";

import type { ImageModel } from "ai";

const MAX_RESPONSE_BYTES = 36 * 1024 * 1024;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

type OpenRouterImageResponse = {
  data?: Array<{ b64_json?: unknown; media_type?: unknown }>;
  error?: { message?: unknown };
  model?: unknown;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
};

async function readLimited(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("The image provider returned a response larger than 36 MB.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function tokenCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** AI SDK v4 image adapter for OpenRouter's dedicated, unified Image API. */
export function openRouterImageModel(input: { apiKey: string; model: string; appUrl?: string }): ImageModel {
  return {
    specificationVersion: "v4",
    provider: "openrouter",
    modelId: input.model,
    maxImagesPerCall: 1,
    supportsFileInputs: false,
    supportsMaskInputs: false,
    async doGenerate(options) {
      if (options.files?.length || options.mask) throw new Error("OpenRouter image editing is not available in this workflow.");
      const startedAt = new Date();
      const response = await fetch("https://openrouter.ai/api/v1/images", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json",
          ...(input.appUrl ? { "HTTP-Referer": input.appUrl } : {}),
          "X-Title": "Kavero",
          ...options.headers,
        },
        body: JSON.stringify({
          model: input.model,
          prompt: options.prompt,
          n: options.n,
        }),
        signal: options.abortSignal,
      });
      const raw = await readLimited(response);
      let payload: OpenRouterImageResponse | null = null;
      try { payload = JSON.parse(new TextDecoder().decode(raw)) as OpenRouterImageResponse; } catch { /* include the HTTP status below */ }
      if (!response.ok) {
        const detail = typeof payload?.error?.message === "string" ? payload.error.message.slice(0, 300) : `HTTP ${response.status}`;
        throw new Error(`OpenRouter image generation failed: ${detail}`);
      }
      const records = payload?.data;
      if (!Array.isArray(records) || !records.length) throw new Error("OpenRouter did not return an image.");
      const images = records.slice(0, options.n).map((record) => {
        if (typeof record.b64_json !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(record.b64_json)) {
          throw new Error("OpenRouter returned an image without valid base64 data.");
        }
        const data = Buffer.from(record.b64_json, "base64");
        if (!data.byteLength || data.byteLength > MAX_IMAGE_BYTES) throw new Error("The generated image is empty or larger than the 25 MB asset limit.");
        return new Uint8Array(data);
      });
      if (!images.length) throw new Error("OpenRouter did not return an image.");
      return {
        images,
        warnings: [],
        response: {
          timestamp: startedAt,
          modelId: typeof payload?.model === "string" ? payload.model : input.model,
          headers: Object.fromEntries(response.headers.entries()),
        },
        ...(payload?.usage ? { usage: {
          inputTokens: tokenCount(payload.usage.prompt_tokens),
          outputTokens: tokenCount(payload.usage.completion_tokens),
          totalTokens: tokenCount(payload.usage.total_tokens),
        } } : {}),
      };
    },
  };
}
