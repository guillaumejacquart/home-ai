import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";

import { db } from "@/db/client";
import { env } from "@/lib/env";
import * as schema from "@/db/schema";

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 jours
  },
  plugins: [
    // RBAC : stocke le rôle (« admin » | « user ») et expose les endpoints
    // /api/auth/admin/* (list-users, set-role… réservés aux admins).
    admin(),
  ],
  databaseHooks: {
    user: {
      create: {
        // Amorçage : sur une base vierge, le premier inscrit devient admin.
        async before() {
          const anyUser = await db
            .select({ id: schema.user.id })
            .from(schema.user)
            .limit(1);
          if (anyUser.length === 0) {
            return { data: { role: "admin" } };
          }
        },
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
