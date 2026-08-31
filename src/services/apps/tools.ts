import { z } from "zod";

import { appVisibility } from "@/db/schema";
import { codeApp, codeAppStream, planApp, planAppStream } from "@/services/generation/app";
import { getEffectiveDefaults } from "@/services/llm/settings";
import { defineTool } from "@/services/tools/define";

import { createApp, deleteApp, getApp, getAppBySlug, listApps, updateApp } from "./apps";
import { currentHtml } from "./versions";

/** App tools exposed to the assistant and to MCP (single definition). */

const APP_NOT_FOUND = { error: "App not found." };

export const appsTools = [
  defineTool({
    name: "list_apps",
    title: "List apps",
    description:
      "Lists the user's apps (their own plus those with family visibility), with id, slug, name, description, visibility and tags.",
    input: z.object({}),
    handler: async ({ userId }) => listApps(userId),
  }),

  defineTool({
    name: "get_app",
    title: "Get an app",
    description: "Gets an app by id or slug (metadata, without the HTML code).",
    // `.refine()` on a z.object() returns a ZodEffects, which is not assignable
    // to ToolInput.input (it requires a z.ZodObject), so the "id or slug"
    // constraint is checked in the handler rather than in the schema.
    input: z.object({
      id: z.string().optional().describe("App identifier"),
      slug: z.string().optional().describe("App slug"),
    }),
    handler: async ({ userId }, { id, slug }) => {
      if (!id && !slug) return { error: "Provide an id or a slug." };
      const app = id !== undefined ? await getApp(userId, id) : await getAppBySlug(userId, slug!);
      if (!app) return APP_NOT_FOUND;
      return app;
    },
  }),

  defineTool({
    name: "get_app_html",
    title: "Get an app's HTML",
    description: "Gets an app's current HTML code (to inspect or modify it).",
    input: z.object({ id: z.string().describe("App identifier") }),
    handler: async ({ userId }, { id }) => {
      const app = await getApp(userId, id);
      if (!app) return APP_NOT_FOUND;
      return { id: app.id, name: app.name, html: (await currentHtml(app.id)) ?? null };
    },
  }),

  defineTool({
    name: "create_app",
    title: "Create an app",
    description:
      "Creates an app skeleton (no code). Returns { id, slug }. To generate the code, use generate_app next.",
    input: z.object({
      name: z.string().describe("App name"),
      description: z.string().optional().describe("Short description"),
      hasUi: z.boolean().optional().describe("True if the app has a web UI"),
      slug: z.string().optional().describe("Custom slug (otherwise derived from the name)"),
    }),
    handler: async ({ userId }, { name, description, hasUi, slug }) =>
      createApp(userId, { name, description, hasUi, slug }),
  }),

  defineTool({
    name: "update_app",
    title: "Update an app",
    description: "Modifies an existing app (name, description, visibility, tags).",
    input: z.object({
      id: z.string().describe("App identifier"),
      name: z.string().optional(),
      description: z.string().optional(),
      visibility: z.enum(appVisibility).optional(),
      tags: z.array(z.string()).optional(),
    }),
    handler: async ({ userId }, { id, name, description, visibility, tags }) => {
      await updateApp(userId, id, { name, description, visibility, tags });
      return { ok: true };
    },
  }),

  defineTool({
    name: "delete_app",
    title: "Delete an app",
    description:
      "Permanently deletes an app and all its data (versions, storage, messages). Irreversible — user confirmation required.",
    input: z.object({ id: z.string().describe("App identifier") }),
    destructive: true,
    handler: async ({ userId }, { id }) => {
      await deleteApp(userId, id);
      return { ok: true };
    },
  }),

  defineTool({
    name: "plan_app",
    title: "Plan an app",
    description:
      "Generates a plan (summary JSON) to create or modify an app from a prompt. Use it before generate_app when you want to show the plan to the user for validation.",
    input: z.object({
      appId: z.string().describe("App identifier (obtained via create_app or list_apps)"),
      prompt: z.string().describe("Request in plain language"),
    }),
    handler: async ({ userId, locale, signal, onToken }, { appId, prompt }) => {
      const app = await getApp(userId, appId);
      if (!app) return APP_NOT_FOUND;
      const defaults = await getEffectiveDefaults(userId);
      const input = {
        name: app.name,
        description: app.description ?? undefined,
        slug: app.slug,
      };
      if (onToken) {
        const { plan, model } = await planAppStream(app.id, input, prompt, {
          provider: defaults.provider,
          plannerModel: defaults.plannerModel,
          locale,
          signal,
          onToken,
        });
        return { id: app.id, slug: app.slug, plan, model };
      }
      const { plan, model } = await planApp(app.id, input, prompt, {
        provider: defaults.provider,
        plannerModel: defaults.plannerModel,
        locale,
      });
      return { id: app.id, slug: app.slug, plan, model };
    },
  }),

  defineTool({
    name: "generate_app",
    title: "Generate an app from a prompt",
    description:
      "Generates or updates an existing app's HTML code from a plain-language prompt. Long operation (planning + generation). If a user-validated plan is available (from plan_app), pass it to avoid re-planning.",
    input: z.object({
      appId: z.string().describe("App identifier (obtained via create_app or list_apps)"),
      prompt: z.string().describe("Request in plain language"),
      // The plan travels as text, but models happily return the object from the
      // previous plan_app, so we accept it and serialise it.
      plan: z
        .union([z.string(), z.record(z.string(), z.unknown())])
        .optional()
        .transform((v) => (typeof v === "object" && v !== null ? JSON.stringify(v) : v))
        .describe("Plan already validated by the user — text, or the object returned by plan_app (optional)"),
    }),
    handler: async ({ userId, locale, signal, onToken }, { appId, prompt, plan }) => {
      const app = await getApp(userId, appId);
      if (!app) return APP_NOT_FOUND;
      const defaults = await getEffectiveDefaults(userId);
      const input = {
        name: app.name,
        description: app.description ?? undefined,
        slug: app.slug,
      };
      let finalPlan = plan?.trim() ? plan : null;
      if (!finalPlan) {
        if (onToken) {
          const planned = await planAppStream(app.id, input, prompt, {
            provider: defaults.provider,
            plannerModel: defaults.plannerModel,
            locale,
            signal,
            onToken,
          });
          finalPlan = planned.plan;
        } else {
          const planned = await planApp(app.id, input, prompt, {
            provider: defaults.provider,
            plannerModel: defaults.plannerModel,
            locale,
          });
          finalPlan = planned.plan;
        }
      }
      if (onToken) {
        const result = await codeAppStream(app.id, input, prompt, finalPlan!, {
          provider: defaults.provider,
          coderModel: defaults.coderModel,
          locale,
          signal,
          onToken,
        });
        return { id: app.id, slug: app.slug, version: result.version, plan: finalPlan };
      }
      const result = await codeApp(app.id, input, prompt, finalPlan!, {
        provider: defaults.provider,
        coderModel: defaults.coderModel,
        locale,
      });
      return { id: app.id, slug: app.slug, version: result.version, plan: finalPlan };
    },
  }),
];
