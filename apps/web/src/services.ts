import { createAuth } from "@Kavero/auth";
import { createDb } from "@Kavero/db";

import { ENV } from "./env.server";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db);
