import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { adminProcedure, publicProcedure, router } from "../index";
import type { Context } from "../context";
import { SETTINGS } from "../platform/settings";
import { audit } from "../services/audit-service";

function requireConfig(ctx: Context) {
  if (!ctx.config) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Runtime settings aren't available on this server" });
  return ctx.config;
}

const sectionId = z.enum(SETTINGS.map((s) => s.id) as [string, ...string[]]);
const value = z.union([z.string().max(4000), z.number(), z.boolean(), z.null()]);

/** Edition info for every client, and Admin → System settings for admins. */
export const systemRouter = router({
  /** What this deployment is and which optional features it has. Safe to show to anyone. */
  info: publicProcedure.query(async ({ ctx }) => {
    const media = ctx.config ? await ctx.config.values("media") : null;
    return {
      edition: ctx.platform?.edition ?? "self-hosted",
      features: ctx.platform?.features ?? null,
      modules: ctx.platform?.moduleIds ?? [],
      media: {
        openverseEnabled: media?.openverseEnabled === true,
        // GIPHY keys are public by design (used from the browser).
        giphyApiKey: typeof media?.giphyApiKey === "string" ? media.giphyApiKey : "",
      },
    };
  }),

  /** The signed-in user's plan limits (unlimited outside the cloud edition). */
  entitlements: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.session || !ctx.platform) return null;
    return ctx.platform.entitlements.forUser(ctx.session.user.id);
  }),

  config: router({
    get: adminProcedure.query(async ({ ctx }) => {
      const config = requireConfig(ctx);
      return { edition: config.edition, sections: await config.describe() };
    }),
    update: adminProcedure
      .input(z.object({ section: sectionId, values: z.record(z.string().max(100), value) }))
      .mutation(async ({ ctx, input }) => {
        const config = requireConfig(ctx);
        const keys = Object.keys(input.values);
        try {
          const section = await config.update(input.section, input.values, ctx.session.user.id);
          // Field names only: never log values (they may be credentials).
          await audit(ctx.db, { userId: ctx.session.user.id, action: "admin:settings", target: input.section, outcome: "ok", details: { fields: keys } });
          return section;
        } catch (error) {
          await audit(ctx.db, { userId: ctx.session.user.id, action: "admin:settings", target: input.section, outcome: "error", details: { fields: keys } });
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Couldn't save the settings" });
        }
      }),
    testStorage: adminProcedure.mutation(async ({ ctx }) => {
      if (!ctx.testStorage) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Storage checks aren't available on this server" });
      return ctx.testStorage();
    }),
  }),
});
