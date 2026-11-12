/**
 * Editions share one core. What differs between them lives here, behind small
 * interfaces, so core code asks "what can this deployment do?" instead of
 * checking environment variables itself.
 *
 * - desktop:     the Electron app's own local server (one automatic account, offline).
 * - self-hosted: anyone running the server (Docker, Node). The default.
 * - cloud:       the hosted service. Adds plans/billing modules on top of the core.
 *
 * Every edition gets every core feature. Cloud-only modules (plans, billing)
 * only add limits and screens; they never remove core capabilities.
 */

export const EDITIONS = ["desktop", "self-hosted", "cloud"] as const;
export type Edition = (typeof EDITIONS)[number];

export interface EditionEnv {
  KAVERO_EDITION?: string;
  KAVERO_LOCAL_MODE?: string;
  NODE_ENV?: string;
}

/** Which edition this process runs as. KAVERO_EDITION wins; the desktop app sets KAVERO_LOCAL_MODE=1. */
export function detectEdition(env: EditionEnv = process.env as EditionEnv): Edition {
  const explicit = env.KAVERO_EDITION?.trim().toLowerCase();
  if (explicit) {
    if ((EDITIONS as readonly string[]).includes(explicit)) return explicit as Edition;
    throw new Error(`Unknown KAVERO_EDITION "${env.KAVERO_EDITION}" (expected ${EDITIONS.join(", ")})`);
  }
  return env.KAVERO_LOCAL_MODE === "1" ? "desktop" : "self-hosted";
}

/** Limits a user works within. `null` means unlimited. */
export interface Entitlements {
  plan: string;
  maxCatalogs: number | null;
  maxPublishedSites: number | null;
  maxStorageMb: number | null;
  aiRequestsPerDay: number | null;
}

export const UNLIMITED: Entitlements = { plan: "unlimited", maxCatalogs: null, maxPublishedSites: null, maxStorageMb: null, aiRequestsPerDay: null };

/** Source of a user's limits. Self-hosted and desktop use the unlimited default; cloud plugs in plans. */
export interface EntitlementProvider {
  forUser(userId: string): Promise<Entitlements>;
}

export const unlimitedEntitlements: EntitlementProvider = { forUser: async () => UNLIMITED };

/** Optional, edition-specific features. Core features are always on and not listed here. */
export interface EditionFeatures {
  /** Sign-in screens and accounts (desktop uses one automatic local account). */
  accounts: boolean;
  /** Plans, pricing and billing screens (cloud only). */
  billing: boolean;
  /** Server can reach private/LAN addresses by default (MCP servers, local AI models). */
  privateNetworkByDefault: boolean;
  /** In-app updates from GitHub Releases. */
  selfUpdate: boolean;
}

export const EDITION_FEATURES: Record<Edition, EditionFeatures> = {
  desktop: { accounts: false, billing: false, privateNetworkByDefault: true, selfUpdate: true },
  "self-hosted": { accounts: true, billing: false, privateNetworkByDefault: false, selfUpdate: false },
  cloud: { accounts: true, billing: true, privateNetworkByDefault: false, selfUpdate: false },
};

/**
 * An edition module: an optional add-on (e.g. cloud billing) that registers
 * extra behaviour without core code knowing about it.
 */
export interface EditionModule {
  id: string;
  editions: readonly Edition[];
  /** Replaces the default (unlimited) entitlements, e.g. plan-based limits. */
  entitlements?: EntitlementProvider;
}

export class Platform {
  readonly features: EditionFeatures;
  private readonly modules: EditionModule[] = [];

  constructor(readonly edition: Edition) {
    this.features = EDITION_FEATURES[edition];
  }

  /** Adds a module if it applies to this edition. Returns whether it was added. */
  use(module: EditionModule): boolean {
    if (!module.editions.includes(this.edition)) return false;
    if (this.modules.some((m) => m.id === module.id)) throw new Error(`Edition module "${module.id}" is already registered`);
    this.modules.push(module);
    return true;
  }

  has(moduleId: string): boolean {
    return this.modules.some((m) => m.id === moduleId);
  }

  get moduleIds(): string[] {
    return this.modules.map((m) => m.id);
  }

  /** The last registered entitlement provider wins; unlimited when none. */
  get entitlements(): EntitlementProvider {
    return [...this.modules].reverse().find((m) => m.entitlements)?.entitlements ?? unlimitedEntitlements;
  }
}
