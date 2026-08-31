import { NextRequest, NextResponse } from "next/server";
import { getLocale } from "next-intl/server";

import { apiError, errorResponse } from "@/lib/api-helpers";
import { requireUser } from "@/lib/session";
import { addGenerationMessage } from "@/services/messages/chat";
import { getScript, updateScript } from "@/services/scripts/scripts";
import { refineScript } from "@/services/generation/script";
import { getEffectiveDefaults } from "@/services/llm/settings";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const scriptRow = await getScript(id, user.id);
    if (!scriptRow) return errorResponse("scriptNotFound", 404);
    const script = scriptRow;

    const body = await req.json();
    if (!body.prompt || typeof body.prompt !== "string") {
      return errorResponse("promptRequired", 400);
    }

    // L'app du script sert de namespace pour les messages du chat de génération.
    const defaults = await getEffectiveDefaults(user.id);
    const locale = await getLocale();
    const triggerKind: "schedule" | "manual" | "webhook" =
      body.triggerKind === "manual" || body.triggerKind === "webhook"
        ? body.triggerKind
        : (script.triggerKind as "schedule" | "manual" | "webhook");
    const result = await refineScript(
      { name: script.name, schedule: script.schedule, code: script.code },
      body.prompt,
      {
        provider: (body.provider as "opencode-go" | "openrouter") ?? defaults.provider,
        coderModel: (body.coderModel as string | undefined) ?? defaults.coderModel,
        locale,
        triggerKind,
      },
    );

    await updateScript(user.id, id, {
      name: result.name,
      triggerKind,
      schedule: result.schedule,
      code: result.code,
      prompt: body.prompt,
    });

    await addGenerationMessage({
      ownerId: script.ownerId,
      appId: null,
      scriptId: id,
      role: "user",
      content: `Modifier le script : ${body.prompt}`,
    });
    await addGenerationMessage({
      ownerId: script.ownerId,
      appId: null,
      scriptId: id,
      role: "assistant",
      content: `Script modifié : ${result.name} — ${result.schedule}\n\`\`\`js\n${result.code}\n\`\`\``,
      model: result.coderModel,
      durationMs: result.durationMs,
    });

    return NextResponse.json({ id, ...result });
  } catch (err) {
    return await apiError(err);
  }
}
