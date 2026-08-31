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

/** Dashboard tools exposed to the assistant and to MCP (single definition). */

export const dashboardsTools = [
  defineTool({
    name: "list_dashboards",
    title: "List dashboards",
    description: "Lists the accessible dashboards (their own plus those with family visibility).",
    input: z.object({}),
    handler: async ({ userId }) => listDashboards(userId),
  }),

  defineTool({
    name: "get_dashboard",
    title: "Get a dashboard",
    description: "Gets a dashboard with its layout (12-column grid and widgets).",
    input: z.object({ id: z.string().describe("Dashboard identifier") }),
    handler: async ({ userId }, { id }) => getDashboard(userId, id),
  }),

  defineTool({
    name: "create_dashboard",
    title: "Create a dashboard",
    description: "Creates an empty dashboard. Returns { id, slug }.",
    input: z.object({
      name: z.string().describe("Dashboard name"),
      description: z.string().optional(),
      visibility: z.enum(appVisibility).optional(),
    }),
    handler: async ({ userId }, { name, description, visibility }) =>
      createDashboard(userId, { name, description, visibility }),
  }),

  defineTool({
    name: "update_dashboard",
    title: "Update a dashboard",
    description: "Modifies a dashboard (name, description, visibility).",
    input: z.object({
      id: z.string().describe("Dashboard identifier"),
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
    title: "Delete a dashboard",
    description:
      "Permanently deletes a dashboard. Irreversible — user confirmation required.",
    input: z.object({ id: z.string().describe("Dashboard identifier") }),
    destructive: true,
    handler: async ({ userId }, { id }) => {
      await deleteDashboard(userId, id);
      return { ok: true };
    },
  }),

  defineTool({
    name: "add_dashboard_widget",
    title: "Add a widget to the dashboard",
    description:
      "Adds an existing app to a dashboard, in the first free slot. The size is in columns (w) and rows (h).",
    input: z.object({
      dashboardId: z.string().describe("Dashboard identifier"),
      appId: z.string().describe("Id of the app to display"),
      title: z.string().optional().describe("Widget title (optional)"),
      w: z.number().int().min(2).max(12).optional().describe("Width in columns (defaults to 4)"),
      h: z.number().int().min(2).max(12).optional().describe("Height in rows (defaults to 4)"),
    }),
    handler: async ({ userId }, { dashboardId, appId, title, w, h }) => {
      const widget = await addDashboardWidget(userId, dashboardId, appId, { title, w, h });
      return { ok: true, widget };
    },
  }),

  defineTool({
    name: "remove_dashboard_widget",
    title: "Remove a widget from the dashboard",
    description: "Removes a widget from a dashboard (by its grid id).",
    input: z.object({
      dashboardId: z.string().describe("Dashboard identifier"),
      widgetId: z.string().describe("Widget identifier (layout's i field)"),
    }),
    handler: async ({ userId }, { dashboardId, widgetId }) => {
      await removeDashboardWidget(userId, dashboardId, widgetId);
      return { ok: true };
    },
  }),
];
