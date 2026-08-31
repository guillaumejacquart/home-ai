import { z } from "zod";

import { appVisibility, scriptTriggerKind } from "@/db/schema";
import { getEffectiveDefaults } from "@/services/llm/settings";
import { addGenerationMessage } from "@/services/messages/chat";
import {
  generateScript,
  generateScriptStream,
  planScript,
  planScriptStream,
} from "@/services/generation/script";
import { listScriptRuns, runScript } from "@/services/scripts/runner";
import {
  createScript,
  deleteScript,
  getScript,
  listScripts,
  updateScript,
} from "@/services/scripts/scripts";
import { defineTool } from "@/services/tools/define";

/** Script (server job) tools exposed to the assistant and to MCP (single definition). */

const triggerKindSchema = z.enum(scriptTriggerKind);
const visibilitySchema = z.enum(appVisibility);

const SCRIPT_NOT_FOUND = { error: "Script not found." };
export const scriptsTools = [
  defineTool({
    name: "list_scripts",
    title: "List scripts",
    description:
      "Lists the accessible scripts (server jobs) — their own plus those with family visibility — with trigger (schedule/manual/webhook), enabled state and upcoming runs.",
    input: z.object({}),
    handler: async ({ userId }) => listScripts(userId),
  }),

  defineTool({
    name: "create_script",
    title: "Create a script",
    description:
      "Creates a server script (job). The code is a JS `async function main(home) {}` using the home SDK (home.storage, home.mail, home.google.*, home.http…). The script has its own storage (`home.storage`); to read or write an app's storage, use `home.app(<appId>).storage`. triggerKind: schedule (needs a 5-field cron schedule), manual (triggered on demand), webhook (triggered by a public POST to /api/hooks/<slug>).",
    input: z.object({
      name: z.string().describe("Script name"),
      triggerKind: triggerKindSchema.optional().describe("Trigger (defaults to schedule)"),
      schedule: z
        .string()
        .optional()
        .describe("5-field cron expression (required if triggerKind = schedule)"),
      code: z.string().describe("JS code: async function main(home) {}"),
      visibility: visibilitySchema.optional().describe("Visibility (defaults to private)"),
    }),
    handler: async ({ userId }, { name, triggerKind, schedule, code, visibility }) => {
      const id = await createScript({
        ownerId: userId,
        visibility: visibility ?? "private",
        triggerKind: triggerKind ?? "schedule",
        name,
        schedule: schedule ?? "",
        code,
      });
      return { id };
    },
  }),

  defineTool({
    name: "generate_script",
    title: "Generate a script from a prompt",
    description:
      "Generates a complete server script from a prompt, then creates it. Returns the id AND the generated code — no need to read the script back afterwards. Long operation. triggerKind: schedule (default), manual (on demand), webhook (public POST).",
    input: z.object({
      prompt: z.string().describe("Request in plain language"),
      triggerKind: triggerKindSchema.optional().describe("Trigger (defaults to schedule)"),
      visibility: visibilitySchema.optional(),
    }),
    handler: async ({ userId, signal, onToken }, { prompt, triggerKind, visibility }) => {
      const defaults = await getEffectiveDefaults(userId);
      const tk = triggerKind ?? "schedule";
      const generated = onToken
        ? await generateScriptStream(prompt, {
            provider: defaults.provider,
            coderModel: defaults.coderModel,
            locale: "fr",
            triggerKind: tk,
            signal,
            onToken,
          })
        : await generateScript(prompt, {
            provider: defaults.provider,
            coderModel: defaults.coderModel,
            locale: "fr",
            triggerKind: tk,
          });
      const id = await createScript({
        ownerId: userId,
        visibility: visibility ?? "private",
        triggerKind: tk,
        name: generated.name,
        schedule: generated.schedule,
        code: generated.code,
        prompt,
      });
      await addGenerationMessage({
        ownerId: userId,
        appId: null,
        scriptId: id,
        role: "user",
        content: `Script: ${prompt}`,
      });
      await addGenerationMessage({
        ownerId: userId,
        appId: null,
        scriptId: id,
        role: "assistant",
        content: `Script generated: ${generated.name} — ${generated.schedule || "trigger " + tk}\n\`\`\`js\n${generated.code}\n\`\`\``,
        model: generated.coderModel,
      });
      return { id, name: generated.name, schedule: generated.schedule, triggerKind: tk, code: generated.code };
    },
  }),

  defineTool({
    name: "get_script",
    title: "Read a script",
    description:
      "Reads an existing script with its full code. Use it before update_script so you start from the real code.",
    input: z.object({ id: z.string().describe("Script identifier") }),
    handler: async ({ userId }, { id }) => {
      const script = await getScript(id, userId);
      if (!script) return SCRIPT_NOT_FOUND;
      return {
        id: script.id,
        name: script.name,
        triggerKind: script.triggerKind,
        schedule: script.schedule,
        webhookSlug: script.webhookSlug,
        enabled: script.enabled,
        visibility: script.visibility,
        code: script.code,
      };
    },
  }),

  defineTool({
    name: "update_script",
    title: "Update a script",
    description:
      "Modifies an existing script (name, trigger, schedule, code, enabled state, visibility).",
    input: z.object({
      id: z.string().describe("Script identifier"),
      name: z.string().optional(),
      triggerKind: triggerKindSchema.optional(),
      schedule: z.string().optional().describe("5-field cron expression (if trigger = schedule)"),
      code: z.string().optional(),
      enabled: z.boolean().optional(),
      visibility: visibilitySchema.optional(),
    }),
    handler: async (
      { userId },
      { id, name, triggerKind, schedule, code, enabled, visibility },
    ) => {
      await updateScript(userId, id, {
        name,
        triggerKind,
        schedule,
        code,
        enabled,
        visibility,
      });
      return { ok: true };
    },
  }),

  defineTool({
    name: "delete_script",
    title: "Delete a script",
    description:
      "Permanently deletes a script (code, versions, history). Irreversible — user confirmation required.",
    input: z.object({ id: z.string().describe("Script identifier") }),
    destructive: true,
    handler: async ({ userId }, { id }) => {
      await deleteScript(userId, id);
      return { ok: true };
    },
  }),

  defineTool({
    name: "run_script",
    title: "Run a script",
    description:
      "Immediately triggers a script run (side effects on external services). User confirmation required.",
    input: z.object({ id: z.string().describe("Script identifier") }),
    destructive: true,
    handler: async ({ userId }, { id }) => {
      const row = await getScript(id, userId);
      if (!row) return SCRIPT_NOT_FOUND;
      const { status } = await runScript(id);
      return { status };
    },
  }),

  defineTool({
    name: "list_script_runs",
    title: "List a script's runs",
    description: "Lists a script's latest runs (status, duration, error).",
    input: z.object({
      scriptId: z.string().describe("Script identifier"),
      limit: z.number().int().min(1).max(100).optional().describe("Number of runs (defaults to 10)"),
    }),
    handler: async ({ userId }, { scriptId, limit }) => {
      const row = await getScript(scriptId, userId);
      if (!row) return SCRIPT_NOT_FOUND;
      return listScriptRuns(scriptId, limit ?? 10);
    },
  }),

  defineTool({
    name: "plan_script",
    title: "Plan a script",
    description:
      "Generates a plan (summary JSON) to create or modify a script (server job) from a prompt. Use it before generate_script/code_script when you want to show the plan to the user.",
    input: z.object({
      prompt: z.string().describe("Request in plain language"),
      scriptId: z.string().optional().describe("Existing script to modify (otherwise a creation)"),
      triggerKind: triggerKindSchema
        .optional()
        .describe(
          "Trigger: schedule (default), manual (on demand), webhook (public POST)",
        ),
    }),
    handler: async ({ userId, locale, signal, onToken }, { prompt, scriptId, triggerKind }) => {
      const defaults = await getEffectiveDefaults(userId);
      let current: { name: string; schedule: string; code: string } | null = null;
      let isIterating = false;
      if (scriptId) {
        const row = await getScript(scriptId, userId);
        if (!row) return SCRIPT_NOT_FOUND;
        current = { name: row.name, schedule: row.schedule, code: row.code };
        isIterating = true;
      }
      if (onToken) {
        const result = await planScriptStream(prompt, {
          provider: defaults.provider,
          plannerModel: defaults.plannerModel,
          locale,
          isIterating,
          triggerKind: triggerKind ?? "schedule",
          current,
          signal,
          onToken,
        });
        return { plan: result.plan, model: result.model, current };
      }
      const result = await planScript(prompt, {
        provider: defaults.provider,
        plannerModel: defaults.plannerModel,
        locale,
        isIterating,
        triggerKind: triggerKind ?? "schedule",
        current,
      });
      return { plan: result.plan, model: result.model, current };
    },
  }),
];
