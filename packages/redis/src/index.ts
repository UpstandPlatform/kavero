import { createHash } from "node:crypto";

import {
  createCache as createMhbCache,
  createRateLimiter as createMhbRateLimiter,
  createRedisClient,
  fixedWindow,
  isRedisErrorCode,
  type RedisClient,
} from "@mhbdev/redis";

const DEFAULT_MAX_FALLBACK_ENTRIES = 50_000;
const OPERATIONAL_REDIS_ERRORS = [
  "REDIS_CONFIGURATION_ERROR",
  "REDIS_CONNECTION_ERROR",
  "REDIS_TIMEOUT",
  "REDIS_ABORTED",
  "REDIS_UNAVAILABLE",
  "REDIS_CLIENT_STATE",
] as const;

type CacheEntry = { value: unknown; expiresAt: number };
type LocalLimitEntry = { count: number; resetAt: number };
type RedisRuntime = {
  url: string;
  client: RedisClient | null;
  cacheFallback: Map<string, CacheEntry>;
  rateFallback: Map<string, LocalLimitEntry>;
  lastWarningAt: Map<string, number>;
  lastFallbackCleanupAt: number;
};

const runtimeGlobal = globalThis as typeof globalThis & { __kaveroRedisRuntime?: RedisRuntime };

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function validNamespace(namespace: string) {
  if (!/^[a-zA-Z0-9:_-]{1,100}$/.test(namespace)) throw new Error("Redis namespace must use letters, numbers, colon, underscore or dash.");
  return namespace;
}

function runtime(redisUrl?: string): RedisRuntime | null {
  const url = (redisUrl ?? process.env.REDIS_URL)?.trim() ?? "";
  if (runtimeGlobal.__kaveroRedisRuntime?.url === url) return runtimeGlobal.__kaveroRedisRuntime;
  let client: RedisClient | null = null;
  let clientError: unknown;
  if (url) {
    try {
      client = createRedisClient({
        url,
        connectTimeoutMs: 800,
        commandTimeoutMs: 1_000,
        maxReconnectAttempts: 1,
        reconnectBaseDelayMs: 100,
        reconnectMaxDelayMs: 250,
        disableOfflineQueue: true,
        onError: () => undefined,
      });
    } catch (error) {
      clientError = error;
    }
  }
  runtimeGlobal.__kaveroRedisRuntime = {
    url,
    client,
    cacheFallback: new Map(),
    rateFallback: new Map(),
    lastWarningAt: new Map(),
    lastFallbackCleanupAt: 0,
  };
  if (clientError) warnFallback(runtimeGlobal.__kaveroRedisRuntime, "client", clientError);
  return runtimeGlobal.__kaveroRedisRuntime;
}

function operationalRedisFailure(error: unknown) {
  if (OPERATIONAL_REDIS_ERRORS.some((code) => isRedisErrorCode(error, code))) return true;
  // Redis reports capacity pressure as an error reply (wrapped by mhbdev as a
  // protocol error). Treat transient server pressure like an outage so bounded
  // local fallbacks remain available, while surfacing command/schema mistakes.
  if (!isRedisErrorCode(error, "REDIS_PROTOCOL_ERROR")) return false;
  const cause = error.cause;
  const message = cause instanceof Error ? cause.message : "";
  return /^(?:OOM|BUSY|LOADING|TRYAGAIN|CLUSTERDOWN|MASTERDOWN|READONLY)\b/i.test(message.trim());
}

function warnFallback(rt: RedisRuntime | null, namespace: string, error?: unknown) {
  if (!rt?.url) return;
  const now = Date.now();
  if (now - (rt.lastWarningAt.get(namespace) ?? 0) < 60_000) return;
  rt.lastWarningAt.set(namespace, now);
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unavailable";
  console.warn("[redis] " + namespace + " is using process-local fallback (" + code + ").");
}

function setBounded<K, V>(map: Map<K, V>, key: K, value: V, maxEntries = DEFAULT_MAX_FALLBACK_ENTRIES) {
  if (map.has(key)) map.delete(key);
  while (map.size >= maxEntries) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
  map.set(key, value);
}

function cleanupCacheFallback(rt: RedisRuntime, now: number) {
  if (now - rt.lastFallbackCleanupAt < 30_000) return;
  rt.lastFallbackCleanupAt = now;
  for (const [key, entry] of rt.cacheFallback) if (entry.expiresAt <= now) rt.cacheFallback.delete(key);
  for (const [key, entry] of rt.rateFallback) if (entry.resetAt <= now) rt.rateFallback.delete(key);
}

export type RedisCacheStore<T> = {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
};

/** Typed TTL cache backed by @mhbdev/redis, with a bounded expiring process-local fallback. */
export function createCacheStore<T>(namespace: string, options: { defaultTtlMs?: number; maxEntries?: number; redisUrl?: string } = {}): RedisCacheStore<T> {
  const name = validNamespace(namespace);
  const prefix = "kavero:v1:cache:" + name;
  const ttl = options.defaultTtlMs ?? 5 * 60_000;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_FALLBACK_ENTRIES;
  const rt = runtime(options.redisUrl);
  const cache = rt?.client ? createMhbCache<T>({ redis: rt.client, prefix }) : null;
  const localKey = (key: string) => name + ":" + hash(key);

  return {
    async get(key) {
      const fallbackKey = localKey(key);
      const now = Date.now();
      if (rt?.client && cache) {
        try {
          const value = await cache.get(hash(key));
          if (value !== undefined) {
            rt.cacheFallback.delete(fallbackKey);
            return value;
          }
          cleanupCacheFallback(rt, now);
          const local = rt.cacheFallback.get(fallbackKey);
          if (!local) return undefined;
          try {
            await cache.set(hash(key), local.value as T, { ttlMs: Math.max(1, Math.min(ttl, local.expiresAt - now)) });
            rt.cacheFallback.delete(fallbackKey);
          } catch (error) {
            if (!operationalRedisFailure(error)) throw error;
            warnFallback(rt, name, error);
          }
          return local.value as T;
        } catch (error) {
          if (!operationalRedisFailure(error)) throw error;
          warnFallback(rt, name, error);
        }
      }
      if (rt) cleanupCacheFallback(rt, now);
      const local = rt?.cacheFallback.get(fallbackKey);
      if (local && local.expiresAt <= now) {
        rt?.cacheFallback.delete(fallbackKey);
        return undefined;
      }
      return local?.value as T | undefined;
    },
    async set(key, value, ttlMs = ttl) {
      const fallbackKey = localKey(key);
      if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error("Cache TTL must be a positive integer.");
      if (rt?.client && cache) {
        try {
          await cache.set(hash(key), value, { ttlMs });
          rt.cacheFallback.delete(fallbackKey);
          return;
        } catch (error) {
          if (!operationalRedisFailure(error)) throw error;
          warnFallback(rt, name, error);
        }
      }
      if (rt) setBounded(rt.cacheFallback, fallbackKey, { value, expiresAt: Date.now() + ttlMs }, maxEntries);
    },
    async delete(key) {
      const fallbackKey = localKey(key);
      if (rt && cache) {
        try {
          await cache.delete(hash(key));
        } catch (error) {
          if (!operationalRedisFailure(error)) throw error;
          warnFallback(rt, name, error);
        }
      }
      rt?.cacheFallback.delete(fallbackKey);
    },
  };
}

export type RateLimitDecision = { allowed: boolean; limit: number; remaining: number; resetAt: Date };
export type ResilientRateLimiter = {
  limit(identifier: string, weight?: number): Promise<RateLimitDecision>;
  getRemaining(identifier: string): Promise<{ remaining: number; resetAt: Date }>;
};

/** Atomic Redis fixed-window limiter with a bounded process-local fixed-window fallback. */
export function createResilientRateLimiter(options: {
  namespace: string;
  maxRequests: number;
  windowMs: number;
  maxFallbackEntries?: number;
  redisUrl?: string;
}): ResilientRateLimiter {
  const name = validNamespace(options.namespace);
  if (!Number.isSafeInteger(options.maxRequests) || options.maxRequests < 1) throw new Error("Rate-limit maxRequests must be a positive integer.");
  if (!Number.isSafeInteger(options.windowMs) || options.windowMs < 1) throw new Error("Rate-limit windowMs must be a positive integer.");
  const rt = runtime(options.redisUrl);
  const limiter = rt?.client ? createMhbRateLimiter(fixedWindow(options.maxRequests, options.windowMs), {
    redis: rt.client,
    prefix: "kavero:v1:rate:" + name,
    timeoutMs: 1_200,
    ephemeralCache: false,
    // "open" lets this adapter identify operational failures and apply its bounded local fallback.
    failureMode: "open",
  }) : null;
  const fallbackKey = (identifier: string) => name + ":" + hash(identifier);
  const maxFallbackEntries = options.maxFallbackEntries ?? DEFAULT_MAX_FALLBACK_ENTRIES;

  function localLimit(identifier: string, weight: number): RateLimitDecision {
    const now = Date.now();
    const key = fallbackKey(identifier);
    let entry = rt?.rateFallback.get(key);
    if (!entry || entry.resetAt <= now) {
      const resetAt = Math.floor(now / options.windowMs) * options.windowMs + options.windowMs;
      entry = { count: 0, resetAt };
    }
    entry.count += weight;
    if (rt) setBounded(rt.rateFallback, key, entry, maxFallbackEntries);
    return { allowed: entry.count <= options.maxRequests, limit: options.maxRequests, remaining: Math.max(0, options.maxRequests - entry.count), resetAt: new Date(entry.resetAt) };
  }

  async function redisLimit(identifier: string, weight: number): Promise<RateLimitDecision | null> {
    if (!limiter || !rt) return null;
    try {
      const pending = rt.rateFallback.get(fallbackKey(identifier));
      if (pending && pending.resetAt > Date.now()) {
        // Carry requests accumulated during an outage into Redis before serving the current request.
        const recovered = await limiter.limit(identifier, { rate: pending.count + weight });
        if (recovered.reason === "redis" || recovered.reason === "timeout") return null;
        rt.rateFallback.delete(fallbackKey(identifier));
        return { allowed: recovered.allowed, limit: recovered.limit, remaining: recovered.remaining, resetAt: recovered.resetAt };
      }
      if (pending) rt.rateFallback.delete(fallbackKey(identifier));
      const result = await limiter.limit(identifier, { rate: weight });
      if (result.reason === "redis" || result.reason === "timeout") {
        warnFallback(rt, name);
        return null;
      }
      return { allowed: result.allowed, limit: result.limit, remaining: result.remaining, resetAt: result.resetAt };
    } catch (error) {
      if (!operationalRedisFailure(error)) throw error;
      warnFallback(rt, name, error);
      return null;
    }
  }

  return {
    async limit(identifier, weight = 1) {
      if (!Number.isSafeInteger(weight) || weight < 1 || weight > options.maxRequests) throw new Error("Rate-limit weight must be a positive integer no greater than maxRequests.");
      const result = await redisLimit(identifier, weight);
      return result ?? localLimit(identifier, weight);
    },
    async getRemaining(identifier) {
      const key = fallbackKey(identifier);
      const pending = rt?.rateFallback.get(key);
      if (pending && pending.resetAt > Date.now()) {
        return { remaining: Math.max(0, options.maxRequests - pending.count), resetAt: new Date(pending.resetAt) };
      }
      if (pending) rt?.rateFallback.delete(key);
      if (limiter && rt) {
        try {
          const result = await limiter.getRemaining(identifier);
          return { remaining: result.remaining, resetAt: result.resetAt };
        } catch (error) {
          if (!operationalRedisFailure(error)) throw error;
          warnFallback(rt, name, error);
        }
      }
      const now = Date.now();
      const resetAt = new Date(Math.floor(now / options.windowMs) * options.windowMs + options.windowMs);
      return { remaining: options.maxRequests, resetAt };
    },
  };
}

/** Better Auth secondary storage mirrored in Redis and backed by bounded local memory during outages. */
export function createBetterAuthSecondaryStorage(namespace = "better-auth", redisUrl?: string) {
  const name = validNamespace(namespace);
  const rt = runtime(redisUrl);
  const prefix = "kavero:v1:auth:" + name;
  const cache = rt?.client ? createMhbCache<string>({ redis: rt.client, prefix }) : null;
  const storageKey = (key: string) => hash(key);
  const fullKey = (key: string) => prefix + ":" + storageKey(key);
  const localKey = (key: string) => "auth:" + name + ":" + storageKey(key);

  async function localGet(key: string) {
    if (!rt) return undefined;
    const now = Date.now();
    cleanupCacheFallback(rt, now);
    const entry = rt.cacheFallback.get(localKey(key));
    if (entry && entry.expiresAt <= now) {
      rt.cacheFallback.delete(localKey(key));
      return undefined;
    }
    return entry?.value as string | undefined;
  }

  function remember(key: string, value: string, ttlSeconds?: number) {
    if (!rt) return;
    const ttlMs = Math.max(1_000, (ttlSeconds ?? 60 * 60 * 24 * 30) * 1_000);
    setBounded(rt.cacheFallback, localKey(key), { value, expiresAt: Date.now() + ttlMs });
  }

  return {
    async get(key: string) {
      if (rt && cache) {
        try {
          const value = await cache.get(storageKey(key));
          if (value !== undefined) {
            rt.cacheFallback.delete(localKey(key));
            return value;
          }
        } catch (error) {
          if (!operationalRedisFailure(error)) throw error;
          warnFallback(rt, name, error);
        }
      }
      return localGet(key);
    },
    async getAndDelete(key: string) {
      if (rt?.client && cache) {
        try {
          // The Lua read/delete keeps one-time reads atomic on Redis 5+ as well.
          const raw = await rt.client.eval<string | null>(
            "local value = redis.call('GET', KEYS[1]); if value then redis.call('DEL', KEYS[1]); end; return value",
            { keys: [fullKey(key)], arguments: [] },
          );
          if (raw !== null) {
            rt.cacheFallback.delete(localKey(key));
            return JSON.parse(raw) as string;
          }
          // A value written while Redis was unavailable may still exist only in
          // this process. A Redis miss must not discard that one-time value.
          const fallback = await localGet(key);
          rt.cacheFallback.delete(localKey(key));
          return fallback;
        } catch (error) {
          if (!operationalRedisFailure(error)) throw error;
          warnFallback(rt, name, error);
        }
      }
      const value = await localGet(key);
      rt?.cacheFallback.delete(localKey(key));
      return value;
    },
    async increment(key: string, ttlSeconds: number) {
      if (rt?.client && cache) {
        try {
          const pending = Number(await localGet(key) ?? 0);
          const incrementBy = Number.isSafeInteger(pending) && pending > 0 ? pending + 1 : 1;
          const result = await rt.client.eval(
            "local value = redis.call('INCRBY', KEYS[1], ARGV[1]); if redis.call('PTTL', KEYS[1]) < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[2]); end; return value",
            { keys: [fullKey(key)], arguments: [String(incrementBy), String(Math.max(1_000, Math.ceil(ttlSeconds * 1_000)))] },
          );
          rt.cacheFallback.delete(localKey(key));
          return Number(result);
        } catch (error) {
          if (!operationalRedisFailure(error)) throw error;
          warnFallback(rt, name, error);
        }
      }
      const local = await localGet(key);
      const count = Number(local ?? 0) + 1;
      remember(key, String(count), ttlSeconds);
      return count;
    },
    async set(key: string, value: unknown, ttlSeconds?: number) {
      const stringValue = typeof value === "string" ? value : JSON.stringify(value);
      if (rt && cache) {
        try {
          await cache.set(storageKey(key), stringValue, ttlSeconds ? { ttlMs: ttlSeconds * 1_000 } : {});
          rt.cacheFallback.delete(localKey(key));
          return;
        } catch (error) {
          if (!operationalRedisFailure(error)) throw error;
          warnFallback(rt, name, error);
        }
      }
      remember(key, stringValue, ttlSeconds);
    },
    async delete(key: string) {
      if (rt && cache) {
        try {
          await cache.delete(storageKey(key));
        } catch (error) {
          if (!operationalRedisFailure(error)) throw error;
          warnFallback(rt, name, error);
        }
      }
      rt?.cacheFallback.delete(localKey(key));
    },
  };
}

/** Better Auth custom rate-limit storage backed by the shared Redis limiter. */
export function createBetterAuthRateLimitStorage(namespace = "better-auth", redisUrl?: string) {
  const limiters = new Map<string, ResilientRateLimiter>();
  return {
    async consume(key: string, rule: { window: number; max: number }) {
      const windowSeconds = Math.max(1, Math.ceil(rule.window));
      const limiterKey = windowSeconds + ":" + rule.max;
      let limiter = limiters.get(limiterKey);
      if (!limiter) {
        limiter = createResilientRateLimiter({
          namespace: namespace + ":" + windowSeconds + "-" + rule.max,
          maxRequests: rule.max,
          windowMs: windowSeconds * 1_000,
          redisUrl,
        });
        limiters.set(limiterKey, limiter);
      }
      const result = await limiter.limit(key);
      return { allowed: result.allowed, retryAfter: result.allowed ? null : Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1_000)) };
    },
  };
}
