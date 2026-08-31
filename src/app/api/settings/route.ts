import { NextResponse } from "next/server";
import { z } from "zod";

import { isLocale, LOCALE_COOKIE, type Locale } from "@/i18n/config";
import { env } from "@/lib/env";
import { route } from "@/lib/route";
import { requirePermission } from "@/lib/session";
import { clearApiKey, keySource, setApiKey, type LlmProvider } from "@/services/llm/llm";
import { getEffectiveDefaults, getUserSettings, updateUserSettings } from "@/services/llm/settings";

const PROVIDER_IDS: LlmProvider[] = ["opencode-go", "openrouter"];

export const GET = route({
  handler: async ({ user }) => {
    const defaults = await getEffectiveDefaults(user.id);
    const {
      locale,
      briefEnabled,
      briefHour,
      aiDailyTokenLimit,
      aiWeeklyTokenLimit,
      aiMonthlyTokenLimit,
    } = await getUserSettings(user.id);
    const providers = await Promise.all(
      PROVIDER_IDS.map(async (id) => ({
        id,
        baseUrl:
          id === "opencode-go"
            ? env.OPENCODE_BASE_URL.replace(/\/$/, "")
            : env.OPENROUTER_BASE_URL.replace(/\/$/, ""),
        source: await keySource(id),
      })),
    );
    return {
      defaults,
      locale,
      providers,
      brief: { enabled: briefEnabled ?? false, hour: briefHour ?? 8 },
      quotas: {
        daily: aiDailyTokenLimit ?? null,
        weekly: aiWeeklyTokenLimit ?? null,
        monthly: aiMonthlyTokenLimit ?? null,
      },
    };
  },
});

/** Champ modèle : absent = inchangé, vide/non-chaîne = remise à la valeur par défaut. */
const modelSchema = z
  .unknown()
  .transform((v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null))
  .optional();

/** Quota : absent = inchangé, null/""/0 = illimité, sinon entier positif. */
const quotaSchema = z
  .unknown()
  .transform((v, ctx) => {
    if (v === null || v === "" || v === 0 || v === "0") return null;
    const n = typeof v === "string" ? Number(v) : v;
    if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) {
      ctx.addIssue({ code: "custom", message: "invalidContent" });
      return z.NEVER;
    }
    return n;
  })
  .optional();

export const PUT = route({
  body: z.object({
    provider: z.enum(["opencode-go", "openrouter"], "invalidProvider").nullish(),
    plannerModel: modelSchema,
    coderModel: modelSchema,
    assistantModel: modelSchema,
    locale: z.custom<Locale>(isLocale, "invalidLocale").optional(),
    briefEnabled: z.boolean("invalidContent").optional(),
    briefHour: z
      .number("invalidContent")
      .int("invalidContent")
      .min(0, "invalidContent")
      .max(23, "invalidContent")
      .optional(),
    aiDailyTokenLimit: quotaSchema,
    aiWeeklyTokenLimit: quotaSchema,
    aiMonthlyTokenLimit: quotaSchema,
    apiKeys: z.record(z.string(), z.unknown()).optional(),
  }),
  handler: async ({ user, body }) => {
    const { apiKeys, provider, locale, ...rest } = body;
    const defaults = await updateUserSettings(user.id, {
      ...rest,
      provider: provider ?? undefined,
      locale,
    });

    // Clés API : réglage plateforme, réservé aux admins.
    // {"opencode-go": "sk-...", "openrouter": null}
    // Une chaîne vide/null supprime la clé en base (retour à l'env).
    if (apiKeys) {
      await requirePermission("platform.settings");
      for (const id of PROVIDER_IDS) {
        const value = apiKeys[id];
        if (typeof value === "string" && value.trim() !== "") await setApiKey(id, value.trim());
        else if (value === null || value === "") await clearApiKey(id);
      }
    }

    const res = NextResponse.json({ ok: true, defaults, locale });
    if (locale) {
      // Le cookie évite une lecture en base à chaque rendu (cf. src/i18n/request.ts).
      res.cookies.set(LOCALE_COOKIE, locale, {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
        sameSite: "lax",
      });
    }
    return res;
  },
});
