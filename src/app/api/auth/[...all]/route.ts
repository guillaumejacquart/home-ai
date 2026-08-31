import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";

/** Mounts all better-auth routes (/api/auth/*). */
export const { GET, POST } = toNextJsHandler(auth);
