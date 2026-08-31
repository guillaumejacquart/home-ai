import { NextRequest } from "next/server";

import { apiError, errorResponse } from "@/lib/api-helpers";
import { requireUser } from "@/lib/session";
import { getApp } from "@/services/apps/apps";

type Params = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

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
    const method = String(body.method ?? "");
    const args = Array.isArray(body.args) ? body.args : [];

    // For non-AI methods, just bridge without streaming (still over SSE, to keep a uniform shape)
    const isAi = method === "ai.chat" || method === "ai.messages";
    if (!isAi) {
      const { bridgeRpc } = await import("@/lib/app-runtime");
      try {
        const value = await bridgeRpc.handle(method, args, { appId: id, ownerId: app.ownerId });
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encodeSSE("done", { value }));
            controller.close();
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
        const msg = err instanceof Error ? err.message : "Error";
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encodeSSE("error", { error: msg }));
            controller.close();
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
      }
    }

    // AI streaming
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
          const { sanitizeChatMessages, chatCompletionStream } = await import("@/services/llm/llm");
          const { getEffectiveDefaults } = await import("@/services/llm/settings");
          const defaults = await getEffectiveDefaults(app.ownerId);

          let messages: { role: "system" | "user" | "assistant"; content: string }[] = [];
          let opts: { temperature?: number; maxTokens?: number } = {};
          if (method === "ai.chat") {
            const prompt = String(args[0] ?? "");
            if (!prompt.trim()) throw new Error("Empty AI prompt.");
            const o = args[1] as { system?: string; temperature?: number; maxTokens?: number } | undefined;
            if (o?.system) messages.push({ role: "system", content: String(o.system) });
            messages.push({ role: "user", content: prompt });
            opts = { temperature: o?.temperature, maxTokens: o?.maxTokens };
          } else {
            const o = args[1] as { temperature?: number; maxTokens?: number } | undefined;
            messages = sanitizeChatMessages(args[0]);
            opts = { temperature: o?.temperature, maxTokens: o?.maxTokens };
          }

          const { text } = await chatCompletionStream(messages, {
            provider: defaults.provider,
            model: defaults.coderModel,
            temperature: opts.temperature,
            maxTokens: opts.maxTokens,
            signal,
            onToken: (tok) => enqueue("token", { token: tok }),
            userId: app.ownerId,
            feature: "ai_sdk_app",
            appId: id,
          });

          // Tokens are already streamed; this just signals the end. The full value is accumulated on the iframe side.
          enqueue("done", { value: text });
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
