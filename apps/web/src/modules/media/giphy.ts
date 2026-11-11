type GiphyAssetResponse = {
  data?: { images?: { original?: { url?: string } } };
};

/** Resolve a GIPHY item from its stable ID; the transient CDN URL is kept in memory only. */
export async function resolveGiphyMediaUrl(id: string, apiKey: string, signal?: AbortSignal): Promise<string | undefined> {
  if (!apiKey) return undefined;
  const params = new URLSearchParams({ api_key: apiKey, rating: "g" });
  const response = await fetch(`https://api.giphy.com/v1/gifs/${encodeURIComponent(id)}?${params}`, { signal });
  if (!response.ok) return undefined;
  const data = await response.json() as GiphyAssetResponse;
  const url = data.data?.images?.original?.url;
  return url && /^https:\/\//i.test(url) ? url : undefined;
}
