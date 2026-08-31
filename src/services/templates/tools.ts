import { z } from "zod";

import { defineTool } from "@/services/tools/define";

import { getTemplate, installTemplate, listTemplates } from "./templates";

/** Outils de modèles d'apps exposés à l'assistant et à MCP (définition unique). */

export const templatesTools = [
  defineTool({
    name: "list_templates",
    title: "Lister les modèles d'apps",
    description:
      "Liste les modèles d'apps disponibles (apps préfabriquées à installer en un clic, ex. tâches, recettes).",
    input: z.object({}),
    handler: async () => listTemplates(),
  }),

  defineTool({
    name: "install_template",
    title: "Installer un modèle d'app",
    description:
      "Installe un modèle d'app : crée une nouvelle app à partir du modèle et de son code préfabriqué. Renvoie { id, slug } de l'app créée.",
    input: z.object({
      slug: z.string().describe("Identifiant du modèle (obtenu via list_templates)"),
      name: z.string().optional().describe("Nom personnalisé pour l'app installée (sinon celui du modèle)"),
    }),
    handler: async ({ userId }, { slug, name }) => {
      const tpl = getTemplate(slug);
      if (!tpl) return { error: "Modèle introuvable." };
      const app = await installTemplate(userId, slug, { name });
      return app;
    },
  }),
];
