import type { Session } from "@Kavero/auth";
import type { Database } from "@Kavero/db";

export type Context = {
  session: Session | null;
  db: Database;
};
