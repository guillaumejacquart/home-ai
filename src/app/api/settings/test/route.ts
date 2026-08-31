import { NextRequest, NextResponse } from "next/server";

import { apiError } from "@/lib/api-helpers";
import { requirePermission } from "@/lib/session";
import { chatCompletion, LlmError, resolveApiKey } from "@/services/llm/llm";

const TEST_TIMEOUT_MS = 15000;

export async function POST(req: NextRequest) {
  try {
    // Connectivity test: platform setting, reserved for admins.
    await requirePermission("platform.settings");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const provider =
      body.provider === "openrouter" ? "openrouter" : "opencode-go";

    const key = await resolveApiKey(provider);
    if (!key) {
      return NextResponse.json({
        ok: false,
        error: "Provider non configuré (clé API manquante)",
      });
    }

    const started = Date.now();
    const text = await Promise.race([
      chatCompletion([{ role: "user", content: "ping" }], {
        provider,
        maxTokens: 8,
        feature: "test",
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new LlmError("Test LLM expiré (15 s)")),
          TEST_TIMEOUT_MS,
        ),
      ),
    ]);

    return NextResponse.json({
      ok: true,
      latencyMs: Date.now() - started,
      reply: text.slice(0, 80),
    });
  } catch (err) {
    if (err instanceof LlmError) {
      return NextResponse.json({ ok: false, error: err.message });
    }
    return await apiError(err);
  }
}