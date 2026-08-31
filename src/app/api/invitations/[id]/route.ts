import { z } from "zod";

import { route } from "@/lib/route";
import { revokeInvitation } from "@/services/invitations/service";

export const DELETE = route({
  permission: "users.manage",
  params: z.object({ id: z.string().min(1) }),
  handler: async ({ params }) => {
    const ok = await revokeInvitation(params.id);
    if (!ok) {
      const { HttpError } = await import("@/lib/errors");
      throw new HttpError("invalidInvite", 404, "invalidInvite");
    }
    return { ok: true };
  },
});
