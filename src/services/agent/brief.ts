import { eq } from "drizzle-orm";

import { db, tables } from "@/db/client";
import type { Locale } from "@/i18n/config";
import { chatCompletion } from "@/services/llm/llm";
import { getEffectiveDefaults } from "@/services/llm/settings";
import { getPlatformOverview } from "@/services/agent/overview";
import {
  appendMessage,
  getOrCreateThreadForContext,
  loadMessages,
  messageText,
} from "@/services/agent/threads";
import { bridgeRpc } from "@/lib/app-runtime";
import { getMethod } from "@/services/connections/registry";
import { listConnections } from "@/services/connections/connections";

const JOURNAL_TITLE = "Journal";

export async function getOrCreateJournalThread(userId: string): Promise<string> {
  // Le fil est identifié par son contexte, pas par son titre : l'utilisateur
  // peut renommer « Journal » sans qu'on en recrée un à chaque brief.
  return getOrCreateThreadForContext(userId, "journal", userId, JOURNAL_TITLE);
}

function buildBriefPrompt(overview: Awaited<ReturnType<typeof getPlatformOverview>>, locale: Locale, extra: { calendar?: unknown; weather?: unknown }): string {
  const date = new Date().toLocaleDateString(locale === "en" ? "en-US" : "fr-FR", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const overviewJson = JSON.stringify(overview, null, 2);
  const extraJson = extra.calendar || extra.weather ? `\nDonnées externes (best-effort) :\n- Agenda: ${JSON.stringify(extra.calendar ?? null).slice(0, 1500)}\n- Météo: ${JSON.stringify(extra.weather ?? null).slice(0, 800)}` : "";
  const lang = locale === "en" ? "English" : "français";
  return `Tu es l'assistant home-ai. Génère un brief quotidien concis en ${lang} pour le ${date}.

Données plateforme (JSON) :
${overviewJson}
${extraJson}

Consignes :
- Format Markdown, en ${lang}, concis et actionnable.
- Sections : ## En bref (3-4 lignes), ## Apps & Scripts (santé, prochains runs, échecs), ## Stockage récent, ## Mémoire, ## À faire / suggestions (2-3 idées d'apps/scripts à créer si pertinent).
- Si un script est en échec ou désactivée, signale-le.
- Si aucune donnée notable, dis-le simplement.
- Pas de bla-bla, pas d'emojis excessifs, ton clair et utile.
- Termine par une phrase courte d'encouragement ou une question ouverte.`;
}

async function fetchExternalBestEffort(userId: string): Promise<{ calendar?: unknown; weather?: unknown }> {
  const out: { calendar?: unknown; weather?: unknown } = {};
  try {
    const conns = await listConnections(userId);
    const hasGoogle = conns.some((c) => c.type === "google" && c.status === "active");
    const hasWeather = conns.some((c) => c.type === "weather" && c.status === "active");
    if (hasGoogle && getMethod("google.calendar.list")) {
      try {
        // Try to list today's events: use calendarId primary, timeMin = today 00:00 UTC, timeMax = tomorrow 00:00
        const today = new Date();
        const start = new Date(today);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        const res = await bridgeRpc.handle("google.calendar.list", [{ calendarId: "primary", timeMin: start.toISOString(), timeMax: end.toISOString(), maxResults: 10 }], { appId: "", ownerId: userId });
        out.calendar = res;
      } catch {
        // ignore
      }
    }
    if (hasWeather && getMethod("weather.current")) {
      try {
        const res = await bridgeRpc.handle("weather.current", [], { appId: "", ownerId: userId });
        out.weather = res;
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
  return out;
}

export async function generateBrief(userId: string, locale: Locale = "fr"): Promise<{ threadId: string; content: string }> {
  const overview = await getPlatformOverview(userId);
  const defaults = await getEffectiveDefaults(userId);
  const extra = await fetchExternalBestEffort(userId);

  const prompt = buildBriefPrompt(overview, locale, extra);

  let content: string;
  try {
    content = await chatCompletion([{ role: "user", content: prompt }], {
      provider: defaults.provider,
      model: defaults.assistantModel,
      maxTokens: 1200,
      temperature: 0.4,
      userId,
      feature: "brief",
    });
  } catch {
    // Fallback simple
    const counts = overview.counts;
    content = `## Brief du ${new Date().toLocaleDateString(locale === "en" ? "en-US" : "fr-FR")}\n\nEn bref : ${counts.apps} apps, ${counts.scripts} scripts (${counts.scriptsEnabled} actifs), ${counts.dashboards} tableaux, ${counts.connections} connexions.\n\n${overview.scriptsHealth.some((c) => c.lastStatus === "error") ? "⚠️ Certains scripts sont en échec — vérifie les logs." : "Tout semble à jour."}\n`;
  }

  const trimmed = content.trim();
  const threadId = await getOrCreateJournalThread(userId);
  const now = new Date();

  // Deux briefs identiques le même jour (redémarrage, double cron) : on n'ajoute rien.
  const existing = await loadMessages(threadId).catch(() => []);
  const lastAssistant = [...existing].reverse().find((m) => m.role === "assistant");
  if (lastAssistant && messageText(lastAssistant) === trimmed) {
    return { threadId, content: trimmed };
  }

  await appendMessage(
    threadId,
    { role: "assistant", parts: [{ type: "text", text: trimmed }] },
    { model: defaults.assistantModel },
  );

  // Update last run
  try {
    await db
      .update(tables.userSettings)
      .set({ briefLastRunAt: now, updatedAt: now })
      .where(eq(tables.userSettings.userId, userId));
  } catch {
    // if no row, create? settings update will handle later
  }

  return { threadId, content: trimmed };
}

export async function shouldGenerateBriefForUser(userId: string): Promise<boolean> {
  const row = await db.select().from(tables.userSettings).where(eq(tables.userSettings.userId, userId)).get();
  if (!row || !row.briefEnabled) return false;
  const last = row.briefLastRunAt as Date | null | undefined;
  const now = new Date();
  const hour = row.briefHour ?? 8;
  const currentHour = now.getHours();
  if (currentHour < hour) return false;
  if (!last) return true;
  const lastDate = new Date(last);
  const sameDay =
    lastDate.getFullYear() === now.getFullYear() &&
    lastDate.getMonth() === now.getMonth() &&
    lastDate.getDate() === now.getDate();
  if (sameDay) return false;
  // Ensure at least 20h gap to avoid double run on restart
  const diffMs = now.getTime() - lastDate.getTime();
  if (diffMs < 20 * 60 * 60 * 1000) return false;
  return true;
}

export async function runDueBriefs(): Promise<number> {
  const rows = await db.select().from(tables.userSettings).where(eq(tables.userSettings.briefEnabled, true)).all();
  let count = 0;
  for (const row of rows) {
    try {
      const should = await shouldGenerateBriefForUser(row.userId);
      if (!should) continue;
      await generateBrief(row.userId, (row.locale as Locale) ?? "fr");
      count++;
    } catch (err) {
      console.error("[brief] failed for", row.userId, err);
    }
  }
  return count;
}
