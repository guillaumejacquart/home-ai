import { NextRequest } from "next/server";
import { getLocale } from "next-intl/server";

import { apiError, errorResponse } from "@/lib/api-helpers";
import { requireUser } from "@/lib/session";
import { getApp } from "@/services/apps/apps";
import { planAppStream } from "@/services/generation/app";
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

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const app = await getApp(user.id, id);
    if (!app) return errorResponse("appNotFound", 404);
    const body = await req.json();
    if (!body.prompt || typeof body.prompt !== "string") return errorResponse("promptRequired", 400);
    const defaults = await getEffectiveDefaults(user.id);
    const locale = await getLocale();
    const provider = (body.provider as "opencode-go" | "openrouter") ?? defaults.provider;
    const plannerModel = (body.plannerModel as string | undefined) ?? defaults.plannerModel;
    const signal = req.signal;

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
          const result = await planAppStream(
            id,
            { name: app.name, description: app.description ?? undefined, slug: app.slug },
            body.prompt,
            { provider, plannerModel, locale, signal, onToken: (t) => enqueue("token", { token: t }) },
          );
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
