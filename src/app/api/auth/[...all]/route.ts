import { eq } from "drizzle-orm";
import { toNextJsHandler } from "better-auth/next-js";

import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { consumeInvitation, isSignupOpen, validateInvitation } from "@/services/invitations/service";

/** Mounts all better-auth routes (/api/auth/*) with invite-only sign-up gate. */
const handler = toNextJsHandler(auth);

export const GET = handler.GET;

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ message, code: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(req: Request) {
  const url = new URL(req.url);

  // Only intercept the email+password sign-up endpoint.
  if (url.pathname.endsWith("/sign-up/email")) {
    try {
      // Read body without consuming the original request for the handler.
      const clone = req.clone() as Request;
      const body = (await clone.json().catch(() => ({} as Record<string, unknown>))) as Record<
        string,
        unknown
      >;

      if (!env.ALLOW_SIGNUP) {
        const open = await isSignupOpen();
        if (!open) {
          const email = String(body.email ?? "")
            .toLowerCase()
            .trim();
          const rawToken = (body.inviteToken as string | undefined) ?? (body as Record<string, unknown>).invite_token;
          const inviteToken = typeof rawToken === "string" ? rawToken.trim() : "";

          if (!email || !inviteToken) {
            return jsonError("signupDisabled", 403);
          }

          const valid = await validateInvitation(email, inviteToken);
          if (!valid) {
            return jsonError("invalidInvite", 403);
          }

          // Forward to better-auth; on success consume invite and set role.
          const res = await handler.POST(req);
          if (res.ok) {
            try {
              await consumeInvitation(email, inviteToken);
              if (valid.role !== "user") {
                await db.update(schema.user).set({ role: valid.role }).where(eq(schema.user.email, email));
              }
            } catch (err) {
              console.error("[auth] failed to consume invitation / set role", err);
            }
          }
          return res;
        }
      }
    } catch (err) {
      console.error("[auth] sign-up gate error", err);
      // Fall through to handler on unexpected error
    }
  }

  return handler.POST(req);
}
