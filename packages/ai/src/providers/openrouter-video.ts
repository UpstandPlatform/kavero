import { Buffer } from "node:buffer";

import type { Experimental_VideoModelV4 } from "@ai-sdk/provider";

const BASE_URL = "https://openrouter.ai/api/v1";
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
type OpenRouterFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type OpenRouterVideoJob = {
  id?: unknown;
  status?: unknown;
  error?: unknown;
};

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("OpenRouter returned a video larger than Kavero's 25 MB asset limit.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function readJson(response: Response): Promise<OpenRouterVideoJob> {
  const bytes = await readLimited(response, MAX_JSON_BYTES);
  try { return JSON.parse(new TextDecoder().decode(bytes)) as OpenRouterVideoJob; }
  catch { throw new Error(`OpenRouter returned an invalid video job response (HTTP ${response.status}).`); }
}

function message(value: unknown, fallback: string) {
  if (typeof value === "string" && value.trim()) return value.slice(0, 300);
  if (value && typeof value === "object" && "message" in value && typeof value.message === "string") return value.message.slice(0, 300);
  return fallback;
}

function requestHeaders(apiKey: string, appUrl?: string, extra?: Record<string, string | undefined>) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...(appUrl ? { "HTTP-Referer": appUrl } : {}),
    "X-Title": "Kavero",
    ...Object.fromEntries(Object.entries(extra ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
  };
}

function operationId(value: unknown) {
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string" && value.id.length > 0 && value.id.length <= 200) return value.id;
  throw new Error("OpenRouter returned an invalid video job reference.");
}

function isMp4(bytes: Uint8Array) {
  return bytes.length >= 12 && String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp";
}

/** AI SDK v4 video adapter for OpenRouter's asynchronous Video Generation API. */
export function openRouterVideoModel(input: { apiKey: string; model: string; appUrl?: string; fetch?: OpenRouterFetch }): Experimental_VideoModelV4 {
  const send: OpenRouterFetch = input.fetch ?? ((url, init) => globalThis.fetch(url, init));
  return {
    specificationVersion: "v4",
    provider: "openrouter",
    modelId: input.model,
    maxVideosPerCall: 1,
    async doStart(options) {
      if (!options.prompt?.trim()) throw new Error("OpenRouter video generation requires a text prompt.");
      if (options.image || options.frameImages?.length || options.inputReferences?.length) {
        throw new Error("Image and reference inputs are not available in this video workflow.");
      }
      const timestamp = new Date();
      const response = await send(`${BASE_URL}/videos`, {
        method: "POST",
        headers: requestHeaders(input.apiKey, input.appUrl, options.headers),
        body: JSON.stringify({
          model: input.model,
          prompt: options.prompt,
          ...(options.aspectRatio ? { aspect_ratio: options.aspectRatio } : {}),
          ...(options.resolution ? { resolution: options.resolution } : {}),
          ...(options.duration ? { duration: options.duration } : {}),
          ...(options.fps ? { fps: options.fps } : {}),
          ...(options.seed !== undefined ? { seed: options.seed } : {}),
          ...(options.generateAudio !== undefined ? { generate_audio: options.generateAudio } : {}),
        }),
        signal: options.abortSignal,
      });
      const result = await readJson(response);
      if (!response.ok) throw new Error(`OpenRouter video generation failed: ${message(result.error, `HTTP ${response.status}`)}`);
      const id = typeof result.id === "string" ? result.id : "";
      if (!id || id.length > 200) throw new Error("OpenRouter did not return a video job ID.");
      return {
        operation: { id },
        warnings: [],
        response: { timestamp, modelId: input.model, headers: Object.fromEntries(response.headers.entries()) },
      };
    },
    async doStatus({ operation, abortSignal, headers }) {
      const id = operationId(operation);
      const timestamp = new Date();
      const response = await send(`${BASE_URL}/videos/${encodeURIComponent(id)}`, {
        headers: requestHeaders(input.apiKey, input.appUrl, headers),
        signal: abortSignal,
      });
      const result = await readJson(response);
      if (!response.ok) throw new Error(`OpenRouter video status failed: ${message(result.error, `HTTP ${response.status}`)}`);
      const status = typeof result.status === "string" ? result.status.toLowerCase() : "";
      const responseInfo = { timestamp, modelId: input.model, headers: Object.fromEntries(response.headers.entries()) };
      if (["pending", "queued", "processing", "in_progress"].includes(status)) return { status: "pending", response: responseInfo };
      if (["failed", "cancelled", "canceled", "expired"].includes(status)) {
        return { status: "error", error: message(result.error, `OpenRouter video generation ${status}.`), response: responseInfo };
      }
      if (status !== "completed") throw new Error(`OpenRouter returned an unknown video job status: ${status || "empty"}.`);

      const videoResponse = await send(`${BASE_URL}/videos/${encodeURIComponent(id)}/content?index=0`, {
        headers: requestHeaders(input.apiKey, input.appUrl, headers),
        signal: abortSignal,
      });
      if (!videoResponse.ok) {
        const errorBody = await readLimited(videoResponse, MAX_JSON_BYTES).catch(() => new Uint8Array());
        let error: unknown;
        try { error = JSON.parse(new TextDecoder().decode(errorBody)) as unknown; } catch { /* use the status */ }
        throw new Error(`OpenRouter video download failed: ${message(error, `HTTP ${videoResponse.status}`)}`);
      }
      const bytes = await readLimited(videoResponse, MAX_VIDEO_BYTES);
      const mediaType = (videoResponse.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      if ((mediaType && mediaType !== "video/mp4" && mediaType !== "application/octet-stream") || !isMp4(bytes)) {
        throw new Error("OpenRouter returned a video that is not a valid MP4 file.");
      }
      return {
        status: "completed",
        videos: [{ type: "binary", data: bytes, mediaType: "video/mp4" }],
        warnings: [],
        response: { timestamp: new Date(), modelId: input.model, headers: Object.fromEntries(videoResponse.headers.entries()) },
      };
    },
  };
}
