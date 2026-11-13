const MAX_ENCODED_MEDIA_RESPONSE_BYTES = 36 * 1024 * 1024;
type LimitedFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Bound provider responses before the AI SDK parses buffered image/video payloads. */
export function createLimitedMediaFetch(
  fetcher: LimitedFetch = globalThis.fetch,
  maxBytes = MAX_ENCODED_MEDIA_RESPONSE_BYTES,
): LimitedFetch {
  return async (input, init) => {
    const response = await fetcher(input, init);
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("The media provider returned a result larger than the 25 MB catalog asset limit.");
    }
    if (!response.body) return response;

    const reader = response.body.getReader();
    let total = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            reader.releaseLock();
            controller.close();
            return;
          }
          total += value.byteLength;
          if (total > maxBytes) {
            await reader.cancel().catch(() => undefined);
            controller.error(new Error("The media provider returned a result larger than the 25 MB catalog asset limit."));
            return;
          }
          controller.enqueue(value);
        } catch (error) {
          controller.error(error);
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });

    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
