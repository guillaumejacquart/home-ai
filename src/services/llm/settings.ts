import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { userSettings } from "@/db/schema";
import { env } from "@/lib/env";
import type { Locale } from "@/i18n/config";
import type { LlmProvider } from "@/services/llm/llm";

export type SettingsProvider = LlmProvider;

export interface UserSettings {
  provider: SettingsProvider | null;
  plannerModel: string | null;
  coderModel: string | null;
  assistantModel: string | null;
  locale: Locale | null;
  briefEnabled: boolean | null;
  briefHour: number | null;
  aiDailyTokenLimit: number | null;
  aiWeeklyTokenLimit: number | null;
  aiMonthlyTokenLimit: number | null;
}

export interface EffectiveDefaults {
  provider: SettingsProvider;
  plannerModel: string;
  coderModel: string;
  assistantModel: string;
}

const EMPTY: UserSettings = {
  provider: null,
  plannerModel: null,
  coderModel: null,
  assistantModel: null,
  locale: null,
  briefEnabled: null,
  briefHour: null,
  aiDailyTokenLimit: null,
  aiWeeklyTokenLimit: null,
  aiMonthlyTokenLimit: null,
};

/** Préférences utilisateur brutes (null = non définies par l'utilisateur). */
export async function getUserSettings(userId: string): Promise<UserSettings> {
  const row = await db
    .select({
      provider: userSettings.provider,
      plannerModel: userSettings.plannerModel,
      coderModel: userSettings.coderModel,
      assistantModel: userSettings.assistantModel,
      locale: userSettings.locale,
      briefEnabled: userSettings.briefEnabled,
      briefHour: userSettings.briefHour,
      aiDailyTokenLimit: userSettings.aiDailyTokenLimit,
      aiWeeklyTokenLimit: userSettings.aiWeeklyTokenLimit,
      aiMonthlyTokenLimit: userSettings.aiMonthlyTokenLimit,
    })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .get();

  if (!row) return EMPTY;
  return {
    provider: row.provider ?? null,
    plannerModel: row.plannerModel ?? null,
    coderModel: row.coderModel ?? null,
    assistantModel: row.assistantModel ?? null,
    locale: row.locale ?? null,
    briefEnabled: row.briefEnabled ?? null,
    briefHour: row.briefHour ?? null,
    aiDailyTokenLimit: row.aiDailyTokenLimit ?? null,
    aiWeeklyTokenLimit: row.aiWeeklyTokenLimit ?? null,
    aiMonthlyTokenLimit: row.aiMonthlyTokenLimit ?? null,
  };
}

/** Valeurs effectives utilisées pour la génération (préférence utilisateur sinon env). */
export async function getEffectiveDefaults(userId: string): Promise<EffectiveDefaults> {
  const settings = await getUserSettings(userId);
  return {
    provider: settings.provider ?? "opencode-go",
    plannerModel: settings.plannerModel ?? env.LLM_PLANNER_MODEL,
    coderModel: settings.coderModel ?? env.LLM_CODER_MODEL,
    assistantModel:
      settings.assistantModel ?? env.LLM_ASSISTANT_MODEL ?? env.LLM_PLANNER_MODEL,
  };
}

export interface UpdateSettingsPatch {
  provider?: SettingsProvider;
  plannerModel?: string | null;
  coderModel?: string | null;
  assistantModel?: string | null;
  locale?: Locale;
  briefEnabled?: boolean;
  briefHour?: number;
  aiDailyTokenLimit?: number | null;
  aiWeeklyTokenLimit?: number | null;
  aiMonthlyTokenLimit?: number | null;
}

/** Upsert des préférences utilisateur ; retourne les valeurs effectives sauvegardées. */
export async function updateUserSettings(
  userId: string,
  patch: UpdateSettingsPatch,
): Promise<EffectiveDefaults> {
  const hasPatch =
    patch.provider !== undefined ||
    patch.plannerModel !== undefined ||
    patch.coderModel !== undefined ||
    patch.assistantModel !== undefined ||
    patch.locale !== undefined ||
    patch.briefEnabled !== undefined ||
    patch.briefHour !== undefined ||
    patch.aiDailyTokenLimit !== undefined ||
    patch.aiWeeklyTokenLimit !== undefined ||
    patch.aiMonthlyTokenLimit !== undefined;

  if (!hasPatch) {
    return getEffectiveDefaults(userId);
  }

  const existing = await db
    .select({ userId: userSettings.userId })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .get();

  const now = new Date();

  if (!existing) {
    await db.insert(userSettings).values({
      userId,
      provider: patch.provider ?? null,
      plannerModel: patch.plannerModel ?? null,
      coderModel: patch.coderModel ?? null,
      assistantModel: patch.assistantModel ?? null,
      locale: patch.locale ?? null,
      briefEnabled: patch.briefEnabled ?? false,
      briefHour: patch.briefHour ?? 8,
      aiDailyTokenLimit: patch.aiDailyTokenLimit ?? null,
      aiWeeklyTokenLimit: patch.aiWeeklyTokenLimit ?? null,
      aiMonthlyTokenLimit: patch.aiMonthlyTokenLimit ?? null,
      updatedAt: now,
    });
  } else {
    await db
      .update(userSettings)
      .set({
        provider: patch.provider,
        plannerModel: patch.plannerModel,
        coderModel: patch.coderModel,
        assistantModel: patch.assistantModel,
        locale: patch.locale,
        briefEnabled: patch.briefEnabled,
        briefHour: patch.briefHour,
        aiDailyTokenLimit: patch.aiDailyTokenLimit,
        aiWeeklyTokenLimit: patch.aiWeeklyTokenLimit,
        aiMonthlyTokenLimit: patch.aiMonthlyTokenLimit,
        updatedAt: now,
      })
      .where(eq(userSettings.userId, userId));
  }

  return getEffectiveDefaults(userId);
}