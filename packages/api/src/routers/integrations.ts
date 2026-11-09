import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "../index";
import { McpConnectionService } from "../services/mcp-connection-service";
import { extractProducts } from "../services/product-extract";
import { fetchImageAsDataUrl } from "../services/safe-fetch";
import { SCOPES, TokenService, audit, recentAudit, type Scope } from "../services/token-service";

const scope = z.enum(Object.keys(SCOPES) as [Scope, ...Scope[]]);
const connectionInput = z.object({
  name: z.string().min(1).max(80),
  url: z.string().min(1).max(2000),
  transport: z.enum(["streamable-http", "sse"]).default("streamable-http"),
  authType: z.enum(["none", "bearer", "header"]).default("none"),
  authHeader: z.string().max(64).optional(),
  secret: z.string().max(4000).optional(),
});

/** API tokens, audit log and external MCP connections for the signed-in user. */
export const integrationsRouter = router({
  tokens: router({
    list: protectedProcedure.query(({ ctx }) => new TokenService(ctx.db).list(ctx.session.user.id)),
    create: protectedProcedure
      .input(z.object({ name: z.string().min(1).max(80), scopes: z.array(scope).min(1), expiresInDays: z.number().int().min(1).max(365).optional() }))
      .mutation(async ({ ctx, input }) => {
        const r = await new TokenService(ctx.db).create(ctx.session.user.id, input);
        await audit(ctx.db, { userId: ctx.session.user.id, action: "token:create", target: r.id, outcome: "ok", details: { scopes: input.scopes } });
        return r;
      }),
    revoke: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
      await audit(ctx.db, { userId: ctx.session.user.id, action: "token:revoke", target: input.id, outcome: "ok" });
      return new TokenService(ctx.db).revoke(ctx.session.user.id, input.id);
    }),
  }),

  audit: protectedProcedure.query(({ ctx }) => recentAudit(ctx.db, ctx.session.user.id)),

  connections: router({
    list: protectedProcedure.query(({ ctx }) => connections(ctx).list(ctx.session.user.id)),
    create: protectedProcedure.input(connectionInput).mutation(({ ctx, input }) => connections(ctx).create(ctx.session.user.id, input)),
    update: protectedProcedure.input(connectionInput.extend({ id: z.string() })).mutation(({ ctx, input: { id, ...rest } }) => connections(ctx).update(ctx.session.user.id, id, rest)),
    remove: protectedProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => connections(ctx).remove(ctx.session.user.id, input.id)),
    check: protectedProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => connections(ctx).check(ctx.session.user.id, input.id)),

    /** Call a tool and turn its result into products for the import preview. */
    importProducts: protectedProcedure
      .input(z.object({ id: z.string(), tool: z.string().min(1).max(200), args: z.record(z.string(), z.unknown()).default({}) }))
      .mutation(async ({ ctx, input }) => {
        const result = await connections(ctx).callTool(ctx.session.user.id, input.id, input.tool, input.args);
        await audit(ctx.db, { userId: ctx.session.user.id, action: "mcp-client:call", target: input.id, outcome: result.isError ? "error" : "ok", details: { tool: input.tool } });
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
      const allowLocal = ctx.allowLocalUrls ?? false;
      const results = await Promise.all(input.urls.map(async (url) => {
        try {
          return { url, dataUrl: await fetchImageAsDataUrl(url, { allowLocal }) };
        } catch (e) {
          return { url, error: (e as Error).message };
        }
      }));
      return results;
    }),
});

function connections(ctx: { db: Parameters<typeof audit>[0]; secretBox?: import("../services/secret-box").SecretBox; allowLocalUrls?: boolean }) {
  if (!ctx.secretBox) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Connections aren't configured on this server" });
  return new McpConnectionService(ctx.db, ctx.secretBox, { allowLocal: ctx.allowLocalUrls ?? false });
}
