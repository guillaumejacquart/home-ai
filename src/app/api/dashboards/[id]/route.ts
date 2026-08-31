import { z } from "zod";

import { errorResponse } from "@/lib/api-helpers";
import { route } from "@/lib/route";
import { visibilitySchema } from "@/lib/schemas";
import {
  deleteDashboard,
  getDashboard,
  updateDashboard,
  type DashboardLayout,
} from "@/services/dashboards/dashboards";

export const GET = route({
  handler: async ({ user, params }) => {
    const dash = await getDashboard(user.id, params.id);
    if (!dash) return errorResponse("dashboardNotFound", 404);
    return dash;
  },
});

export const PATCH = route({
  body: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    visibility: visibilitySchema.optional(),
    // Layout shape is validated by the service (`validateLayout`).
    layout: z.unknown().optional(),
  }),
  handler: async ({ user, params, body }) => {
    await updateDashboard(user.id, params.id, body as { layout?: DashboardLayout });
    return { ok: true };
  },
});

export const DELETE = route({
  handler: async ({ user, params }) => {
    await deleteDashboard(user.id, params.id);
    return { ok: true };
  },
});
