import { z } from "zod";

import { appVisibility } from "@/db/schema";

/** zod building blocks shared across several domains. */

export const visibilitySchema = z.enum(appVisibility);

/** Required name (stable error code `nameRequired`). */
export const nameSchema = z.string("nameRequired").min(1, "nameRequired");
