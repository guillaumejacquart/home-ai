import { z } from "zod";

import { errorResponse } from "@/lib/api-helpers";
import { route } from "@/lib/route";
import { installTemplate } from "@/services/templates/templates";

export const POST = route({
  body: z.object({ name: z.string().optional() }),
  status: 201,
  handler: async ({ user, params, body }) => {
    if (!params.slug) return errorResponse("nameRequired", 400);
    return installTemplate(user.id, params.slug, { name: body.name });
  },
});
