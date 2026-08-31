import { NextRequest, NextResponse } from "next/server";
import { getLocale } from "next-intl/server";

import { apiError, errorResponse } from "@/lib/api-helpers";
import { requireUser } from "@/lib/session";
import { addGenerationMessage } from "@/services/messages/chat";
import { generateScript } from "@/services/generation/script";
import { createScript } from "@/services/scripts/scripts";
import { getEffectiveDefaults } from "@/services/llm/settings";

/** Generates a script from a prompt, optionally attached to an app. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json();
    if (!body.prompt || typeof body.prompt !== "string") {
      return errorResponse("promptRequired", 400);
    }

    const ownerId = user.id;

    const defaults = await getEffectiveDefaults(user.id);
    const locale = await getLocale();
    const generated = await generateScript(body.prompt, {
      provider: (body.provider as "opencode-go" | "openrouter") ?? defaults.provider,
      coderModel: (body.coderModel as string | undefined) ?? defaults.coderModel,
      locale,
      triggerKind: body.triggerKind === "manual" || body.triggerKind === "webhook" ? body.triggerKind : "schedule",
    });

    const scriptId = await createScript({
      ownerId,
      visibility: body.visibility === "family" ? "family" : "private",
      triggerKind: body.triggerKind === "manual" || body.triggerKind === "webhook" ? body.triggerKind : "schedule",
      name: generated.name,
      schedule: generated.schedule,
      code: generated.code,
      prompt: body.prompt,
    });

    await addGenerationMessage({
      ownerId,
      appId: null,
      scriptId,
      role: "user",
      content: `Script : ${body.prompt}`,
    });
    await addGenerationMessage({
      ownerId,
      appId: null,
      scriptId,
      role: "assistant",
      content: `Script généré : ${generated.name} — ${generated.schedule}\n\`\`\`js\n${generated.code}\n\`\`\``,
      model: generated.coderModel,
      durationMs: generated.durationMs,
    });

    return NextResponse.json({ id: scriptId, ...generated });
  } catch (err) {
    return await apiError(err);
  }
}
