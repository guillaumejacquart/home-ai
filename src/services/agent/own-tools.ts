import { z } from "zod";

import { generateBrief } from "@/services/agent/brief";
import { addMemory, deleteMemory, listMemory } from "@/services/agent/memory";
import { getPlatformOverview } from "@/services/agent/overview";
import { defineTool } from "@/services/tools/define";
import { getUserStateGraph } from "@/services/user-state/graph";

/**
 * Outils propres à l'assistant (mémoire, vue d'ensemble, brief, état
 * utilisateur), migrés vers le registre partagé. Exposés aux deux surfaces
 * (assistant et MCP) — pas de restriction `exposure`.
 */

export const assistantOwnTools = [
  defineTool({
    name: "memory_list",
    title: "Lister les souvenirs",
    description: "Liste les souvenirs enregistrés sur l'utilisateur (faits, préférences, projets).",
    input: z.object({}),
    handler: async ({ userId }) => listMemory(userId),
  }),

  defineTool({
    name: "memory_save",
    title: "Enregistrer un souvenir",
    description:
      "Enregistre un souvenir durable sur l'utilisateur. Utilise ce tool quand l'utilisateur te demande explicitement de retenir quelque chose.",
    input: z.object({
      kind: z
        .enum(["fact", "preference", "project"])
        .optional()
        .describe("Type de souvenir (défaut fact)"),
      content: z.string().describe("Contenu du souvenir, une phrase courte en français"),
    }),
    handler: async ({ userId }, { kind, content }) =>
      addMemory(userId, {
        kind,
        content,
        source: "assistant",
      }),
  }),

  defineTool({
    name: "memory_delete",
    title: "Supprimer un souvenir",
    description: "Supprime un souvenir par son id.",
    input: z.object({ id: z.string().describe("Identifiant du souvenir") }),
    handler: async ({ userId }, { id }) => {
      await deleteMemory(userId, id);
      return { ok: true };
    },
  }),

  defineTool({
    name: "platform_overview",
    title: "Vue d'ensemble de la plateforme",
    description:
      "Vue d'ensemble de la plateforme en un appel : comptes, apps, scripts (santé, prochaines exécutions, dernières erreurs), tableaux, connexions, stockages récents, souvenirs et threads récents. Utilise ce tool quand l'utilisateur veut savoir ce qui se passe ou que tu as besoin de contexte global sans enchaîner 6 appels.",
    input: z.object({}),
    handler: async ({ userId }) => getPlatformOverview(userId),
  }),

  defineTool({
    name: "generate_brief",
    title: "Générer le brief quotidien",
    description:
      'Génère le brief quotidien (Markdown) à partir de la vue d\'ensemble + agenda/météo si connectés, et l\'enregistre dans le fil "Journal" épinglé. Renvoie { threadId, content }. Idéal pour "que se passe-t-il aujourd\'hui ?" ou pour le rappel quotidien planifié.',
    input: z.object({}),
    handler: async ({ userId, locale }) => generateBrief(userId, locale),
  }),

  defineTool({
    name: "user_state_graph",
    title: "Graphe d'état de l'utilisateur",
    description:
      "Vue graphe de l'état de l'utilisateur : liens entre mémoire durable, apps, scripts, stockage, routines (planifications lues en langage naturel) et signaux (santé des scripts/connexions, intérêts). Utilise ce tool quand l'utilisateur demande « que sais-tu de moi ? », « quels sont mes projets ou intérêts ? », « quelles sont mes routines ? », ou pour personnaliser une réponse avec son contexte.",
    input: z.object({}),
    handler: async ({ userId }) => getUserStateGraph(userId),
  }),
];
