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

/** Storage tools exposed to the assistant and to MCP (single definition). */

const appIdSchema = z.string().describe("App identifier");
const visibilitySchema = z
  .enum(appVisibility)
  .optional()
  .describe("Visibility (defaults to private)");
const kindSchema = z.enum(storageKind).optional().describe("Key kind (defaults to kv)");

/** Resolves the app while checking access; `null` when it is not visible. */
async function scopeForApp(userId: string, appId: string) {
  const app = await getApp(userId, appId);
  return app ? appScope(app.id) : null;
}

const APP_NOT_FOUND = { error: "App not found." };

export const storageTools = [
  defineTool({
    name: "app_storage_list",
    title: "List an app's storage",
    description:
      "Lists an app's storage keys (with their JSON value and their kv/table kind).",
    input: z.object({ appId: appIdSchema }),
    handler: async ({ userId }, { appId }) => {
      const scope = await scopeForApp(userId, appId);
      return scope ? storageList(scope) : APP_NOT_FOUND;
    },
  }),

  defineTool({
    name: "app_storage_get",
    title: "Read a key from an app's storage",
    description:
      "Reads a key from an app's storage. Returns the stored JSON value (null when absent).",
    input: z.object({
      appId: appIdSchema,
      key: z.string().describe("Storage key, e.g. todos"),
    }),
    handler: async ({ userId }, { appId, key }) => {
      const scope = await scopeForApp(userId, appId);
      if (!scope) return APP_NOT_FOUND;
      return { key, value: await storageGet(scope, key) };
    },
  }),

  defineTool({
    name: "app_storage_set",
    title: "Write to an app's storage",
    description:
      "Writes a value into an app's storage (JSON KV). Replaces the existing value. kind can be \"table\" when the value is an array of homogeneous objects.",
    input: z.object({
      appId: appIdSchema,
      key: z.string().describe("Storage key, e.g. todos"),
      value: z.unknown().describe("JSON value to store"),
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
    title: "Delete a key from an app's storage",
    description:
      "Deletes a key from an app's storage. Irreversible — user confirmation required.",
    input: z.object({
      appId: appIdSchema,
      key: z.string().describe("Storage key to delete"),
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
    title: "List global storage",
    description:
      "Lists the keys of the global storage shared across all apps (their own plus those with family visibility), with value and kind.",
    input: z.object({}),
    handler: async ({ userId }) => storageList(globalScope(userId)),
  }),

  defineTool({
    name: "global_storage_get",
    title: "Read a key from global storage",
    description:
      "Reads a key from the shared global storage. Returns the stored JSON value (null when absent).",
    input: z.object({
      key: z.string().describe("Global storage key, e.g. household-todos"),
    }),
    handler: async ({ userId }, { key }) => ({
      key,
      value: await storageGet(globalScope(userId), key),
    }),
  }),

  defineTool({
    name: "global_storage_set",
    title: "Write to global storage",
    description:
      "Writes a value into the global storage shared across apps. visibility private (me only) or family (every account). kind \"table\" when the value is an array of objects.",
    input: z.object({
      key: z.string().describe("Global storage key"),
      value: z.unknown().describe("JSON value to store"),
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
    title: "Delete a key from global storage",
    description:
      "Deletes a key from global storage (owner only). Irreversible — user confirmation required.",
    input: z.object({
      key: z.string().describe("Global storage key to delete"),
    }),
    destructive: true,
    handler: async ({ userId }, { key }) => {
      await storageDelete(globalScope(userId), key);
      return { ok: true };
    },
  }),
];
