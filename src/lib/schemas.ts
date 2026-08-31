import { z } from "zod";

import { appVisibility } from "@/db/schema";

/** Briques zod partagées par plusieurs domaines. */

export const visibilitySchema = z.enum(appVisibility);

/** Nom obligatoire (code d'erreur historique `nameRequired`). */
export const nameSchema = z.string("nameRequired").min(1, "nameRequired");
