import { platform, runtimeConfig } from "@/platform";

export const runtime = "nodejs";

/**
 * Settings the browser needs at runtime (so they can change in Admin → System
 * without rebuilding). Only public values: never add credentials here.
 */
export async function GET() {
  const [media, exportsConfig] = await Promise.all([runtimeConfig.values("media"), runtimeConfig.values("exports")]);
  return Response.json(
    {
      edition: platform.edition,
      features: platform.features,
      media: {
        openverseEnabled: media.openverseEnabled === true,
        // GIPHY keys are public by design: GIPHY's browser SDKs use them directly.
        giphyApiKey: typeof media.giphyApiKey === "string" ? media.giphyApiKey.trim() : "",
      },
      // Largest PDF/image/video export upload, so the editor can warn before sending.
      exports: { maxRequestMb: typeof exportsConfig.maxRequestMb === "number" ? exportsConfig.maxRequestMb : 60 },
    },
    { headers: { "Cache-Control": "public, max-age=30" } },
  );
}
