import type { Session } from "@Kavero/auth";
import type { Database } from "@Kavero/db";

export type Context = {
  session: Session | null;
  db: Database;
  /** Removes stored asset files; provided by the host app's object storage. */
  deleteObjects?: (keys: string[]) => Promise<void>;
};
