import { createResilientRateLimiter } from "@Kavero/redis";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "../index";
import { McpConnectionService } from "../services/mcp-connection-service";
import { extractProducts } from "../services/product-extract";
import { fetchImagesWithBudget } from "../services/safe-fetch";
import { AUDIT_AREAS, SCOPES, audit, listAudit, permissionsToScopes, scopesToPermissions, type Scope } from "../services/audit-service";

const scope = z.enum(Object.keys(SCOPES) as [Scope, ...Scope[]]);
const connectionInput = z.object({
  name: z.string().min(1).max(80),
  url: z.string().min(1).max(2000),
  transport: z.enum(["streamable-http", "sse"]).default("streamable-http"),
  authType: z.enum(["none", "bearer", "header"]).default("none"),
  authHeader: z.string().max(64).optional(),
  secret: z.string().max(4000).optional(),
});
const API_KEY_LIST_LIMIT = 100;

/** Each limiter is per user; Redis-backed when configured, with a bounded in-process fallback. */
const connectionWriteLimiter = createResilientRateLimiter({ namespace: "mcp-connection-write", maxRequests: 20, windowMs: 60_000 });
const toolCallLimiter = createResilientRateLimiter({ namespace: "mcp-tool-call", maxRequests: 30, windowMs: 60_000 });
/** Weighted by the number of images requested. */
const imageFetchLimiter = createResilientRateLimiter({ namespace: "image-fetch", maxRequests: 120, windowMs: 60_000 });

async function rateLimit(limiter: typeof toolCallLimiter, userId: string, message: string, weight = 1) {
  const decision = await limiter.limit(userId, weight);
  if (!decision.allowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message });
}
const CONNECTION_LIMIT_MESSAGE = "Too many connection changes. Wait a minute and try again.";
const TOOL_LIMIT_MESSAGE = "Too many connected tool calls. Wait a minute and try again.";

/** API keys, audit log and external MCP connections for the signed-in user. */
export const integrationsRouter = router({
  apiKeys: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.auth || !ctx.headers) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "API-key management isn't configured on this server" });
      const result = await ctx.auth.api.listApiKeys({ query: { limit: API_KEY_LIST_LIMIT }, headers: ctx.headers });
      return result.apiKeys.map(({ id, name, start, prefix, permissions, expiresAt, createdAt, lastRequest, enabled }) => ({
        id, name, start, prefix, permissions, scopes: permissionsToScopes(permissions), expiresAt, createdAt, lastRequest, enabled,
      }));
    }),
    create: protectedProcedure
      .input(z.object({
        name: z.string().trim().min(1).max(80),
        scopes: z.array(scope).min(1),
        expiresInDays: z.number().int().min(1).max(365).default(90),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.auth) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "API-key management isn't configured on this server" });
        try {
          const result = await ctx.auth.api.createApiKey({
            body: {
              // Do not pass request headers here: Better Auth treats a call with
              // headers as a client request and rejects server-only permissions.
              userId: ctx.session.user.id,
              name: input.name,
              expiresIn: input.expiresInDays * 24 * 60 * 60,
              permissions: scopesToPermissions(input.scopes),
            },
          });
          await audit(ctx.db, { userId: ctx.session.user.id, apiKeyId: result.id, action: "api-key:create", outcome: "ok", details: { scopes: input.scopes } });
          return {
            id: result.id,
            key: result.key,
            name: result.name,
            start: result.start,
            prefix: result.prefix,
            permissions: result.permissions,
            scopes: input.scopes,
            expiresAt: result.expiresAt,
            createdAt: result.createdAt,
          };
        } catch (error) {
          await audit(ctx.db, { userId: ctx.session.user.id, action: "api-key:create", outcome: "error", details: { scopes: input.scopes } });
          throw error;
        }
      }),
    revoke: protectedProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ ctx, input }) => {
      if (!ctx.auth || !ctx.headers) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "API-key management isn't configured on this server" });
      try {
        const result = await ctx.auth.api.deleteApiKey({ body: { keyId: input.id }, headers: ctx.headers });
        await audit(ctx.db, { userId: ctx.session.user.id, apiKeyId: input.id, action: "api-key:revoke", outcome: result.success ? "ok" : "error" });
        return result;
      } catch (error) {
        await audit(ctx.db, { userId: ctx.session.user.id, apiKeyId: input.id, action: "api-key:revoke", outcome: "error" });
        throw error;
      }
    }),
  }),

  audit: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(50),
      before: z.coerce.date().optional(),
      beforeId: z.string().max(100).optional(),
      area: z.enum(AUDIT_AREAS).optional(),
      outcome: z.enum(["ok", "denied", "error"]).optional(),
    }).optional())
    .query(({ ctx, input }) => listAudit(ctx.db, { userId: ctx.session.user.id, ...(input ?? { limit: 50 }) })),

  connections: router({
    list: protectedProcedure.query(({ ctx }) => connections(ctx).list(ctx.session.user.id)),
    create: protectedProcedure.input(connectionInput).mutation(async ({ ctx, input }) => {
      await rateLimit(connectionWriteLimiter, ctx.session.user.id, CONNECTION_LIMIT_MESSAGE);
      return audited(ctx, "mcp-client:create", null, () => connections(ctx).create(ctx.session.user.id, input));
    }),
    update: protectedProcedure.input(connectionInput.extend({ id: z.string() })).mutation(async ({ ctx, input: { id, ...rest } }) => {
      await rateLimit(connectionWriteLimiter, ctx.session.user.id, CONNECTION_LIMIT_MESSAGE);
      return audited(ctx, "mcp-client:update", id, () => connections(ctx).update(ctx.session.user.id, id, rest));
    }),
    remove: protectedProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => audited(ctx, "mcp-client:remove", input.id, () => connections(ctx).remove(ctx.session.user.id, input.id))),
    check: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
      await rateLimit(connectionWriteLimiter, ctx.session.user.id, CONNECTION_LIMIT_MESSAGE);
      return audited(ctx, "mcp-client:check", input.id, () => connections(ctx).check(ctx.session.user.id, input.id));
    }),

    /** Call an explicitly selected tool on a server owned by the signed-in user. */
    invokeTool: protectedProcedure
      .input(z.object({ id: z.string(), tool: z.string().min(1).max(200), args: z.record(z.string(), z.unknown()).default({}) }))
      .mutation(async ({ ctx, input }) => {
        await rateLimit(toolCallLimiter, ctx.session.user.id, TOOL_LIMIT_MESSAGE);
        return callAuditedConnectionTool(ctx, ctx.session.user.id, input);
      }),

    /** Call a tool and turn its result into products for the import preview. */
    importProducts: protectedProcedure
      .input(z.object({ id: z.string(), tool: z.string().min(1).max(200), args: z.record(z.string(), z.unknown()).default({}) }))
      .mutation(async ({ ctx, input }) => {
        await rateLimit(toolCallLimiter, ctx.session.user.id, TOOL_LIMIT_MESSAGE);
        const result = await callAuditedConnectionTool(ctx, ctx.session.user.id, input);
        if (result.isError) {
          const text = result.content?.find((c) => c.type === "text")?.text ?? "The tool reported an error";
          throw new TRPCError({ code: "BAD_REQUEST", message: text.slice(0, 500) });
        }
        const products = extractProducts(result);
        const rawPreview = result.content?.find((c) => c.type === "text")?.text?.slice(0, 1500);
        return { products, rawPreview: products.length ? undefined : rawPreview };
      }),
  }),

  /** Download product images server-side (with SSRF checks) so the browser can store them locally. */
  fetchImages: protectedProcedure
    .input(z.object({ urls: z.array(z.string().max(2000)).max(30) }))
    .mutation(async ({ ctx, input }) => {
      if (input.urls.length) await rateLimit(imageFetchLimiter, ctx.session.user.id, "Too many image downloads. Wait a minute and try again.", input.urls.length);
      const allowLocal = ctx.allowLocalUrls ?? false;
      // Bounded parallelism and a total byte budget keep one request from holding hundreds of MB.
      const results = await fetchImagesWithBudget(input.urls, { allowLocal, concurrency: 4, maxTotalBytes: 32 * 1024 * 1024 });
      await audit(ctx.db, {
        userId: ctx.session.user.id,
        area: "assets",
        action: "asset:fetch_external",
        outcome: results.some((result) => "error" in result) ? "error" : "ok",
        details: { requested: input.urls.length, failed: results.filter((result) => "error" in result).length },
      });
      return results;
    }),
});

function connections(ctx: { db: Parameters<typeof audit>[0]; secretBox?: import("../services/secret-box").SecretBox; allowLocalUrls?: boolean }) {
  if (!ctx.secretBox) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Connections aren't configured on this server" });
  return new McpConnectionService(ctx.db, ctx.secretBox, { allowLocal: ctx.allowLocalUrls ?? false });
}

async function callAuditedConnectionTool(
  ctx: Parameters<typeof connections>[0],
  userId: string,
  input: { id: string; tool: string; args: Record<string, unknown> },
) {
  try {
    const result = await connections(ctx).callTool(userId, input.id, input.tool, input.args);
    await audit(ctx.db, { userId, action: "mcp-client:call", target: input.id, outcome: result.isError ? "error" : "ok", details: { tool: input.tool } });
    return result;
  } catch (error) {
    await audit(ctx.db, { userId, action: "mcp-client:call", target: input.id, outcome: "error", details: { tool: input.tool } });
    throw error;
  }
}

async function audited<T>(ctx: { db: Parameters<typeof audit>[0]; session: { user: { id: string } } }, action: string, target: string | null, work: () => Promise<T>): Promise<T> {
  try {
    const result = await work();
    const outcome = typeof result === "object" && result !== null && "status" in result && result.status === "error" ? "error" : "ok";
    await audit(ctx.db, { userId: ctx.session.user.id, action, target, outcome });
    return result;
  } catch (error) {
    await audit(ctx.db, { userId: ctx.session.user.id, action, target, outcome: "error" });
    throw error;
  }
}
