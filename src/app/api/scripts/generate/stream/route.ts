import { NextRequest } from "next/server";
import { getLocale } from "next-intl/server";

import { apiError, errorResponse } from "@/lib/api-helpers";
import { requireUser } from "@/lib/session";
import { addGenerationMessage } from "@/services/messages/chat";
import { codeScriptStream } from "@/services/generation/script";
import { createScript } from "@/services/scripts/scripts";
import { getEffectiveDefaults } from "@/services/llm/settings";

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

/** Phase « code » de la création d'un script : à partir d'un plan validé, génère puis crée le script. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json();
    if (!body.prompt || typeof body.prompt !== "string") return errorResponse("promptRequired", 400);
    if (!body.plan || typeof body.plan !== "string") return errorResponse("planRequired", 400);

    const ownerId = user.id;
    const appId = null;

    const defaults = await getEffectiveDefaults(user.id);
    const locale = await getLocale();
    const signal = req.signal;
    const triggerKind: "schedule" | "manual" | "webhook" =
      body.triggerKind === "manual" || body.triggerKind === "webhook" ? body.triggerKind : "schedule";

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
          const generated = await codeScriptStream(body.prompt, body.plan, {
            provider: (body.provider as "opencode-go" | "openrouter") ?? defaults.provider,
            coderModel: (body.coderModel as string | undefined) ?? defaults.coderModel,
            locale,
            signal,
            triggerKind,
            onToken: (t) => enqueue("token", { token: t }),
          });

          const scriptId = await createScript({
            ownerId,
            visibility: body.visibility === "family" ? "family" : "private",
            triggerKind,
            name: generated.name,
            schedule: generated.schedule,
            code: generated.code,
            prompt: body.prompt,
          });

          await addGenerationMessage({ ownerId, appId, scriptId, role: "user", content: `Script : ${body.prompt}` });
          await addGenerationMessage({
            ownerId,
            appId,
            scriptId,
            role: "plan",
            content: body.plan,
          });
          await addGenerationMessage({
            ownerId,
            appId,
            scriptId,
            role: "assistant",
            content: `Script généré : ${generated.name} — ${generated.schedule}\n\`\`\`js\n${generated.code}\n\`\`\``,
            model: generated.coderModel,
            durationMs: generated.durationMs,
          });

          enqueue("done", { id: scriptId, ...generated });
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