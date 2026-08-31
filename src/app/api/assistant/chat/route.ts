import { createUIMessageStreamResponse, validateUIMessages } from "ai";
import { z } from "zod";

import { errorResponse } from "@/lib/api-helpers";
import { route } from "@/lib/route";
import { isLocale } from "@/i18n/config";
import { getApp } from "@/services/apps/apps";
import { getScript } from "@/services/scripts/scripts";
import { ensureThread, messageText } from "@/services/agent/threads";
import { runTurn } from "@/services/agent/turn";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Un appel du coder peut légitimement durer plusieurs minutes (budget 240 s
// côté LLM). Pense au proxy en amont : nginx proxy_read_timeout, traefik
// respondingTimeouts.
export const maxDuration = 600;

const MAX_PROMPT_CHARS = 32_000;
const TITLE_FROM_PROMPT = 80;

const storageScopeSchema = z.object({
  scope: z.enum(["app", "global", "script"]),
  key: z.string().min(1),
  appId: z.string().nullish(),
  scriptId: z.string().nullish(),
});

const bodySchema = z.object({
  /** Id du fil, généré par le client et stable d'un tour à l'autre. */
  id: z.string().min(1, "invalidBody"),
  /** Dernier message seulement : le serveur détient l'historique. */
  message: z.unknown(),
  scope: z
    .object({
      appId: z.string().nullish(),
      scriptId: z.string().nullish(),
      storage: storageScopeSchema.nullish(),
    })
    .nullish(),
  locale: z.unknown().optional(),
});

export const POST = route({
  body: bodySchema,
  handler: async ({ user, body, req }) => {
    const [userMessage] = await validateUIMessages({ messages: [body.message] }).catch(() => []);
    if (!userMessage || userMessage.role !== "user") return errorResponse("invalidBody", 400);

    const text = messageText(userMessage);
    if (!text) return errorResponse("promptRequired", 400);
    if (text.length > MAX_PROMPT_CHARS) return errorResponse("promptTooLong", 413);

    // L'accès au scope est vérifié ici : le prompt système va en exposer le contenu.
    const scope = body.scope ?? null;
    if (scope?.appId && !(await getApp(user.id, scope.appId))) {
      return errorResponse("appNotFound", 404);
    }
    if (scope?.scriptId && !(await getScript(scope.scriptId, user.id))) {
      return errorResponse("scriptNotFound", 404);
    }

    const context = scope?.scriptId
      ? { contextKind: "script" as const, contextId: scope.scriptId }
      : scope?.appId
        ? { contextKind: "app" as const, contextId: scope.appId }
        : undefined;

    const { thread, created } = await ensureThread(
      user.id,
      body.id,
      text.slice(0, TITLE_FROM_PROMPT),
      context,
    );

    const stream = await runTurn({
      userId: user.id,
      thread,
      userMessage,
      scope,
      locale: isLocale(body.locale) ? body.locale : "fr",
      isNewThread: created,
      signal: req.signal,
    });

    return createUIMessageStreamResponse({ stream });
  },
});
