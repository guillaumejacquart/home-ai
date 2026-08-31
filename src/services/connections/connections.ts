import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { db, tables } from "@/db/client";
import type { ConnectionType } from "@/db/schema";
import { decryptJson, encryptJson, type EncryptedPayload } from "@/lib/crypto";
import { HttpError } from "@/lib/errors";
import type { GoogleConfig } from "@/services/connections/google";
import type { ImapConfig, SmtpConfig } from "@/services/connections/email";
import type { HomeAssistantConfig } from "@/services/connections/homeassistant";
import type { NotionConfig } from "@/services/connections/notion";
import type { TelegramConfig } from "@/services/connections/telegram";
import type { WeatherConfig } from "@/services/connections/weather";
import type { WebhookConfig } from "@/services/connections/webhook";
import { getProvider } from "@/services/connections/registry";

export type ConnectionConfig =
  | { type: "google"; data: GoogleConfig }
  | { type: "smtp"; data: SmtpConfig }
  | { type: "imap"; data: ImapConfig }
  | { type: "telegram"; data: TelegramConfig }
  | { type: "notion"; data: NotionConfig }
  | { type: "homeassistant"; data: HomeAssistantConfig }
  | { type: "weather"; data: WeatherConfig }
  | { type: "webhook"; data: WebhookConfig };

export type NewConnectionInput =
  | { type: "smtp"; label: string; data: SmtpConfig }
  | { type: "imap"; label: string; data: ImapConfig }
  | { type: "telegram"; label: string; data: TelegramConfig }
  | { type: "notion"; label: string; data: NotionConfig }
  | { type: "homeassistant"; label: string; data: HomeAssistantConfig }
  | { type: "weather"; label: string; data: WeatherConfig }
  | { type: "webhook"; label: string; data: WebhookConfig };

export class ConnectionError extends HttpError {
  constructor(message: string) {
    super(message, 400);
  }
}

function now() {
  return new Date();
}

function encryptConfig(input: NewConnectionInput): EncryptedPayload {
  const provider = getProvider(input.type as ConnectionType);
  if (provider) {
    const parsed = provider.schema.safeParse(input.data);
    if (!parsed.success) {
      throw new ConnectionError(parsed.error.issues[0]?.message ?? "Config invalide");
    }
    return encryptJson({ type: input.type, data: parsed.data });
  }
  return encryptJson({ type: input.type, data: input.data });
}

export async function listConnections(userId: string) {
  const rows = await db
    .select()
    .from(tables.connections)
    .where(eq(tables.connections.userId, userId))
    .orderBy(desc(tables.connections.createdAt));
  return rows.map(withoutConfig);
}

function withoutConfig(row: {
  id: string;
  type: ConnectionType;
  label: string;
  status: string;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    type: row.type,
    label: row.label,
    status: row.status,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getConnection(userId: string, id: string) {
  const row = await db
    .select()
    .from(tables.connections)
    .where(and(eq(tables.connections.id, id), eq(tables.connections.userId, userId)))
    .get();
  return row;
}

function readConfig(row: {
  type: ConnectionType;
  config: EncryptedPayload;
}): ConnectionConfig {
  const parsed = decryptJson<ConnectionConfig>(row.config);
  if (parsed.type !== row.type) {
    throw new ConnectionError("Config incohérente avec le type de connexion.");
  }
  return parsed;
}

export async function createConnection(
  userId: string,
  input: NewConnectionInput,
) {
  const id = randomUUID();
  await db.insert(tables.connections).values({
    id,
    userId,
    type: input.type,
    label: input.label,
    config: encryptConfig(input),
    status: "active",
    createdAt: now(),
    updatedAt: now(),
  });
  return id;
}

/** Crée (ou met à jour) une connexion Google à partir des tokens OAuth. */
export async function upsertGoogleConnection(
  userId: string,
  label: string,
  data: GoogleConfig,
) {
  const existing = await db
    .select({ id: tables.connections.id })
    .from(tables.connections)
    .where(
      and(
        eq(tables.connections.userId, userId),
        eq(tables.connections.type, "google"),
      ),
    )
    .get();

  const config = encryptJson({ type: "google", data });

  if (existing) {
    await db
      .update(tables.connections)
      .set({ label, config, status: "active", updatedAt: now() })
      .where(eq(tables.connections.id, existing.id));
    return existing.id;
  }
  const id = randomUUID();
  await db.insert(tables.connections).values({
    id,
    userId,
    type: "google",
    label,
    config,
    status: "active",
    createdAt: now(),
    updatedAt: now(),
  });
  return id;
}

export async function deleteConnection(userId: string, id: string) {
  await db
    .delete(tables.connections)
    .where(and(eq(tables.connections.id, id), eq(tables.connections.userId, userId)));
}

export async function updateLabel(
  userId: string,
  id: string,
  label: string,
) {
  await db
    .update(tables.connections)
    .set({ label, updatedAt: now() })
    .where(and(eq(tables.connections.id, id), eq(tables.connections.userId, userId)));
}

/**
 * Retourne la config déchiffrée de la première connexion d'un type pour un
 * utilisateur (utilisée par le SDK des apps : résolution par le propriétaire).
 * Si le provider expose `resolve` (Google), le jeton est rafraîchi et persisté.
 */
export async function getConnectionConfigByType(
  userId: string,
  type: ConnectionType,
): Promise<ConnectionConfig | null> {
  const row = await db
    .select()
    .from(tables.connections)
    .where(and(eq(tables.connections.userId, userId), eq(tables.connections.type, type)))
    .get();
  if (!row) return null;

  const cfg = readConfig(row) as ConnectionConfig;
  const provider = getProvider(type);
  if (provider?.resolve) {
    const fresh = (await provider.resolve(cfg.data as never)) as typeof cfg.data;
    if (fresh !== cfg.data) {
      await db
        .update(tables.connections)
        .set({ config: encryptJson({ type, data: fresh } as unknown as NewConnectionInput), updatedAt: now() })
        .where(eq(tables.connections.id, row.id));
      return { type, data: fresh } as ConnectionConfig;
    }
  }
  return cfg;
}

/** Teste une connexion et met à jour son statut. Délègue au provider via registry. */
export async function testConnection(userId: string, id: string): Promise<string> {
  const row = await getConnection(userId, id);
  if (!row) throw new ConnectionError("Connexion introuvable.");

  try {
    const cfg = readConfig(row) as ConnectionConfig;
    const provider = getProvider(row.type as ConnectionType);
    if (!provider) throw new Error(`Provider inconnu: ${row.type}`);

    // Pour Google, on passe par resolve avant test
    let data: unknown = cfg.data;
    if (provider.resolve) {
      data = await provider.resolve(data as never);
      if (data !== cfg.data) {
        await db
          .update(tables.connections)
          .set({
            config: encryptJson({ type: row.type, data } as unknown as NewConnectionInput),
            updatedAt: now(),
          })
          .where(eq(tables.connections.id, id));
      }
    }
    const message = await provider.test(data as never);

    await db
      .update(tables.connections)
      .set({ status: "active", lastError: null, updatedAt: now() })
      .where(eq(tables.connections.id, id));
    return message;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    await db
      .update(tables.connections)
      .set({ status: "error", lastError: message, updatedAt: now() })
      .where(eq(tables.connections.id, id));
    throw new ConnectionError(message);
  }
}
