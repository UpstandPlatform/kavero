import { platform, runtimeConfig } from "@/platform";

export const runtime = "nodejs";

/**
 * Settings the browser needs at runtime (so they can change in Admin → System
 * without rebuilding). Only public values: never add credentials here.
 */
export async function GET() {
  const media = await runtimeConfig.values("media");
  return Response.json(
    {
      edition: platform.edition,
      features: platform.features,
      media: {
        openverseEnabled: media.openverseEnabled === true,
        // GIPHY keys are public by design: GIPHY's browser SDKs use them directly.
        giphyApiKey: typeof media.giphyApiKey === "string" ? media.giphyApiKey.trim() : "",
      },
    },
    { headers: { "Cache-Control": "public, max-age=30" } },
  );
}
