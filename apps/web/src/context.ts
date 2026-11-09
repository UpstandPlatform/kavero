import type { Context as ApiContext } from "@Kavero/api/context";
import { SecretBox } from "@Kavero/api/services/secret-box";
import type { NextRequest } from "next/server";

import { objectStorage } from "./modules/storage/object-storage";
import { ENV } from "./env.server";
import { db } from "./services";

const secretBox = new SecretBox(ENV.BETTER_AUTH_SECRET);
import { auth } from "./services";

export async function createContext(req: NextRequest): Promise<ApiContext> {
  const session = await auth.api.getSession({
    headers: req.headers,
  });
  return {
    db,
    session,
    secretBox,
    allowLocalUrls: process.env.NODE_ENV !== "production",
    deleteObjects: async (keys) => {
      // Files are content-addressed per catalog, so these keys belong to the deleted catalog only.
      await Promise.all(keys.map((k) => objectStorage().delete(k)));
    },
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
