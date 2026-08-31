import { NextRequest, NextResponse } from "next/server";

import { env } from "@/lib/env";
import { requireUser } from "@/lib/session";
import { exchangeCode } from "@/services/connections/google";
import { upsertGoogleConnection } from "@/services/connections/connections";

function redirectToConnections(query: string): NextResponse {
  return NextResponse.redirect(
    new URL(`/connections?${query}`, env.BETTER_AUTH_URL),
  );
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      return redirectToConnections(
        `error=${encodeURIComponent("Accès Google refusé")}`,
      );
    }
    if (!code || !state) {
      return redirectToConnections(
        `error=${encodeURIComponent("Callback invalide")}`,
      );
    }

    const user = await requireUser();
    if (state !== user.id) {
      return redirectToConnections(
        `error=${encodeURIComponent("État de session invalide")}`,
      );
    }

    const config = await exchangeCode(code);
    await upsertGoogleConnection(user.id, "Google", config);
    return redirectToConnections("connected=google");
  } catch (err) {
    console.error("[google-callback]", err);
    return redirectToConnections(
      `error=${encodeURIComponent("Échec de la connexion Google")}`,
    );
  }
}
