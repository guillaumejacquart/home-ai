import { z } from "zod";

import { route } from "@/lib/route";
import { buildInviteUrl, createInvitation, listInvitations } from "@/services/invitations/service";

export const GET = route({
  permission: "users.manage",
  handler: async () => {
    const invites = await listInvitations();
    return { invitations: invites };
  },
});

export const POST = route({
  permission: "users.manage",
  body: z.object({
    email: z.string().min(1, "invalidContent").email("invalidContent"),
    role: z.enum(["admin", "user"]).optional(),
  }),
  handler: async ({ user, body }) => {
    const email = body.email.trim().toLowerCase();
    const role = body.role ?? "user";
    const { token, expiresAt, id } = await createInvitation({ email, role, createdBy: user.id });
    const url = buildInviteUrl(token, email);
    return { id, email, role, expiresAt: expiresAt.toISOString(), url };
  },
});
