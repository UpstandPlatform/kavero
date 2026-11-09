import type { Session } from "@Kavero/auth";
import type { Database } from "@Kavero/db";

import type { SecretBox } from "./services/secret-box";

export type Context = {
  session: Session | null;
  db: Database;
  /** Removes stored asset files; provided by the host app's object storage. */
  deleteObjects?: (keys: string[]) => Promise<void>;
  /** Encrypts third-party credentials (MCP connections). */
  secretBox?: SecretBox;
  /** Allow server-side requests to localhost/private addresses (development only). */
  allowLocalUrls?: boolean;
};
