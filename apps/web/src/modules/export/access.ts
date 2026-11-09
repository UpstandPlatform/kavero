import { auth } from "@/services";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Video export launches Chrome on the server. Allow it for a local Kavero
 * (local-first, no account needed) or for signed-in users on a hosted server.
 */
export async function canExport(request: Request): Promise<boolean> {
  const host = new URL(request.url).hostname;
  if (LOCAL_HOSTS.has(host) && process.env.NODE_ENV !== "production") return true;
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    return !!session?.user;
  } catch {
    return false;
  }
}
