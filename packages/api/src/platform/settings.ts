import type { Edition } from "./edition";

/**
 * Runtime settings that admins manage in Admin → System instead of environment
 * variables. Each field may still be set by an environment variable, which then
 * wins and locks the field (useful for infrastructure-as-code deployments).
 *
 * Bootstrap settings stay environment-only: DATABASE_URL, BETTER_AUTH_SECRET,
 * BETTER_AUTH_URL, KAVERO_ENCRYPTION_KEY, REDIS_URL, NODE_ENV, PORT, file paths.
 */

export type FieldType = "string" | "secret" | "boolean" | "number" | "enum" | "url";

export interface FieldDef {
  key: string;
  label: string;
  description?: string;
  type: FieldType;
  /** Environment variable that overrides (and locks) this field. */
  env?: string;
  /** Default when neither the environment nor the admin set a value. May depend on the edition. */
  default?: string | number | boolean | null | ((edition: Edition) => string | number | boolean | null);
  options?: readonly { value: string; label: string }[];
  min?: number;
  max?: number;
  placeholder?: string;
  /** Shown only when another field has one of these values, e.g. S3 fields when driver = s3. */
  when?: { field: string; in: readonly (string | boolean)[] };
}

export interface SectionDef {
  id: string;
  title: string;
  description: string;
  fields: readonly FieldDef[];
  /** Editions that show this section (default: all). */
  editions?: readonly Edition[];
}

const s3 = { field: "driver", in: ["s3"] } as const;

export const SETTINGS: readonly SectionDef[] = [
  {
    id: "storage",
    title: "Media storage",
    description: "Where uploaded images, fonts and generated previews are stored. S3-compatible services include AWS S3, Cloudflare R2 and MinIO.",
    fields: [
      { key: "driver", label: "Storage", type: "enum", env: "STORAGE_DRIVER", default: "filesystem", options: [{ value: "filesystem", label: "This server's disk" }, { value: "s3", label: "S3-compatible bucket" }] },
      { key: "bucket", label: "Bucket", type: "string", env: "S3_BUCKET", when: s3, placeholder: "kavero-media" },
      { key: "region", label: "Region", type: "string", env: "S3_REGION", when: s3, description: "Use \"auto\" for Cloudflare R2. Defaults to us-east-1, or auto when an endpoint is set.", placeholder: "us-east-1" },
      { key: "endpoint", label: "Endpoint", type: "url", env: "S3_ENDPOINT", when: s3, description: "Only for R2, MinIO and other non-AWS services.", placeholder: "https://<account>.r2.cloudflarestorage.com" },
      { key: "accessKeyId", label: "Access key ID", type: "string", env: "S3_ACCESS_KEY_ID", when: s3, description: "Leave empty to use the server's own credentials (IAM role, AWS profile)." },
      { key: "secretAccessKey", label: "Secret access key", type: "secret", env: "S3_SECRET_ACCESS_KEY", when: s3 },
      { key: "forcePathStyle", label: "Path-style URLs", type: "boolean", env: "S3_FORCE_PATH_STYLE", default: false, when: s3, description: "Needed for MinIO." },
    ],
  },
  {
    id: "ai",
    title: "AI model",
    description: "The server-wide model everyone can use. Users can still add their own key in Settings → AI. Without a model, Kavero's built-in planner is used.",
    fields: [
      {
        key: "provider", label: "Provider", type: "enum", env: "AI_PROVIDER", default: "auto",
        options: [
          { value: "auto", label: "Automatic (first configured)" },
          { value: "anthropic", label: "Anthropic Claude" },
          { value: "openai", label: "OpenAI" },
          { value: "openai-compatible", label: "OpenAI-compatible (Ollama, LM Studio, vLLM…)" },
          { value: "none", label: "None (built-in planner only)" },
        ],
      },
      { key: "model", label: "Model", type: "string", env: "AI_MODEL", description: "Required for OpenAI and OpenAI-compatible. Anthropic defaults to its newest model." },
      { key: "anthropicApiKey", label: "Anthropic API key", type: "secret", env: "ANTHROPIC_API_KEY" },
      { key: "openaiApiKey", label: "OpenAI API key", type: "secret", env: "OPENAI_API_KEY", description: "Also sent to OpenAI-compatible servers that need a key." },
      { key: "baseUrl", label: "Base URL", type: "url", env: "AI_BASE_URL", description: "For OpenAI-compatible servers, e.g. http://localhost:11434/v1 for Ollama." },
    ],
  },
  {
    id: "media",
    title: "Media library",
    description: "Stock image and GIF search in the editor's media library.",
    fields: [
      { key: "openverseEnabled", label: "Openverse image search", type: "boolean", env: "NEXT_PUBLIC_OPENVERSE_ENABLED", default: false, description: "Openly licensed images from Openverse." },
      { key: "giphyApiKey", label: "GIPHY API key", type: "string", env: "NEXT_PUBLIC_GIPHY_API_KEY", description: "GIPHY keys are public by design: the browser uses this key directly." },
    ],
  },
  {
    id: "network",
    title: "Network and security",
    description: "How the server reaches other services and identifies visitors.",
    fields: [
      {
        key: "allowPrivateUrls", label: "Allow private network addresses", type: "boolean", env: "KAVERO_ALLOW_PRIVATE_URLS",
        default: (edition) => edition === "desktop" || process.env.NODE_ENV !== "production",
        description: "Lets MCP connections, AI servers and imports reach localhost and LAN addresses. Keep off on shared servers unless you trust every user.",
      },
      { key: "trustProxy", label: "Reverse proxy hops", type: "number", env: "TRUST_PROXY", default: 0, min: 0, max: 10, description: "How many proxies sit in front of Kavero (0 = none). Used to find visitors' IP addresses for brute-force protection." },
    ],
  },
  {
    id: "exports",
    title: "Exports",
    description: "PDF, image and video rendering with headless Chrome.",
    fields: [
      { key: "maxBrowsers", label: "Parallel exports", type: "number", env: "KAVERO_MAX_BROWSERS", default: 2, min: 1, max: 16, description: "How many Chrome exports may run at once. Each needs about 300 MB of memory." },
    ],
  },
  {
    id: "plans",
    title: "Plan limits",
    description: "Default limits for every account. Leave a field empty for no limit.",
    editions: ["cloud"],
    fields: [
      { key: "planName", label: "Plan name", type: "string", default: "Free" },
      { key: "maxCatalogs", label: "Cloud catalogs per user", type: "number", min: 1, max: 100_000 },
      { key: "maxPublishedSites", label: "Published sites per user", type: "number", min: 0, max: 100_000 },
      { key: "maxStorageMb", label: "Storage per user (MB)", type: "number", min: 1, max: 10_000_000 },
      { key: "aiRequestsPerDay", label: "AI requests per user per day", type: "number", min: 0, max: 1_000_000 },
    ],
  },
];

export type SettingValue = string | number | boolean | null;

export function sectionDef(id: string): SectionDef {
  const s = SETTINGS.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown settings section "${id}"`);
  return s;
}

/** Parses a raw value (from env text or admin input) into the field's type. Throws a readable message when invalid. */
export function coerce(field: FieldDef, raw: unknown): SettingValue {
  if (raw === null || raw === undefined || raw === "") return null;
  switch (field.type) {
    case "boolean": {
      if (typeof raw === "boolean") return raw;
      const t = String(raw).trim().toLowerCase();
      if (["1", "true", "yes", "on"].includes(t)) return true;
      if (["0", "false", "no", "off"].includes(t)) return false;
      throw new Error(`${field.label}: expected true or false`);
    }
    case "number": {
      // TRUST_PROXY historically accepted "true" for one hop.
      const n = typeof raw === "number" ? raw : String(raw).trim().toLowerCase() === "true" ? 1 : Number(String(raw).trim());
      if (!Number.isFinite(n)) throw new Error(`${field.label}: expected a number`);
      if (field.min !== undefined && n < field.min) throw new Error(`${field.label}: at least ${field.min}`);
      if (field.max !== undefined && n > field.max) throw new Error(`${field.label}: at most ${field.max}`);
      return n;
    }
    case "enum": {
      const v = String(raw).trim().toLowerCase();
      if (!field.options?.some((o) => o.value === v)) throw new Error(`${field.label}: expected one of ${field.options?.map((o) => o.value).join(", ")}`);
      return v;
    }
    case "url": {
      const v = String(raw).trim();
      let u: URL;
      try {
        u = new URL(v);
      } catch {
        throw new Error(`${field.label}: not a valid URL`);
      }
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`${field.label}: must start with http:// or https://`);
      return v.replace(/\/+$/, "");
    }
    default: {
      const v = String(raw);
      if (v.length > 4000) throw new Error(`${field.label}: too long`);
      return field.type === "secret" ? v : v.trim();
    }
  }
}

export function defaultValue(field: FieldDef, edition: Edition): SettingValue {
  const d = field.default;
  return typeof d === "function" ? d(edition) : (d ?? null);
}
