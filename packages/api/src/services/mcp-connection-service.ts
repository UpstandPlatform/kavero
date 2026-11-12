import { randomUUID } from "node:crypto";

import type { Database } from "@Kavero/db";
import { mcpConnection } from "@Kavero/db/schema/integration";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";

import { assertPublicUrl, limitResponseBody, safeFetch } from "./safe-fetch";
import type { SecretBox } from "./secret-box";

export interface ConnectionInput {
  name: string;
  url: string;
  transport: "streamable-http" | "sse";
  authType: "none" | "bearer" | "header";
  authHeader?: string;
  /** Token or header value. Omit on update to keep the stored one. */
  secret?: string;
}

export interface ToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
}

const CALL_TIMEOUT_MS = 30_000;
const MAX_RESULT_CHARS = 2_000_000;
/** Bytes a remote MCP server may send in one HTTP response (or SSE stream) before it is cut off. */
export const MAX_MCP_RESPONSE_BYTES = 6 * 1024 * 1024;
export const MCP_TOOL_LIMITS = {
  maxTools: 200,
  maxResources: 200,
  maxNameChars: 200,
  maxTitleChars: 200,
  maxDescriptionChars: 2_000,
  maxSchemaChars: 32_000,
  /** The whole stored tool/resource list. */
  maxTotalChars: 512_000,
} as const;

const clip = (value: unknown, max: number) => (typeof value === "string" && value ? value.slice(0, max) : undefined);

/**
 * Bound what a (possibly malicious) server can make us store and later send to every browser:
 * tool count, text lengths and input schema size. Oversized schemas are dropped, not truncated.
 */
export function sanitizeToolList(tools: readonly unknown[]): ToolInfo[] {
  const result: ToolInfo[] = [];
  let total = 0;
  const seen = new Set<string>();
  for (const raw of tools.slice(0, MCP_TOOL_LIMITS.maxTools * 2)) {
    if (result.length >= MCP_TOOL_LIMITS.maxTools) break;
    if (!raw || typeof raw !== "object") continue;
    const tool = raw as Record<string, unknown>;
    if (typeof tool.name !== "string" || !tool.name || tool.name.length > MCP_TOOL_LIMITS.maxNameChars || seen.has(tool.name)) continue;
    let inputSchema: unknown;
    try {
      const json = tool.inputSchema === undefined ? undefined : JSON.stringify(tool.inputSchema);
      inputSchema = json !== undefined && json.length <= MCP_TOOL_LIMITS.maxSchemaChars ? JSON.parse(json) : undefined;
    } catch {
      inputSchema = undefined;
    }
    const info: ToolInfo = { name: tool.name, title: clip(tool.title, MCP_TOOL_LIMITS.maxTitleChars), description: clip(tool.description, MCP_TOOL_LIMITS.maxDescriptionChars), inputSchema };
    const size = JSON.stringify(info).length;
    if (total + size > MCP_TOOL_LIMITS.maxTotalChars) break;
    total += size;
    seen.add(tool.name);
    result.push(info);
  }
  return result;
}

export function sanitizeResourceList(resources: readonly unknown[]): { uri: string; name?: string }[] {
  return resources.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const resource = raw as Record<string, unknown>;
    if (typeof resource.uri !== "string" || !resource.uri || resource.uri.length > 2_000) return [];
    return [{ uri: resource.uri, name: clip(resource.name, MCP_TOOL_LIMITS.maxNameChars) }];
  }).slice(0, MCP_TOOL_LIMITS.maxResources);
}

/**
 * Connections to external MCP servers (remote: Streamable HTTP or SSE).
 * Credentials are encrypted at rest and only used server-side.
 * Local stdio servers need a desktop companion and aren't supported here.
 */
export class McpConnectionService {
  constructor(private readonly db: Database, private readonly box: SecretBox, private readonly opts: { allowLocal: boolean }) {}

  async list(userId: string) {
    const rows = await this.db.select().from(mcpConnection).where(eq(mcpConnection.userId, userId)).orderBy(desc(mcpConnection.createdAt));
    return rows.map(({ encryptedSecret, ...r }) => ({ ...r, hasSecret: !!encryptedSecret, tools: sanitizeToolList((r.capabilities as { tools?: unknown[] } | null)?.tools ?? []) }));
  }

  private async owned(userId: string, id: string) {
    const [row] = await this.db.select().from(mcpConnection).where(and(eq(mcpConnection.id, id), eq(mcpConnection.userId, userId))).limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Connection not found" });
    return row;
  }

  private validate(input: ConnectionInput) {
    if (input.authType === "header" && !/^[A-Za-z0-9-]{1,64}$/.test(input.authHeader ?? "")) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a valid header name, e.g. X-API-Key" });
    }
    if (input.authType === "header" && /^(host|cookie|content-length|transfer-encoding|connection)$/i.test(input.authHeader ?? "")) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "That header can't be used for authentication" });
    }
  }

  async create(userId: string, input: ConnectionInput) {
    this.validate(input);
    await assertPublicUrl(input.url, this.opts).catch((e: Error) => { throw new TRPCError({ code: "BAD_REQUEST", message: e.message }); });
    const id = randomUUID();
    await this.db.insert(mcpConnection).values({
      id, userId, name: input.name.trim().slice(0, 80) || "MCP server", url: input.url.trim(), transport: input.transport,
      authType: input.authType, authHeader: input.authType === "header" ? input.authHeader : null,
      encryptedSecret: input.authType !== "none" && input.secret ? this.box.seal(input.secret) : null,
    });
    return this.check(userId, id);
  }

  async update(userId: string, id: string, input: ConnectionInput) {
    const row = await this.owned(userId, id);
    this.validate(input);
    await assertPublicUrl(input.url, this.opts).catch((e: Error) => { throw new TRPCError({ code: "BAD_REQUEST", message: e.message }); });
    await this.db.update(mcpConnection).set({
      name: input.name.trim().slice(0, 80) || row.name, url: input.url.trim(), transport: input.transport,
      authType: input.authType, authHeader: input.authType === "header" ? input.authHeader : null,
      encryptedSecret: input.authType === "none" ? null : input.secret ? this.box.seal(input.secret) : row.encryptedSecret,
    }).where(eq(mcpConnection.id, id));
    return this.check(userId, id);
  }

  async remove(userId: string, id: string) {
    await this.owned(userId, id);
    await this.db.delete(mcpConnection).where(eq(mcpConnection.id, id));
    return { ok: true };
  }

  private async connect(row: typeof mcpConnection.$inferSelect, signal: AbortSignal) {
    const url = await assertPublicUrl(row.url, this.opts);
    const headers: Record<string, string> = {};
    if (row.encryptedSecret) {
      const secret = this.box.open(row.encryptedSecret);
      if (row.authType === "bearer") headers.Authorization = `Bearer ${secret}`;
      if (row.authType === "header" && row.authHeader) headers[row.authHeader] = secret;
    }
    const client = new Client({ name: "kavero", version: "0.1.0" });
    // Every request (including SSE endpoints the server announces) re-checks the address at connect time,
    // is aborted with the operation, and is cut off once the server sends more than the byte limit.
    const fetch = async (u: string | URL, init?: RequestInit) => {
      const requestSignal = init?.signal ? AbortSignal.any([init.signal, signal]) : signal;
      const response = await safeFetch(u, { ...init, signal: requestSignal }, this.opts);
      return limitResponseBody(response, MAX_MCP_RESPONSE_BYTES, "The connected server sent too much data");
    };
    const transport = row.transport === "sse"
      ? new SSEClientTransport(url, { requestInit: { headers }, fetch })
      : new StreamableHTTPClientTransport(url, { requestInit: { headers }, fetch });
    await client.connect(transport, { signal, timeout: CALL_TIMEOUT_MS });
    return client;
  }

  /** Connect, list tools/resources, and store the result as the connection status. */
  async check(userId: string, id: string) {
    const row = await this.owned(userId, id);
    let client: Client | null = null;
    const signal = AbortSignal.timeout(CALL_TIMEOUT_MS * 2);
    try {
      client = await this.connect(row, signal);
      const tools = sanitizeToolList((await client.listTools(undefined, { signal, timeout: CALL_TIMEOUT_MS })).tools);
      const resources = client.getServerCapabilities()?.resources
        ? sanitizeResourceList((await client.listResources(undefined, { signal, timeout: CALL_TIMEOUT_MS }).catch(() => ({ resources: [] }))).resources)
        : [];
      await this.db.update(mcpConnection).set({ status: "ok", lastError: null, capabilities: { tools, resources, server: client.getServerVersion() }, lastCheckedAt: new Date() }).where(eq(mcpConnection.id, id));
      return { id, status: "ok" as const, tools, resources };
    } catch (e) {
      const message = this.scrubConnectionError((e as Error).message, row);
      await this.db.update(mcpConnection).set({ status: "error", lastError: message, lastCheckedAt: new Date() }).where(eq(mcpConnection.id, id));
      return { id, status: "error" as const, error: message, tools: [] as ToolInfo[], resources: [] };
    } finally {
      await client?.close().catch(() => undefined);
    }
  }

  /** Call a tool on the user's connected server and return its content. */
  async callTool(userId: string, id: string, name: string, args: Record<string, unknown>) {
    const row = await this.owned(userId, id);
    const listedTools = (row.capabilities as { tools?: ToolInfo[] } | null)?.tools ?? [];
    if (!listedTools.some((tool) => tool.name === name)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a tool listed by this connection. Refresh the connection if its tool list is out of date." });
    }
    validateToolArguments(args);
    let client: Client | null = null;
    const signal = AbortSignal.timeout(CALL_TIMEOUT_MS * 2);
    try {
      client = await this.connect(row, signal);
      const result = await client.callTool({ name, arguments: args }, undefined, { signal, timeout: CALL_TIMEOUT_MS });
      if (JSON.stringify(result).length > MAX_RESULT_CHARS) throw new Error("The tool returned too much data; narrow the request");
      await this.db.update(mcpConnection).set({ lastSyncAt: new Date(), status: "ok", lastError: null }).where(eq(mcpConnection.id, id));
      return result as { content?: { type: string; text?: string }[]; structuredContent?: unknown; isError?: boolean };
    } catch (e) {
      throw new TRPCError({ code: "BAD_REQUEST", message: this.scrubConnectionError((e as Error).message, row) });
    } finally {
      await client?.close().catch(() => undefined);
    }
  }

  private scrubConnectionError(message: string, row: { encryptedSecret: string | null }) {
    if (row.encryptedSecret) {
      try {
        const secret = this.box.open(row.encryptedSecret);
        if (secret) message = message.replaceAll(secret, "***");
      } catch {
        // An unreadable stored secret must not prevent returning the scrubbed error.
      }
    }
    return scrub(message, row);
  }
}

/** Keep user-controlled tool calls bounded and JSON-only before they reach remote services. */
function validateToolArguments(args: Record<string, unknown>) {
  if (!args || typeof args !== "object" || Array.isArray(args) || (Object.getPrototypeOf(args) !== Object.prototype && Object.getPrototypeOf(args) !== null)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Tool arguments must be a JSON object." });
  }
  const stack: Array<{ value: unknown; depth: number }> = [{ value: args, depth: 0 }];
  const seen = new WeakSet<object>();
  let nodes = 0;
  let size = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (++nodes > 10_000 || depth > 24) throw new TRPCError({ code: "BAD_REQUEST", message: "Tool arguments are too large or deeply nested." });
    if (value === null || typeof value === "boolean") continue;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new TRPCError({ code: "BAD_REQUEST", message: "Tool arguments must contain finite numbers." });
      continue;
    }
    if (typeof value === "string") {
      size += value.length;
      continue;
    }
    if (typeof value !== "object") throw new TRPCError({ code: "BAD_REQUEST", message: "Tool arguments must contain JSON values only." });
    if (seen.has(value)) throw new TRPCError({ code: "BAD_REQUEST", message: "Tool arguments cannot contain cycles." });
    seen.add(value);
    if (Array.isArray(value)) {
      if (value.length > 2_000) throw new TRPCError({ code: "BAD_REQUEST", message: "Tool arguments contain too many items." });
      for (const item of value) stack.push({ value: item, depth: depth + 1 });
      continue;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TRPCError({ code: "BAD_REQUEST", message: "Tool arguments must be plain JSON objects." });
    const keys = Reflect.ownKeys(value);
    if (keys.length > 2_000 || keys.some((key) => typeof key !== "string" || ["__proto__", "prototype", "constructor"].includes(key))) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Tool arguments contain too many or reserved fields." });
    }
    for (const key of keys as string[]) {
      size += key.length;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) throw new TRPCError({ code: "BAD_REQUEST", message: "Tool arguments must be plain JSON objects." });
      stack.push({ value: descriptor.value, depth: depth + 1 });
    }
  }
  if (size > 64_000) throw new TRPCError({ code: "BAD_REQUEST", message: "Tool arguments exceed the 64 KB limit." });
}

/** Never echo credentials back in error messages. */
function scrub(message: string, row: { encryptedSecret: string | null }) {
  return row.encryptedSecret ? message.replace(/Bearer\s+\S+/gi, "Bearer ***") : message;
}
