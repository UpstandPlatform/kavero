import { UNLIMITED, type EditionModule, type Entitlements } from "./edition";
import type { RuntimeConfig } from "./runtime-config";

const limit = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Cloud edition: every account gets the default plan limits an admin sets in
 * Admin → System → Plan limits. A billing provider (e.g. Stripe) can later
 * replace this with per-user plans by registering its own `entitlements`.
 */
export function cloudPlansModule(config: RuntimeConfig): EditionModule {
  return {
    id: "cloud-plans",
    editions: ["cloud"],
    entitlements: {
      async forUser(): Promise<Entitlements> {
        const p = await config.values("plans");
        return {
          ...UNLIMITED,
          plan: typeof p.planName === "string" && p.planName ? p.planName : "Free",
          maxCatalogs: limit(p.maxCatalogs),
          maxPublishedSites: limit(p.maxPublishedSites),
          maxStorageMb: limit(p.maxStorageMb),
          aiRequestsPerDay: limit(p.aiRequestsPerDay),
        };
      },
    },
  };
}
