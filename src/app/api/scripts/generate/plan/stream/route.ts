import { NextRequest } from "next/server";
import { getLocale } from "next-intl/server";

import { apiError, errorResponse } from "@/lib/api-helpers";
import { requireUser } from "@/lib/session";
import { planScriptStream } from "@/services/generation/script";
import { getEffectiveDefaults } from "@/services/llm/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

function encodeSSE(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function heartbeat(): Uint8Array {
  return new TextEncoder().encode(": keepalive\n\n");
}

/** "Plan" phase of creating a script from a prompt. Creates nothing in the database. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json();
    if (!body.prompt || typeof body.prompt !== "string") return errorResponse("promptRequired", 400);

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
          const result = await planScriptStream(body.prompt, {
            provider: (body.provider as "opencode-go" | "openrouter") ?? defaults.provider,
            plannerModel: (body.plannerModel as string | undefined) ?? defaults.plannerModel,
            locale,
            signal,
            triggerKind,
            onToken: (t) => enqueue("token", { token: t }),
          });
          enqueue("done", result);
          controller.close();
        } catch (err) {
          try {
            enqueue("error", { error: err instanceof Error ? err.message : "Error" });
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