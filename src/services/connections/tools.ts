import { z } from "zod";

import { bridgeRpc } from "@/lib/app-runtime";
import { getApp } from "@/services/apps/apps";
import { defineTool } from "@/services/tools/define";

import { listConnections } from "./connections";
import { getMethod } from "./registry";

/** Outils de connexions exposés à l'assistant et à MCP (définition unique). */

export const connectionsTools = [
  defineTool({
    name: "list_connections",
    title: "Lister les connexions",
    description:
      "Liste les services connectés (Google, SMTP, IMAP, Telegram, Notion, Home Assistant, météo, webhook) avec leur statut. Les identifiants ne sont jamais renvoyés.",
    input: z.object({}),
    handler: async ({ userId }) => listConnections(userId),
  }),

  defineTool({
    name: "call_connection_method",
    title: "Appeler une méthode d'un service connecté",
    description:
      "Appelle une méthode d'un service connecté. method est au format `namespace.méthode`, ex. google.calendar.list, google.gmail.send, google.drive.list, mail.send, mail.search, telegram.send, notion.search, homeassistant.getStates, weather.current, webhook.call. Utilise cette capacité quand l'utilisateur veut agir sur ses données externes (mails, agenda, météo, notifications…).",
    input: z.object({
      method: z.string().describe("Méthode SDK de connexion, ex. google.calendar.list"),
      args: z
        .array(z.unknown())
        .optional()
        .describe("Arguments positionnels de la méthode (voir la description de la méthode)"),
    }),
    handler: async ({ userId }, { method, args }) => {
      if (!getMethod(method)) {
        throw new Error(
          `Méthode de connexion inconnue : ${method} (liste via getSdkDocs non disponible — utilise list_connections puis une méthode du SDK).`,
        );
      }
      return bridgeRpc.handle(method, args ?? [], {
        appId: "",
        ownerId: userId,
      });
    },
  }),

  defineTool({
    name: "call_rpc",
    title: "Appeler une méthode SDK",
    description:
      "Espace de secours : appelle n'importe quelle méthode du SDK (storage.*, google.*, mail.*, telegram.*, ai.chat, http.fetch…). Nécessite que la connexion correspondante soit configurée.",
    input: z.object({
      appId: z.string().describe("App au nom de laquelle appeler (pour son stockage / propriétaire)"),
      method: z.string().describe("Méthode SDK, ex. storage.get, google.gmail.send, mail.send"),
      args: z.array(z.unknown()).optional().describe("Arguments positionnels de la méthode"),
    }),
    handler: async ({ userId }, { appId, method, args }) => {
      const app = await getApp(userId, appId);
      if (!app) return { error: "App introuvable." };
      const value = await bridgeRpc.handle(method, args ?? [], {
        appId,
        ownerId: app.ownerId,
      });
      return { ok: true, value };
    },
  }),
];
