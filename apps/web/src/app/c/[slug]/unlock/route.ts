import { verifyPassword } from "@Kavero/api/services/publication-service";

import { allowAttempt, publications, unlockCookieName, unlockToken } from "@/modules/publishing/access";

export const runtime = "nodejs";

/** Password form target: sets a signed cookie scoped to this catalog's path. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const back = (error?: string) => new URL(`/c/${encodeURIComponent(slug)}${error ? `?error=${error}` : ""}`, request.url);
  const redirect = (url: URL, cookie?: string) => {
    const headers = new Headers({ Location: url.toString() });
    if (cookie) headers.append("Set-Cookie", cookie);
    return new Response(null, { status: 303, headers });
  };

  const pub = await publications().findBySlug(slug);
  if (!pub || pub.visibility !== "password" || !pub.passwordHash) return redirect(back());

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!allowAttempt(`${pub.id}:${ip}`)) return redirect(back("locked"));

  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  if (!password || !(await verifyPassword(password, pub.passwordHash))) return redirect(back("wrong"));

  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return redirect(back(), `${unlockCookieName(pub.id)}=${unlockToken(pub)}; Path=/c/${encodeURIComponent(slug)}; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`);
}
