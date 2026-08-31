import { z } from "zod";

import { bridgeRpc } from "@/lib/app-runtime";
import { getApp } from "@/services/apps/apps";
import { defineTool } from "@/services/tools/define";

import { listConnections } from "./connections";
import { getMethod } from "./registry";

/** Connection tools exposed to the assistant and to MCP (single definition). */

export const connectionsTools = [
  defineTool({
    name: "list_connections",
    title: "List connections",
    description:
      "Lists the connected services (Google, SMTP, IMAP, Telegram, Notion, Home Assistant, weather, webhook) with their status. Credentials are never returned.",
    input: z.object({}),
    handler: async ({ userId }) => listConnections(userId),
  }),

  defineTool({
    name: "call_connection_method",
    title: "Call a connected service method",
    description:
      "Calls a method of a connected service. `method` has the form `namespace.method`, e.g. google.calendar.list, google.gmail.send, google.drive.list, mail.send, mail.search, telegram.send, notion.search, homeassistant.getStates, weather.current, webhook.call. Use this whenever the user wants to act on their external data (mail, calendar, weather, notifications…).",
    input: z.object({
      method: z.string().describe("Connection SDK method, e.g. google.calendar.list"),
      args: z
        .array(z.unknown())
        .optional()
        .describe("Positional arguments of the method (see the method description)"),
    }),
    handler: async ({ userId }, { method, args }) => {
      if (!getMethod(method)) {
        throw new Error(
          `Unknown connection method: ${method} (listing through getSdkDocs is unavailable — use list_connections then an SDK method).`,
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
    title: "Call an SDK method",
    description:
      "Escape hatch: calls any SDK method (storage.*, google.*, mail.*, telegram.*, ai.chat, http.fetch…). Requires the matching connection to be configured.",
    input: z.object({
      appId: z.string().describe("App to call on behalf of (for its storage / owner)"),
      method: z.string().describe("SDK method, e.g. storage.get, google.gmail.send, mail.send"),
      args: z.array(z.unknown()).optional().describe("Positional arguments of the method"),
    }),
    handler: async ({ userId }, { appId, method, args }) => {
      const app = await getApp(userId, appId);
      if (!app) return { error: "App not found." };
      const value = await bridgeRpc.handle(method, args ?? [], {
        appId,
        ownerId: app.ownerId,
      });
      return { ok: true, value };
    },
  }),
];
