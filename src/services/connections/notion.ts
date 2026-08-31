import { z } from "zod";

import type { ConnectionProvider } from "@/services/connections/definition";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

export const notionSchema = z.object({
  apiKey: z.string().min(1, "Clé API Notion requise"),
});

export type NotionConfig = z.infer<typeof notionSchema>;
export interface NotionConfigLegacy {
  apiKey: string;
}

function headers(cfg: NotionConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${cfg.apiKey}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

export async function testNotion(cfg: NotionConfig): Promise<string> {
  const res = await fetch(`${NOTION_API}/users/me`, { headers: headers(cfg) });
  const data = (await res.json()) as { object?: string; name?: string; id?: string; message?: string };
  if (!res.ok) throw new Error(data.message ?? `Notion : échec (${res.status})`);
  const name = data.name ?? data.id ?? "ok";
  return `Notion : connexion OK — ${name}`;
}

export async function notionSearch(
  cfg: NotionConfig,
  query: string,
  pageSize = 20,
): Promise<{ results: { id: string; title: string; object: string }[] }> {
  const res = await fetch(`${NOTION_API}/search`, {
    method: "POST",
    headers: headers(cfg),
    body: JSON.stringify({ query, page_size: pageSize }),
  });
  const data = (await res.json()) as {
    results?: { id: string; object: string; properties?: Record<string, unknown> }[];
    message?: string;
  };
  if (!res.ok) throw new Error(data.message ?? `Notion search échec (${res.status})`);
  const results = (data.results ?? []).map((r) => ({
    id: r.id,
    object: r.object,
    title: extractTitle(r as unknown as Record<string, unknown>),
  }));
  return { results };
}

export async function notionQueryDatabase(
  cfg: NotionConfig,
  databaseId: string,
  opts: { filter?: Record<string, unknown>; sorts?: unknown[]; pageSize?: number } = {},
): Promise<{ results: unknown[] }> {
  const res = await fetch(`${NOTION_API}/databases/${databaseId}/query`, {
    method: "POST",
    headers: headers(cfg),
    body: JSON.stringify({
      filter: opts.filter,
      sorts: opts.sorts,
      page_size: opts.pageSize ?? 20,
    }),
  });
  const data = (await res.json()) as { results?: unknown[]; message?: string };
  if (!res.ok) throw new Error(data.message ?? `Notion query échec (${res.status})`);
  return { results: data.results ?? [] };
}

export async function notionCreatePage(
  cfg: NotionConfig,
  input: { parent: { database_id?: string; page_id?: string }; properties: Record<string, unknown>; children?: unknown[] },
): Promise<{ id: string }> {
  const res = await fetch(`${NOTION_API}/pages`, {
    method: "POST",
    headers: headers(cfg),
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as { id?: string; message?: string };
  if (!res.ok) throw new Error(data.message ?? `Notion createPage échec (${res.status})`);
  return { id: data.id ?? "" };
}

export async function notionGetPage(
  cfg: NotionConfig,
  pageId: string,
): Promise<unknown> {
  const res = await fetch(`${NOTION_API}/pages/${pageId}`, { headers: headers(cfg) });
  const data = (await res.json()) as unknown;
  if (!res.ok) {
    const msg = (data as { message?: string })?.message ?? `Notion getPage échec (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

function extractTitle(obj: Record<string, unknown>): string {
  try {
    const props = obj.properties as Record<string, { title?: { plain_text: string }[] }> | undefined;
    if (!props) return (obj.id as string) ?? "";
    for (const v of Object.values(props)) {
      if (v?.title?.[0]?.plain_text) return v.title[0].plain_text;
    }
    return (obj.id as string) ?? "";
  } catch {
    return "";
  }
}

export const notionProvider = {
  type: "notion",
  label: "Notion",
  schema: notionSchema,
  test: testNotion,
  sdk: {
    namespace: "notion",
    methods: {
      search: notionSearch as (cfg: NotionConfig, ...args: unknown[]) => Promise<unknown>,
      queryDatabase: notionQueryDatabase as (cfg: NotionConfig, ...args: unknown[]) => Promise<unknown>,
      createPage: notionCreatePage as (cfg: NotionConfig, ...args: unknown[]) => Promise<unknown>,
      getPage: notionGetPage as (cfg: NotionConfig, ...args: unknown[]) => Promise<unknown>,
    },
  },
  ui: { icon: "FileText", descriptionKey: "providerNotionDescription" },
} satisfies ConnectionProvider<NotionConfig>;
