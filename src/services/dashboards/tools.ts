import { z } from "zod";

import { appVisibility } from "@/db/schema";
import { defineTool } from "@/services/tools/define";

import {
  addDashboardWidget,
  createDashboard,
  deleteDashboard,
  getDashboard,
  listDashboards,
  removeDashboardWidget,
  updateDashboard,
} from "./dashboards";

/** Outils de tableaux de bord exposés à l'assistant et à MCP (définition unique). */

export const dashboardsTools = [
  defineTool({
    name: "list_dashboards",
    title: "Lister les tableaux de bord",
    description: "Liste les tableaux de bord accessibles (les siens + ceux en visibilité famille).",
    input: z.object({}),
    handler: async ({ userId }) => listDashboards(userId),
  }),

  defineTool({
    name: "get_dashboard",
    title: "Récupérer un tableau de bord",
    description: "Récupère un tableau de bord avec son layout (grille 12 colonnes et widgets).",
    input: z.object({ id: z.string().describe("Identifiant du tableau") }),
    handler: async ({ userId }, { id }) => getDashboard(userId, id),
  }),

  defineTool({
    name: "create_dashboard",
    title: "Créer un tableau de bord",
    description: "Crée un tableau de bord vide. Renvoie { id, slug }.",
    input: z.object({
      name: z.string().describe("Nom du tableau"),
      description: z.string().optional(),
      visibility: z.enum(appVisibility).optional(),
    }),
    handler: async ({ userId }, { name, description, visibility }) =>
      createDashboard(userId, { name, description, visibility }),
  }),

  defineTool({
    name: "update_dashboard",
    title: "Modifier un tableau de bord",
    description: "Modifie un tableau de bord (nom, description, visibilité).",
    input: z.object({
      id: z.string().describe("Identifiant du tableau"),
      name: z.string().optional(),
      description: z.string().optional(),
      visibility: z.enum(appVisibility).optional(),
    }),
    handler: async ({ userId }, { id, name, description, visibility }) => {
      await updateDashboard(userId, id, { name, description, visibility });
      return { ok: true };
    },
  }),

  defineTool({
    name: "delete_dashboard",
    title: "Supprimer un tableau de bord",
    description:
      "Supprime définitivement un tableau de bord. Action irréversible — confirmation utilisateur requise.",
    input: z.object({ id: z.string().describe("Identifiant du tableau") }),
    destructive: true,
    handler: async ({ userId }, { id }) => {
      await deleteDashboard(userId, id);
      return { ok: true };
    },
  }),

  defineTool({
    name: "add_dashboard_widget",
    title: "Ajouter un widget au tableau de bord",
    description:
      "Ajoute une app (déjà existante) à un tableau de bord, à la première place libre. La taille est en colonnes (w) et lignes (h).",
    input: z.object({
      dashboardId: z.string().describe("Identifiant du tableau"),
      appId: z.string().describe("Identifiant de l'app à afficher"),
      title: z.string().optional().describe("Titre du widget (optionnel)"),
      w: z.number().int().min(2).max(12).optional().describe("Largeur en colonnes (défaut 4)"),
      h: z.number().int().min(2).max(12).optional().describe("Hauteur en lignes (défaut 4)"),
    }),
    handler: async ({ userId }, { dashboardId, appId, title, w, h }) => {
      const widget = await addDashboardWidget(userId, dashboardId, appId, { title, w, h });
      return { ok: true, widget };
    },
  }),

  defineTool({
    name: "remove_dashboard_widget",
    title: "Retirer un widget du tableau de bord",
    description: "Retire un widget d'un tableau de bord (par son id de grille).",
    input: z.object({
      dashboardId: z.string().describe("Identifiant du tableau"),
      widgetId: z.string().describe("Identifiant du widget (champ i du layout)"),
    }),
    handler: async ({ userId }, { dashboardId, widgetId }) => {
      await removeDashboardWidget(userId, dashboardId, widgetId);
      return { ok: true };
    },
  }),
];
