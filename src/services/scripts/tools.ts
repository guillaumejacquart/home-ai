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

/** Outils scripts (jobs serveur) exposés à l'assistant et à MCP (définition unique). */

const triggerKindSchema = z.enum(scriptTriggerKind);
const visibilitySchema = z.enum(appVisibility);

const SCRIPT_NOT_FOUND = { error: "Script introuvable." };
export const scriptsTools = [
  defineTool({
    name: "list_scripts",
    title: "Lister les scripts",
    description:
      "Liste les scripts (jobs serveur) accessibles (les siens + ceux en visibilité famille), avec trigger (schedule/manuel/webhook), état activé/désactivé et prochaines exécutions.",
    input: z.object({}),
    handler: async ({ userId }) => listScripts(userId),
  }),

  defineTool({
    name: "create_script",
    title: "Créer un script",
    description:
      "Crée un script serveur (job). Le code est une fonction JS `async function main(home) {}` utilisant le SDK home (home.storage, home.mail, home.google.*, home.http…). Le script a son propre stockage (`home.storage`) ; pour lire ou écrire le stockage d'une app, utiliser `home.app(<appId>).storage`. triggerKind : schedule (planifié, nécessite un schedule en expression cron 5 champs), manual (déclenché à la demande), webhook (déclenché par un POST public sur /api/hooks/<slug>).",
    input: z.object({
      name: z.string().describe("Nom du script"),
      triggerKind: triggerKindSchema.optional().describe("Déclenchement (défaut schedule)"),
      schedule: z
        .string()
        .optional()
        .describe("Expression cron 5 champs (obligatoire si triggerKind = schedule)"),
      code: z.string().describe("Code JS : async function main(home) {}"),
      visibility: visibilitySchema.optional().describe("Visibilité (défaut private)"),
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
    title: "Générer un script depuis un prompt",
    description:
      "Génère un script serveur complet à partir d'un prompt, puis le crée. Renvoie l'id ET le code généré — inutile de relire le script ensuite. Opération longue. triggerKind : schedule (planifié, défaut), manual (à la demande), webhook (POST public).",
    input: z.object({
      prompt: z.string().describe("Demande en langage naturel"),
      triggerKind: triggerKindSchema.optional().describe("Déclenchement (défaut schedule)"),
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
        content: `Script : ${prompt}`,
      });
      await addGenerationMessage({
        ownerId: userId,
        appId: null,
        scriptId: id,
        role: "assistant",
        content: `Script généré : ${generated.name} — ${generated.schedule || "déclenchement " + tk}\n\`\`\`js\n${generated.code}\n\`\`\``,
        model: generated.coderModel,
      });
      return { id, name: generated.name, schedule: generated.schedule, triggerKind: tk, code: generated.code };
    },
  }),

  defineTool({
    name: "get_script",
    title: "Lire un script",
    description:
      "Lit un script existant avec son code complet. À utiliser avant update_script pour partir du code réel.",
    input: z.object({ id: z.string().describe("Identifiant du script") }),
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
    title: "Modifier un script",
    description:
      "Modifie un script existant (nom, trigger, schedule, code, état activé/désactivé, visibilité).",
    input: z.object({
      id: z.string().describe("Identifiant du script"),
      name: z.string().optional(),
      triggerKind: triggerKindSchema.optional(),
      schedule: z.string().optional().describe("Expression cron 5 champs (si trigger = schedule)"),
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
    title: "Supprimer un script",
    description:
      "Supprime définitivement un script (code, versions, historique). Action irréversible — confirmation utilisateur requise.",
    input: z.object({ id: z.string().describe("Identifiant du script") }),
    destructive: true,
    handler: async ({ userId }, { id }) => {
      await deleteScript(userId, id);
      return { ok: true };
    },
  }),

  defineTool({
    name: "run_script",
    title: "Exécuter un script",
    description:
      "Déclenche immédiatement l'exécution d'un script (effets de bord sur les services externes). Confirmation utilisateur requise.",
    input: z.object({ id: z.string().describe("Identifiant du script") }),
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
    title: "Lister les exécutions d'un script",
    description: "Liste les dernières exécutions d'un script (statut, durée, erreur).",
    input: z.object({
      scriptId: z.string().describe("Identifiant du script"),
      limit: z.number().int().min(1).max(100).optional().describe("Nombre de runs (défaut 10)"),
    }),
    handler: async ({ userId }, { scriptId, limit }) => {
      const row = await getScript(scriptId, userId);
      if (!row) return SCRIPT_NOT_FOUND;
      return listScriptRuns(scriptId, limit ?? 10);
    },
  }),

  defineTool({
    name: "plan_script",
    title: "Planifier un script",
    description:
      "Génère un plan (JSON sommaire) pour créer ou modifier un script (job serveur) à partir d'un prompt. À utiliser avant generate_script/code_script quand tu veux montrer le plan à l'utilisateur.",
    input: z.object({
      prompt: z.string().describe("Demande en langage naturel"),
      scriptId: z.string().optional().describe("Script existant à modifier (sinon création)"),
      triggerKind: triggerKindSchema
        .optional()
        .describe(
          "Déclenchement : schedule (planifié, défaut), manual (à la demande), webhook (POST public)",
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
