import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";

import { HttpError, type ErrorCode } from "@/lib/errors";

/** JSON error response whose message is translated into the request's language. */
export async function errorResponse(code: ErrorCode, status: number): Promise<NextResponse> {
  const t = await getTranslations("errors");
  return NextResponse.json({ error: t(code), code }, { status });
}

/** Converts an error into the matching API response. */
export async function apiError(err: unknown): Promise<NextResponse> {
  if (err instanceof HttpError) {
    if (err.code) return errorResponse(err.code, err.status);
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[api]", err);
  return errorResponse("serverError", 500);
}
