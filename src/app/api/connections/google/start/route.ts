import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-helpers";
import { UnauthenticatedError } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import { googleAuthUrl } from "@/services/connections/google";

export async function GET() {
  try {
    const user = await requireUser();
    const url = googleAuthUrl(user.id);
    return NextResponse.redirect(url);
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.redirect(new URL("/login", process.env.BETTER_AUTH_URL));
    }
    return await apiError(err);
  }
}
