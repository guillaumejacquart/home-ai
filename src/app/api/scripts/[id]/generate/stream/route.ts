import { NextRequest } from "next/server";
import { getLocale } from "next-intl/server";

import { apiError, errorResponse } from "@/lib/api-helpers";
import { requireUser } from "@/lib/session";
import { addGenerationMessage } from "@/services/messages/chat";
import { getScript, updateScript } from "@/services/scripts/scripts";
import { codeScriptStream } from "@/services/generation/script";
import { getEffectiveDefaults } from "@/services/llm/settings";

type Params = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";
// Un appel du coder peut légitimement durer plusieurs minutes (budget 240 s
// côté LLM). Pense au proxy en amont : nginx proxy_read_timeout, traefik
// respondingTimeouts.
export const maxDuration = 600;
export const runtime = "nodejs";

function encodeSSE(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function heartbeat(): Uint8Array {
  return new TextEncoder().encode(": keepalive\n\n");
}

/** Phase « code » de l'itération d'un script existant : à partir du plan validé, applique les changements. */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const scriptRow = await getScript(id, user.id);
    if (!scriptRow) return errorResponse("scriptNotFound", 404);
    const script = scriptRow;
    const body = await req.json();
    if (!body.prompt || typeof body.prompt !== "string") return errorResponse("promptRequired", 400);
    if (!body.plan || typeof body.plan !== "string") return errorResponse("planRequired", 400);

    const defaults = await getEffectiveDefaults(user.id);
    const locale = await getLocale();
    const signal = req.signal;
    const triggerKind: "schedule" | "manual" | "webhook" =
      body.triggerKind === "manual" || body.triggerKind === "webhook"
        ? body.triggerKind
        : (script.triggerKind as "schedule" | "manual" | "webhook");

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
          const result = await codeScriptStream(body.prompt, body.plan, {
            provider: (body.provider as "opencode-go" | "openrouter") ?? defaults.provider,
            coderModel: (body.coderModel as string | undefined) ?? defaults.coderModel,
            locale,
            signal,
            triggerKind,
            onToken: (t) => enqueue("token", { token: t }),
            current: { name: script.name, schedule: script.schedule, code: script.code },
          });

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
            role: "assistant",
            content: `Script modifié : ${result.name} — ${result.schedule}\n\`\`\`js\n${result.code}\n\`\`\``,
            model: result.coderModel,
            durationMs: result.durationMs,
          });

          enqueue("done", { id, ...result });
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