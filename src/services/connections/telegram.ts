import { z } from "zod";

import type { ConnectionProvider } from "@/services/connections/definition";

const TELEGRAM_API = "https://api.telegram.org";

export const telegramSchema = z.object({
  botToken: z.string().min(1, "Bot token requis"),
  defaultChatId: z.string().optional(),
});

export type TelegramConfig = z.infer<typeof telegramSchema>;
export interface TelegramConfigLegacy {
  botToken: string;
  defaultChatId?: string;
}

function apiUrl(cfg: TelegramConfig, method: string): string {
  return `${TELEGRAM_API}/bot${cfg.botToken}/${method}`;
}

export async function testTelegram(cfg: TelegramConfig): Promise<string> {
  const res = await fetch(apiUrl(cfg, "getMe"));
  const data = (await res.json()) as { ok: boolean; result?: { username?: string }; description?: string };
  if (!data.ok) throw new Error(data.description ?? "Telegram : token invalide");
  const username = data.result?.username ? `@${data.result.username}` : "bot";
  return `Telegram : connexion OK — ${username}`;
}

export async function telegramSend(
  cfg: TelegramConfig,
  input: { chatId?: string; text: string; parseMode?: "Markdown" | "MarkdownV2" | "HTML" },
): Promise<{ messageId: number }> {
  const chatId = input.chatId ?? cfg.defaultChatId;
  if (!chatId) throw new Error("chatId manquant (renseignez le chat par défaut ou passez chatId).");
  if (!input.text?.trim()) throw new Error("text manquant.");
  const res = await fetch(apiUrl(cfg, "sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: input.text,
      parse_mode: input.parseMode,
    }),
  });
  const data = (await res.json()) as { ok: boolean; result?: { message_id: number }; description?: string };
  if (!data.ok) throw new Error(data.description ?? "Échec d'envoi Telegram");
  return { messageId: data.result?.message_id ?? 0 };
}

export async function telegramGetUpdates(
  cfg: TelegramConfig,
  limit = 5,
): Promise<{ updates: unknown[] }> {
  const res = await fetch(apiUrl(cfg, `getUpdates?limit=${limit}`));
  const data = (await res.json()) as { ok: boolean; result?: unknown[]; description?: string };
  if (!data.ok) throw new Error(data.description ?? "Échec getUpdates");
  return { updates: data.result ?? [] };
}

export const telegramProvider = {
  type: "telegram",
  label: "Telegram",
  schema: telegramSchema,
  test: testTelegram,
  sdk: {
    namespace: "telegram",
    methods: {
      send: telegramSend as (cfg: TelegramConfig, ...args: unknown[]) => Promise<unknown>,
      getUpdates: telegramGetUpdates as (cfg: TelegramConfig, ...args: unknown[]) => Promise<unknown>,
    },
  },
  ui: { icon: "Bot", descriptionKey: "providerTelegramDescription" },
} satisfies ConnectionProvider<TelegramConfig>;
