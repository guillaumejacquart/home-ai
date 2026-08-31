import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";

/** Monte toutes les routes better-auth (/api/auth/*). */
export const { GET, POST } = toNextJsHandler(auth);
