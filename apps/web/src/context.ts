import type { Context as ApiContext } from "@Kavero/api/context";
import type { NextRequest } from "next/server";

import { objectStorage } from "./modules/storage/object-storage";
import { db } from "./services";
import { auth } from "./services";

export async function createContext(req: NextRequest): Promise<ApiContext> {
  const session = await auth.api.getSession({
    headers: req.headers,
  });
  return {
    db,
    session,
    deleteObjects: async (keys) => {
      // Files are content-addressed per catalog, so these keys belong to the deleted catalog only.
      await Promise.all(keys.map((k) => objectStorage().delete(k)));
    },
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
