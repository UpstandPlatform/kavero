import type { Database } from "@Kavero/db";
import { appSetting } from "@Kavero/db/schema/integration";
import { like } from "drizzle-orm";

import type { SecretBox } from "../services/secret-box";
import type { Edition } from "./edition";
import { SETTINGS, coerce, defaultValue, sectionDef, type FieldDef, type FieldType, type SettingValue } from "./settings";

/**
 * Central runtime configuration. Admin-edited settings live in `app_setting`
 * (one row per section, key `config:<section>`), with secret fields sealed by
 * SecretBox. Values resolve as: environment variable (locks the field) → admin
 * value → default. Reads are cached and refreshed every few seconds, so a change
 * made on one server instance reaches the others without a restart.
 */

const PREFIX = "config:";
type Sealed = { sealed: string };
type StoredSection = Record<string, SettingValue | Sealed>;
const isSealed = (v: unknown): v is Sealed => !!v && typeof v === "object" && typeof (v as Sealed).sealed === "string";

/** Where admin values are persisted. The default uses the database; tests use memory. */
export interface SettingsStore {
  loadAll(): Promise<Record<string, StoredSection>>;
  save(sectionId: string, value: StoredSection, userId: string | null): Promise<void>;
}

export function databaseSettingsStore(db: Database): SettingsStore {
  return {
    async loadAll() {
      const rows = await db.select({ key: appSetting.key, value: appSetting.value }).from(appSetting).where(like(appSetting.key, `${PREFIX}%`));
      const out: Record<string, StoredSection> = {};
      for (const r of rows) if (r.value && typeof r.value === "object") out[r.key.slice(PREFIX.length)] = r.value as StoredSection;
      return out;
    },
    async save(sectionId, value, userId) {
      await db
        .insert(appSetting)
        .values({ key: PREFIX + sectionId, value, updatedBy: userId })
        .onConflictDoUpdate({ target: appSetting.key, set: { value, updatedBy: userId } });
    },
  };
}

export type ValueSource = "env" | "admin" | "default";

export interface FieldView {
  key: string;
  label: string;
  description?: string;
  type: FieldType;
  options?: readonly { value: string; label: string }[];
  min?: number;
  max?: number;
  placeholder?: string;
  when?: { field: string; in: readonly (string | boolean)[] };
  env?: string;
  /** Current value; always null for secrets (see hasValue). */
  value: SettingValue;
  hasValue: boolean;
  source: ValueSource;
  /** Set by an environment variable, so it can't be changed here. */
  locked: boolean;
  /** A stored secret couldn't be decrypted (e.g. the encryption key changed). */
  unreadable?: boolean;
}

export interface SectionView {
  id: string;
  title: string;
  description: string;
  fields: FieldView[];
}

export type SectionValues = Record<string, SettingValue>;
type Listener = (changed: string[]) => void;

export class RuntimeConfig {
  private stored: Record<string, StoredSection> | null = null;
  private loadedAt = 0;
  private loading: Promise<void> | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly warned = new Set<string>();

  constructor(
    private readonly store: SettingsStore,
    private readonly box: SecretBox,
    readonly edition: Edition,
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly ttlMs = 10_000,
  ) {}

  /** Loads admin values if the cache is older than the TTL (or `force`). Never throws: on a database error the last values (or env/defaults) stay in use. */
  async refresh(force = false): Promise<void> {
    if (!force && this.stored && Date.now() - this.loadedAt < this.ttlMs) return;
    this.loading ??= (async () => {
      try {
        const next = await this.store.loadAll();
        const changed = this.diff(this.stored, next);
        const first = this.stored === null;
        this.stored = next;
        this.loadedAt = Date.now();
        if (changed.length && !first) this.emit(changed);
      } catch (error) {
        // Keep serving; a missing table before migrations, or a brief outage, shouldn't take the app down.
        this.loadedAt = Date.now();
        this.stored ??= {};
        console.warn("[kavero] couldn't load admin settings; using environment and defaults:", (error as Error).message);
      } finally {
        this.loading = null;
      }
    })();
    await this.loading;
  }

  /** Resolved values for a section (secrets decrypted). Refreshes when stale. */
  async values(sectionId: string): Promise<SectionValues> {
    await this.refresh();
    return this.valuesSync(sectionId);
  }

  /** Resolved values from the current cache, without touching the database. */
  valuesSync(sectionId: string): SectionValues {
    const def = sectionDef(sectionId);
    const out: SectionValues = {};
    for (const f of def.fields) out[f.key] = this.resolve(sectionId, f).value;
    return out;
  }

  /** Admin view of every section for this edition. Secrets are never returned. */
  async describe(): Promise<SectionView[]> {
    await this.refresh();
    return SETTINGS.filter((s) => !s.editions || s.editions.includes(this.edition)).map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      fields: s.fields.map((f) => {
        const r = this.resolve(s.id, f);
        const secret = f.type === "secret";
        return {
          key: f.key, label: f.label, description: f.description, type: f.type, options: f.options, min: f.min, max: f.max,
          placeholder: f.placeholder, when: f.when, env: f.env,
          value: secret ? null : r.value,
          hasValue: r.value !== null && r.value !== "",
          source: r.source,
          locked: r.source === "env",
          ...(r.unreadable ? { unreadable: true } : {}),
        } satisfies FieldView;
      }),
    }));
  }

  /**
   * Saves admin values for one section. `patch` maps field keys to new values:
   * `null` clears a field (back to the default); a key that's absent is left alone;
   * an empty string for a secret also leaves it alone (the form never sees the secret).
   */
  async update(sectionId: string, patch: Record<string, unknown>, userId: string | null): Promise<SectionView> {
    const def = sectionDef(sectionId);
    if (def.editions && !def.editions.includes(this.edition)) throw new Error(`${def.title} isn't available in this edition`);
    await this.refresh(true);
    const current: StoredSection = { ...(this.stored?.[sectionId] ?? {}) };
    for (const [key, raw] of Object.entries(patch)) {
      const field = def.fields.find((f) => f.key === key);
      if (!field) throw new Error(`Unknown setting "${key}"`);
      if (this.envValue(field) !== undefined) throw new Error(`${field.label} is set by the ${field.env} environment variable`);
      if (field.type === "secret" && raw === "") continue;
      const value = coerce(field, raw);
      if (value === null) delete current[key];
      else current[key] = field.type === "secret" ? { sealed: this.box.seal(String(value)) } : value;
    }
    await this.store.save(sectionId, current, userId);
    const before = this.stored;
    this.stored = { ...(this.stored ?? {}), [sectionId]: current };
    this.loadedAt = Date.now();
    if (this.diff(before, this.stored).length) this.emit([sectionId]);
    const view = (await this.describe()).find((s) => s.id === sectionId);
    if (!view) throw new Error("Section not found");
    return view;
  }

  /** Called with the ids of sections whose values changed (from this or another instance). */
  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(changed: string[]) {
    for (const fn of this.listeners) {
      try {
        fn(changed);
      } catch (error) {
        console.error("[kavero] settings listener failed:", error);
      }
    }
  }

  private envValue(field: FieldDef): string | undefined {
    if (!field.env) return undefined;
    const v = this.env[field.env];
    return v === undefined || v.trim() === "" ? undefined : v;
  }

  private resolve(sectionId: string, field: FieldDef): { value: SettingValue; source: ValueSource; unreadable?: boolean } {
    const fromEnv = this.envValue(field);
    if (fromEnv !== undefined) {
      try {
        return { value: coerce(field, fromEnv), source: "env" };
      } catch (error) {
        this.warnOnce(`env:${field.env}`, `${field.env} is invalid and is ignored: ${(error as Error).message}`);
      }
    }
    const stored = this.stored?.[sectionId]?.[field.key];
    if (stored !== undefined && stored !== null) {
      if (isSealed(stored)) {
        try {
          return { value: this.box.open(stored.sealed), source: "admin" };
        } catch {
          this.warnOnce(`sealed:${sectionId}.${field.key}`, `${sectionId}.${field.key} can't be decrypted (was the encryption key changed?). Enter it again in Admin → System.`);
          return { value: defaultValue(field, this.edition), source: "default", unreadable: true };
        }
      }
      try {
        return { value: coerce(field, stored), source: "admin" };
      } catch {
        // A stored value that no longer fits the field (e.g. an option was removed) falls back to the default.
      }
    }
    return { value: defaultValue(field, this.edition), source: "default" };
  }

  private warnOnce(id: string, message: string) {
    if (this.warned.has(id)) return;
    this.warned.add(id);
    console.warn(`[kavero] ${message}`);
  }

  private diff(a: Record<string, StoredSection> | null, b: Record<string, StoredSection>): string[] {
    const ids = new Set([...Object.keys(a ?? {}), ...Object.keys(b)]);
    return [...ids].filter((id) => JSON.stringify(a?.[id] ?? {}) !== JSON.stringify(b[id] ?? {}));
  }
}
