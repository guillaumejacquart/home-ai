import { z } from "zod";

import { appVisibility, storageKind } from "@/db/schema";
import { getApp } from "@/services/apps/apps";
import { defineTool } from "@/services/tools/define";

import {
  appScope,
  globalScope,
  storageDelete,
  storageGet,
  storageList,
  storageSet,
} from "./storage";

/** Outils de stockage exposés à l'assistant et à MCP (définition unique). */

const appIdSchema = z.string().describe("Identifiant de l'app");
const visibilitySchema = z
  .enum(appVisibility)
  .optional()
  .describe("Visibilité (défaut private)");
const kindSchema = z.enum(storageKind).optional().describe("Type de la clé (défaut kv)");

/** Résout l'app en vérifiant l'accès ; `null` si elle n'est pas visible. */
async function scopeForApp(userId: string, appId: string) {
  const app = await getApp(userId, appId);
  return app ? appScope(app.id) : null;
}

const APP_NOT_FOUND = { error: "App introuvable." };

export const storageTools = [
  defineTool({
    name: "app_storage_list",
    title: "Lister le stockage d'une app",
    description:
      "Liste les clés du stockage d'une app (avec leur valeur JSON et leur type kv/table).",
    input: z.object({ appId: appIdSchema }),
    handler: async ({ userId }, { appId }) => {
      const scope = await scopeForApp(userId, appId);
      return scope ? storageList(scope) : APP_NOT_FOUND;
    },
  }),

  defineTool({
    name: "app_storage_get",
    title: "Lire une clé du stockage d'une app",
    description:
      "Lit une clé du stockage d'une app. Renvoie la valeur JSON stockée (null si absente).",
    input: z.object({
      appId: appIdSchema,
      key: z.string().describe("Clé du stockage, ex. todos"),
    }),
    handler: async ({ userId }, { appId, key }) => {
      const scope = await scopeForApp(userId, appId);
      if (!scope) return APP_NOT_FOUND;
      return { key, value: await storageGet(scope, key) };
    },
  }),

  defineTool({
    name: "app_storage_set",
    title: "Écrire dans le stockage d'une app",
    description:
      "Écrit une valeur dans le stockage d'une app (KV JSON). Remplace la valeur existante. kind peut être « table » si la valeur est un tableau d'objets homogènes.",
    input: z.object({
      appId: appIdSchema,
      key: z.string().describe("Clé du stockage, ex. todos"),
      value: z.unknown().describe("Valeur JSON à stocker"),
      kind: kindSchema,
    }),
    handler: async ({ userId }, { appId, key, value, kind }) => {
      const scope = await scopeForApp(userId, appId);
      if (!scope) return APP_NOT_FOUND;
      await storageSet(scope, key, value, { kind });
      return { ok: true };
    },
  }),

  defineTool({
    name: "app_storage_remove",
    title: "Supprimer une clé du stockage d'une app",
    description:
      "Supprime une clé du stockage d'une app. Action irréversible — confirmation utilisateur requise.",
    input: z.object({
      appId: appIdSchema,
      key: z.string().describe("Clé du stockage à supprimer"),
    }),
    destructive: true,
    handler: async ({ userId }, { appId, key }) => {
      const scope = await scopeForApp(userId, appId);
      if (!scope) return APP_NOT_FOUND;
      await storageDelete(scope, key);
      return { ok: true };
    },
  }),

  defineTool({
    name: "global_storage_list",
    title: "Lister le stockage global",
    description:
      "Liste les clés du stockage global partagé entre toutes les apps (les siennes + celles en visibilité famille), avec valeur et type.",
    input: z.object({}),
    handler: async ({ userId }) => storageList(globalScope(userId)),
  }),

  defineTool({
    name: "global_storage_get",
    title: "Lire une clé du stockage global",
    description:
      "Lit une clé du stockage global partagé. Renvoie la valeur JSON stockée (null si absente).",
    input: z.object({
      key: z.string().describe("Clé du stockage global, ex. todos-famille"),
    }),
    handler: async ({ userId }, { key }) => ({
      key,
      value: await storageGet(globalScope(userId), key),
    }),
  }),

  defineTool({
    name: "global_storage_set",
    title: "Écrire dans le stockage global",
    description:
      "Écrit une valeur dans le stockage global partagé entre les apps. visibility private (moi seul) ou family (tous les comptes). kind « table » si la valeur est un tableau d'objets.",
    input: z.object({
      key: z.string().describe("Clé du stockage global"),
      value: z.unknown().describe("Valeur JSON à stocker"),
      visibility: visibilitySchema,
      kind: kindSchema,
    }),
    handler: async ({ userId }, { key, value, visibility, kind }) => {
      await storageSet(globalScope(userId), key, value, { visibility, kind });
      return { ok: true };
    },
  }),

  defineTool({
    name: "global_storage_remove",
    title: "Supprimer une clé du stockage global",
    description:
      "Supprime une clé du stockage global (réservé au propriétaire). Action irréversible — confirmation utilisateur requise.",
    input: z.object({
      key: z.string().describe("Clé du stockage global à supprimer"),
    }),
    destructive: true,
    handler: async ({ userId }, { key }) => {
      await storageDelete(globalScope(userId), key);
      return { ok: true };
    },
  }),
];
