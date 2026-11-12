"use client";

/**
 * Small, bounded browser-only chat state. Transcripts live on the account (chat needs sign-in),
 * so only UI decisions and "catalog already imported" markers are kept here, with eviction.
 */

export type ProposalDecision = "applied" | "dismissed";

const DECISIONS_PREFIX = "kavero:chat-decisions:";
const MAX_DECISION_THREADS = 40;
const MAX_DECISIONS_PER_THREAD = 240;
const IMPORTED_KEY = "kavero:chat-imported-catalogs";
const MAX_IMPORTED = 200;
/** Old versions cached whole transcripts under these keys (MBs each, never evicted). */
const LEGACY_TRANSCRIPT_PREFIX = "kavero:chat:";

type StoredDecisions = { t: number; v: Record<string, ProposalDecision> };

function parseDecisions(raw: string | null): StoredDecisions | null {
  try {
    const parsed: unknown = JSON.parse(raw ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    // Older format: a plain { toolCallId: decision } object.
    const record = parsed as Partial<StoredDecisions> & Record<string, unknown>;
    const values = record.v && typeof record.v === "object" ? record.v : record;
    const v = Object.fromEntries(Object.entries(values).filter((entry): entry is [string, ProposalDecision] => entry[1] === "applied" || entry[1] === "dismissed"));
    return { t: typeof record.t === "number" ? record.t : 0, v };
  } catch {
    return null;
  }
}

export function loadDecisions(conversationId: string | null): Record<string, ProposalDecision> {
  if (!conversationId) return {};
  try {
    return parseDecisions(localStorage.getItem(DECISIONS_PREFIX + conversationId))?.v ?? {};
  } catch {
    return {};
  }
}

/** Record one decision and evict the least recently used threads. Returns the thread's decisions. */
export function saveDecision(conversationId: string, toolCallId: string, decision: ProposalDecision): Record<string, ProposalDecision> {
  const current = loadDecisions(conversationId);
  const next = Object.fromEntries(Object.entries({ ...current, [toolCallId]: decision }).slice(-MAX_DECISIONS_PER_THREAD));
  try {
    localStorage.setItem(DECISIONS_PREFIX + conversationId, JSON.stringify({ t: Date.now(), v: next } satisfies StoredDecisions));
    const threads: { key: string; t: number }[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(DECISIONS_PREFIX)) threads.push({ key, t: parseDecisions(localStorage.getItem(key))?.t ?? 0 });
    }
    threads.sort((a, b) => b.t - a.t);
    for (const stale of threads.slice(MAX_DECISION_THREADS)) localStorage.removeItem(stale.key);
  } catch {
    // Chat remains usable when browser storage is unavailable.
  }
  return next;
}

export function forgetDecisions(conversationId: string) {
  try {
    localStorage.removeItem(DECISIONS_PREFIX + conversationId);
  } catch {
    // storage unavailable
  }
}

function importedCatalogIds(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(IMPORTED_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Whether a catalog created in chat was already saved into this browser once (it may since have been deleted). */
export function wasCatalogImported(id: string) {
  return importedCatalogIds().includes(id);
}

export function rememberCatalogImported(id: string) {
  const ids = [...importedCatalogIds().filter((item) => item !== id), id].slice(-MAX_IMPORTED);
  try {
    localStorage.setItem(IMPORTED_KEY, JSON.stringify(ids));
  } catch {
    // storage unavailable
  }
}

let legacyPurged = false;

/** Remove transcript caches written by older versions. */
export function purgeLegacyTranscriptCache() {
  if (legacyPurged) return;
  legacyPurged = true;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(LEGACY_TRANSCRIPT_PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // storage unavailable
  }
}
