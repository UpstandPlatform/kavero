import { toNextJsHandler } from "better-auth/next-js";
import { audit } from "@Kavero/api/services/audit-service";

import { auth, db } from "../../../../services";

const handlers = toNextJsHandler(auth);

export const GET = handlers.GET;

export async function POST(request: Request) {
  const path = new URL(request.url).pathname;
  const action = path.endsWith("/sign-in/email") ? "sign_in" : path.endsWith("/sign-up/email") ? "sign_up" : path.endsWith("/sign-out") ? "sign_out" : null;
  if (!action) return handlers.POST(request);

  const before = action === "sign_out" ? await auth.api.getSession({ headers: request.headers }).catch(() => null) : null;
  const response = await handlers.POST(request);
  let userId = before?.user.id;
  if (response.ok && action !== "sign_out") {
    const body = await response.clone().json().catch(() => null) as { user?: { id?: unknown }; data?: { user?: { id?: unknown } } } | null;
    const id = body?.user?.id ?? body?.data?.user?.id;
    userId = typeof id === "string" ? id : undefined;
  }
  await audit(db, {
    userId,
    area: "auth",
    channel: "web",
    action: `auth:${action}`,
    outcome: response.ok ? "ok" : response.status === 401 || response.status === 403 ? "denied" : "error",
  });
  return response;
}
