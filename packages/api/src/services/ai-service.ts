import { randomUUID } from "node:crypto";

import { AiError, generateCatalog, proposeEdit, type GenerateInput, type LlmProvider } from "@Kavero/ai";
import { parseCatalogDocument } from "@Kavero/catalog-engine";
import type { Database } from "@Kavero/db";
import { aiJob } from "@Kavero/db/schema/integration";
import { createResilientRateLimiter } from "@Kavero/redis";
import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";

const PER_MINUTE = 6;
const aiRateLimiter = createResilientRateLimiter({ namespace: "ai", maxRequests: PER_MINUTE, windowMs: 60_000 });

async function rateLimit(userId: string) {
  const decision = await aiRateLimiter.limit(userId);
  if (!decision.allowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many AI requests. Wait a minute and try again." });
}

function toTrpc(e: unknown): never {
  if (e instanceof TRPCError) throw e;
  if (e instanceof AiError) {
    const code = e.code === "rate_limited" ? "TOO_MANY_REQUESTS" : e.code === "not_configured" ? "PRECONDITION_FAILED" : e.code === "bad_request" || e.code === "refused" ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR";
    throw new TRPCError({ code, message: e.message });
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (e as Error).message });
}

/** Server-side AI: the provider's key never reaches the browser; every call is logged. */
export class AiService {
  constructor(private readonly db: Database, private readonly provider: LlmProvider | null) {}

  status() {
    return { configured: !!this.provider, provider: this.provider?.id ?? null, model: this.provider?.model ?? null };
  }

  private async log(userId: string, entry: Omit<typeof aiJob.$inferInsert, "id" | "userId">) {
    await this.db.insert(aiJob).values({ id: randomUUID(), userId, ...entry }).catch(() => undefined);
  }

  async generate(userId: string, input: GenerateInput) {
    await rateLimit(userId);
    const started = Date.now();
    try {
      const r = await generateCatalog(this.provider, input, AbortSignal.timeout(240_000));
      await this.log(userId, {
        kind: "generate", prompt: input.brief.slice(0, 4000), status: "ok", source: r.source, model: r.model ?? null,
        inputTokens: r.usage?.inputTokens ?? null, outputTokens: r.usage?.outputTokens ?? null,
        summary: `${r.document.slides.length} slides, ${input.products.length} products, template ${r.plan.templateId}`, durationMs: Date.now() - started,
      });
      return r;
    } catch (e) {
      await this.log(userId, { kind: "generate", prompt: input.brief.slice(0, 4000), status: "error", error: (e as Error).message.slice(0, 500), durationMs: Date.now() - started });
      toTrpc(e);
    }
  }

  async edit(userId: string, document: unknown, slideId: string, instruction: string) {
    await rateLimit(userId);
    const parsed = parseCatalogDocument(document);
    if (!parsed.ok) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid catalog" });
    const started = Date.now();
    try {
      const r = await proposeEdit(this.provider, parsed.document, slideId, instruction, AbortSignal.timeout(120_000));
      await this.log(userId, { kind: "edit", prompt: instruction.slice(0, 4000), status: "ok", source: "ai", model: r.model, summary: r.summary, durationMs: Date.now() - started });
      return r;
    } catch (e) {
      await this.log(userId, { kind: "edit", prompt: instruction.slice(0, 4000), status: "error", error: (e as Error).message.slice(0, 500), durationMs: Date.now() - started });
      toTrpc(e);
    }
  }

  async history(userId: string) {
    return this.db
      .select({ id: aiJob.id, kind: aiJob.kind, prompt: aiJob.prompt, status: aiJob.status, source: aiJob.source, model: aiJob.model, summary: aiJob.summary, error: aiJob.error, createdAt: aiJob.createdAt })
      .from(aiJob)
      .where(eq(aiJob.userId, userId))
      .orderBy(desc(aiJob.createdAt))
      .limit(50);
  }
}
