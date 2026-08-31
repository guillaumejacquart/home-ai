import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";

import { HttpError, type ErrorCode } from "@/lib/errors";

/** Réponse d'erreur JSON dont le message est traduit dans la langue de la requête. */
export async function errorResponse(code: ErrorCode, status: number): Promise<NextResponse> {
  const t = await getTranslations("errors");
  return NextResponse.json({ error: t(code), code }, { status });
}

/** Convertit une erreur en réponse API adaptée. */
export async function apiError(err: unknown): Promise<NextResponse> {
  if (err instanceof HttpError) {
    if (err.code) return errorResponse(err.code, err.status);
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[api]", err);
  return errorResponse("serverError", 500);
}
