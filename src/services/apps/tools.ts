import { z } from "zod";

import { appVisibility } from "@/db/schema";
import { codeApp, codeAppStream, planApp, planAppStream } from "@/services/generation/app";
import { getEffectiveDefaults } from "@/services/llm/settings";
import { defineTool } from "@/services/tools/define";

import { createApp, deleteApp, getApp, getAppBySlug, listApps, updateApp } from "./apps";
import { currentHtml } from "./versions";

/** Outils sur les apps exposés à l'assistant et à MCP (définition unique). */

const APP_NOT_FOUND = { error: "App introuvable." };

export const appsTools = [
  defineTool({
    name: "list_apps",
    title: "Lister les apps",
    description:
      "Liste les apps de l'utilisateur (les siennes + celles en visibilité famille), avec id, slug, nom, description, visibilité et étiquettes.",
    input: z.object({}),
    handler: async ({ userId }) => listApps(userId),
  }),

  defineTool({
    name: "get_app",
    title: "Récupérer une app",
    description: "Récupère une app par id ou slug (métadonnées, sans le code HTML).",
    // `.refine()` sur un z.object() renvoie un ZodEffects, non assignable à
    // ToolInput.input (qui exige un z.ZodObject) : la contrainte « id ou slug »
    // est donc vérifiée dans le handler plutôt que dans le schéma.
    input: z.object({
      id: z.string().optional().describe("Identifiant de l'app"),
      slug: z.string().optional().describe("Slug de l'app"),
    }),
    handler: async ({ userId }, { id, slug }) => {
      if (!id && !slug) return { error: "Fournis un id ou un slug." };
      const app = id !== undefined ? await getApp(userId, id) : await getAppBySlug(userId, slug!);
      if (!app) return APP_NOT_FOUND;
      return app;
    },
  }),

  defineTool({
    name: "get_app_html",
    title: "Récupérer le HTML d'une app",
    description: "Récupère le code HTML actuel d'une app (pour l'inspecter ou le modifier).",
    input: z.object({ id: z.string().describe("Identifiant de l'app") }),
    handler: async ({ userId }, { id }) => {
      const app = await getApp(userId, id);
      if (!app) return APP_NOT_FOUND;
      return { id: app.id, name: app.name, html: (await currentHtml(app.id)) ?? null };
    },
  }),

  defineTool({
    name: "create_app",
    title: "Créer une app",
    description:
      "Crée le squelette d'une app (sans code). Renvoie { id, slug }. Pour générer le code, utilise generate_app ensuite.",
    input: z.object({
      name: z.string().describe("Nom de l'app"),
      description: z.string().optional().describe("Description courte"),
      hasUi: z.boolean().optional().describe("Vrai si l'app a une interface web"),
      slug: z.string().optional().describe("Slug personnalisé (sinon dérivé du nom)"),
    }),
    handler: async ({ userId }, { name, description, hasUi, slug }) =>
      createApp(userId, { name, description, hasUi, slug }),
  }),

  defineTool({
    name: "update_app",
    title: "Modifier une app",
    description: "Modifie une app existante (nom, description, visibilité, étiquettes).",
    input: z.object({
      id: z.string().describe("Identifiant de l'app"),
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
    title: "Supprimer une app",
    description:
      "Supprime définitivement une app et toutes ses données (versions, stockage, messages). Action irréversible — confirmation utilisateur requise.",
    input: z.object({ id: z.string().describe("Identifiant de l'app") }),
    destructive: true,
    handler: async ({ userId }, { id }) => {
      await deleteApp(userId, id);
      return { ok: true };
    },
  }),

  defineTool({
    name: "plan_app",
    title: "Planifier une app",
    description:
      "Génère un plan (JSON sommaire) pour créer ou modifier une app à partir d'un prompt. À utiliser avant generate_app quand tu veux montrer le plan à l'utilisateur pour validation.",
    input: z.object({
      appId: z.string().describe("Identifiant de l'app (obtenu via create_app ou list_apps)"),
      prompt: z.string().describe("Demande en langage naturel"),
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
    title: "Générer une app depuis un prompt",
    description:
      "Génère ou met à jour le code HTML d'une app existante à partir d'un prompt en langage naturel. Opération longue (planification + génération). Si un plan validé par l'utilisateur est disponible (obtenu via plan_app), fournis-le pour éviter une re-planification.",
    input: z.object({
      appId: z.string().describe("Identifiant de l'app (obtenu via create_app ou list_apps)"),
      prompt: z.string().describe("Demande en langage naturel"),
      // Le plan circule en texte, mais les modèles renvoient volontiers l'objet
      // du plan_app précédent : on l'accepte et on le sérialise.
      plan: z
        .union([z.string(), z.record(z.string(), z.unknown())])
        .optional()
        .transform((v) => (typeof v === "object" && v !== null ? JSON.stringify(v) : v))
        .describe("Plan déjà validé par l'utilisateur — texte, ou l'objet renvoyé par plan_app (optionnel)"),
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
