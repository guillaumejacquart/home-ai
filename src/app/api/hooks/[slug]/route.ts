import { NextRequest, NextResponse } from "next/server";

import { apiError, errorResponse } from "@/lib/api-helpers";
import { getScriptByWebhookSlug } from "@/services/scripts/scripts";
import { runScript } from "@/services/scripts/runner";

type Params = { params: Promise<{ slug: string }> };

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Webhook entrant public : déclenche un script de type « webhook ».
 * Authentification par en-tête `x-webhook-secret` (le secret du script).
 * Le corps JSON de la requête est exposé au code via `home.webhook.payload`.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { slug } = await params;
    const script = await getScriptByWebhookSlug(slug);
    if (!script) return errorResponse("hookNotFound", 404);
    if (!script.webhookSecret || !timingSafeEqual(script.webhookSecret, req.headers.get("x-webhook-secret") ?? "")) {
      return errorResponse("hookNotFound", 404);
    }
    if (!script.enabled) {
      return NextResponse.json({ ok: true, skipped: true });
    }
    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      payload = null;
    }
    const { status } = await runScript(script.id, { payload });
    return NextResponse.json({ ok: true, status });
  } catch (err) {
    return await apiError(err);
  }
}