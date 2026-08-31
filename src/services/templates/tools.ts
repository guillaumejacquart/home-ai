import { z } from "zod";

import { defineTool } from "@/services/tools/define";

import { getTemplate, installTemplate, listTemplates } from "./templates";

/** App-template tools exposed to the assistant and to MCP (single definition). */

export const templatesTools = [
  defineTool({
    name: "list_templates",
    title: "List app templates",
    description:
      "Lists the available app templates (prebuilt apps installable in one click, e.g. tasks, recipes).",
    input: z.object({}),
    handler: async () => listTemplates(),
  }),

  defineTool({
    name: "install_template",
    title: "Install an app template",
    description:
      "Installs an app template: creates a new app from the template and its prebuilt code. Returns { id, slug } of the created app.",
    input: z.object({
      slug: z.string().describe("Template id (from list_templates)"),
      name: z.string().optional().describe("Custom name for the installed app (otherwise the template's)"),
    }),
    handler: async ({ userId }, { slug, name }) => {
      const tpl = getTemplate(slug);
      if (!tpl) return { error: "Template not found." };
      const app = await installTemplate(userId, slug, { name });
      return app;
    },
  }),
];
