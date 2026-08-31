import { z } from "zod";

import { generateBrief } from "@/services/agent/brief";
import { addMemory, deleteMemory, listMemory } from "@/services/agent/memory";
import { getPlatformOverview } from "@/services/agent/overview";
import { defineTool } from "@/services/tools/define";
import { getUserStateGraph } from "@/services/user-state/graph";

/**
 * The assistant's own tools (memory, overview, brief, user state), migrated to
 * the shared registry. Exposed on both surfaces
 * (assistant and MCP) — no `exposure` restriction.
 */

export const assistantOwnTools = [
  defineTool({
    name: "memory_list",
    title: "List memories",
    description: "Lists the memories recorded about the user (facts, preferences, projects).",
    input: z.object({}),
    handler: async ({ userId }) => listMemory(userId),
  }),

  defineTool({
    name: "memory_save",
    title: "Save a memory",
    description:
      "Saves a durable memory about the user. Use this tool when the user explicitly asks you to remember something.",
    input: z.object({
      kind: z
        .enum(["fact", "preference", "project"])
        .optional()
        .describe("Memory kind (defaults to fact)"),
      content: z.string().describe("Memory content, one short sentence in the user's language"),
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
    title: "Delete a memory",
    description: "Deletes a memory by its id.",
    input: z.object({ id: z.string().describe("Memory identifier") }),
    handler: async ({ userId }, { id }) => {
      await deleteMemory(userId, id);
      return { ok: true };
    },
  }),

  defineTool({
    name: "platform_overview",
    title: "Platform overview",
    description:
      "Whole-platform overview in a single call: counts, apps, scripts (health, upcoming runs, latest errors), dashboards, connections, recent storage, memories and recent threads. Use this tool when the user wants to know what is going on, or when you need global context without chaining 6 calls.",
    input: z.object({}),
    handler: async ({ userId }) => getPlatformOverview(userId),
  }),

  defineTool({
    name: "generate_brief",
    title: "Generate the daily brief",
    description:
      'Generates the daily brief (Markdown) from the overview plus calendar/weather when connected, and stores it in the pinned "Journal" thread. Returns { threadId, content }. Ideal for "what is going on today?" or for the scheduled daily reminder.',
    input: z.object({}),
    handler: async ({ userId, locale }) => generateBrief(userId, locale),
  }),

  defineTool({
    name: "user_state_graph",
    title: "User state graph",
    description:
      "Graph view of the user's state: links between durable memory, apps, scripts, storage, routines (schedules read in plain language) and signals (script/connection health, interests). Use this tool when the user asks \"what do you know about me?\", \"what are my projects or interests?\", \"what are my routines?\", or to personalise an answer with their context.",
    input: z.object({}),
    handler: async ({ userId }) => getUserStateGraph(userId),
  }),
];
