import { NextRequest } from "next/server";
import { getLocale } from "next-intl/server";

import { apiError, errorResponse } from "@/lib/api-helpers";
import { requireUser } from "@/lib/session";
import { formatHistory } from "@/services/generation/shared";
import { planScriptStream } from "@/services/generation/script";
import { addGenerationMessage, listScriptMessages } from "@/services/messages/chat";
import { getScript } from "@/services/scripts/scripts";
import { getEffectiveDefaults } from "@/services/llm/settings";

type Params = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

function encodeSSE(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function heartbeat(): Uint8Array {
  return new TextEncoder().encode(": keepalive\n\n");
}

/** Phase « plan » de l'itération d'un script existant (refine). */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const scriptRow = await getScript(id, user.id);
    if (!scriptRow) return errorResponse("scriptNotFound", 404);
    const script = scriptRow;

    const body = await req.json();
    if (!body.prompt || typeof body.prompt !== "string") return errorResponse("promptRequired", 400);

    const defaults = await getEffectiveDefaults(user.id);
    const locale = await getLocale();
    const signal = req.signal;

    // Historique des échanges précédents (messages assistant exclus).
    const history = await listScriptMessages(id);
    const historyBlock = formatHistory(
      history.map((m) => ({ role: m.role as "user" | "assistant" | "plan", content: m.content })),
    );

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let hb: ReturnType<typeof setInterval> | null = null;
        const enqueue = (e: string, d: unknown) => {
          try {
            controller.enqueue(encodeSSE(e, d));
          } catch {}
        };
        hb = setInterval(() => {
          try {
            controller.enqueue(heartbeat());
          } catch {}
        }, 10000);
        const onAbort = () => {
          try {
            enqueue("error", { error: "aborted" });
          } catch {}
          try {
            controller.close();
          } catch {}
          if (hb) clearInterval(hb);
        };
        signal.addEventListener("abort", onAbort);
        try {
          const result = await planScriptStream(body.prompt, {
            provider: (body.provider as "opencode-go" | "openrouter") ?? defaults.provider,
            plannerModel: (body.plannerModel as string | undefined) ?? defaults.plannerModel,
            locale,
            signal,
            onToken: (t) => enqueue("token", { token: t }),
            isIterating: true,
            triggerKind: body.triggerKind ?? (script.triggerKind as "schedule" | "manual" | "webhook"),
            current: { name: script.name, schedule: script.schedule, code: script.code },
            historyBlock,
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
            role: "plan",
            content: result.plan,
            model: result.model,
          });

          enqueue("done", result);
          controller.close();
        } catch (err) {
          try {
            enqueue("error", { error: err instanceof Error ? err.message : "Erreur" });
          } catch {}
          try {
            controller.close();
          } catch {}
        } finally {
          if (hb) clearInterval(hb);
          signal.removeEventListener("abort", onAbort);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    return await apiError(err);
  }
}