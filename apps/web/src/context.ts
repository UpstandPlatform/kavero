import type { Context as ApiContext } from "@Kavero/api/context";
import type { NextRequest } from "next/server";

import { objectStorage, testObjectStorage } from "./modules/storage/object-storage";
import { ENV } from "./env.server";
import { allowPrivateUrls, platform, runtimeConfig, secretBox, serverAiProvider } from "./platform";
import { auth, db } from "./services";

export async function createContext(req: NextRequest): Promise<ApiContext> {
  const [session, ai, allowLocalUrls] = await Promise.all([
    auth.api.getSession({ headers: req.headers }),
    serverAiProvider(),
    allowPrivateUrls(),
  ]);
  return {
    db,
    session,
    auth,
    headers: req.headers,
    secretBox,
    ai,
    appUrl: ENV.BETTER_AUTH_URL,
    allowLocalUrls,
    config: runtimeConfig,
    platform,
    testStorage: testObjectStorage,
    deleteObjects: async (keys) => {
      // Files are content-addressed per catalog, so these keys belong to the deleted catalog only.
      const storage = await objectStorage();
      await Promise.all(keys.map((k) => storage.delete(k)));
    },
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
