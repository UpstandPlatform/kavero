import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import type { Database } from "@Kavero/db";
import * as schema from "@Kavero/db/schema/auth";
import { appSetting } from "@Kavero/db/schema/integration";
import { workspaceInvite } from "@Kavero/db/schema/workspace";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins";
import { and, count, eq, gt, isNull, sql } from "drizzle-orm";

export type AuthConfig = {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
};

/** Who may create an account (Admin → Settings). */
export type SignupPolicy = "open" | "invite-only" | "closed";
export const SIGNUP_POLICY_KEY = "signup_policy";

export async function getSignupPolicy(database: Database): Promise<SignupPolicy> {
  const [row] = await database.select({ value: appSetting.value }).from(appSetting).where(eq(appSetting.key, SIGNUP_POLICY_KEY)).limit(1);
  const v = row?.value;
  return v === "invite-only" || v === "closed" ? v : "open";
}

export function createAuth(env: AuthConfig, database: Database) {
  return betterAuth({
    database: drizzleAdapter(database, {
      provider: "pg",
      schema,
    }),
    trustedOrigins: [env.BETTER_AUTH_URL],
    emailAndPassword: { enabled: true },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    databaseHooks: {
      user: {
        create: {
          // The first account on a new server is its admin; after that the sign-up policy applies.
          before: async (user) => {
            const [{ n } = { n: 0 }] = await database.select({ n: count() }).from(schema.user);
            if (n === 0) return { data: { ...user, role: "admin" } };
            const policy = await getSignupPolicy(database);
            if (policy === "closed") {
              throw new APIError("FORBIDDEN", { message: "Sign-ups are closed on this server. Ask an admin for an account." });
            }
            if (policy === "invite-only") {
              const [invite] = await database
                .select({ id: workspaceInvite.id })
                .from(workspaceInvite)
                .where(and(sql`lower(${workspaceInvite.email}) = lower(${user.email})`, isNull(workspaceInvite.acceptedAt), gt(workspaceInvite.expiresAt, new Date())))
                .limit(1);
              if (!invite) throw new APIError("FORBIDDEN", { message: "This server is invite-only. Ask a workspace admin to invite this email address." });
            }
            return { data: { ...user, role: "user" } };
          },
        },
      },
    },
    plugins: [
      nextCookies(),
      admin({
        defaultRole: "user",
        adminRoles: ["admin"],
        bannedUserMessage: "This account has been suspended. Contact the server admin.",
      }),
    ],
  });
}

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"];
