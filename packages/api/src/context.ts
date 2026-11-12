import type { Auth } from "@Kavero/auth";
import type { Session } from "@Kavero/auth";
import type { LlmProvider } from "@Kavero/ai";
import type { Database } from "@Kavero/db";

import type { Platform } from "./platform/edition";
import type { RuntimeConfig } from "./platform/runtime-config";
import type { SecretBox } from "./services/secret-box";

export type Context = {
  session: Session | null;
  db: Database;
  /** Better Auth instance and request headers for protected server-side plugin APIs. */
  auth?: Auth;
  headers?: Headers;
  /** Removes stored asset files; provided by the host app's object storage. */
  deleteObjects?: (keys: string[]) => Promise<void>;
  /** Encrypts third-party credentials (MCP connections). */
  secretBox?: SecretBox;
  /** Allow server-side requests to localhost/private addresses (development only). */
  allowLocalUrls?: boolean;
  /** Configured LLM provider, or null for the offline planner only. */
  ai?: LlmProvider | null;
  /** Public origin of the app (for provider attribution headers). */
  appUrl?: string;
  /** Admin-managed runtime settings (Admin → System). */
  config?: RuntimeConfig;
  /** Edition (desktop, self-hosted, cloud) and its modules. */
  platform?: Platform;
  /** Checks that the configured media storage can write, read and delete. */
  testStorage?: () => Promise<{ ok: boolean; driver: string; message?: string }>;
};
