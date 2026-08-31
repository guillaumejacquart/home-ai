import { z } from "zod";

import type { ConnectionProvider } from "@/services/connections/definition";

export const homeassistantSchema = z.object({
  baseUrl: z.string().min(1, "URL requise").url("URL invalide"),
  accessToken: z.string().min(1, "Token requis"),
});

export type HomeAssistantConfig = z.infer<typeof homeassistantSchema>;
export interface HomeAssistantConfigLegacy {
  baseUrl: string;
  accessToken: string;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function headers(cfg: HomeAssistantConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${cfg.accessToken}`,
    "Content-Type": "application/json",
  };
}

async function haFetch(
  cfg: HomeAssistantConfig,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const base = normalizeBaseUrl(cfg.baseUrl);
  const url = `${base}/api${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { ...headers(cfg), ...(init.headers as Record<string, string> | undefined) },
  });
  return res;
}

export async function testHomeAssistant(cfg: HomeAssistantConfig): Promise<string> {
  const res = await haFetch(cfg, "/");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Home Assistant : échec (${res.status})`);
  }
  const data = (await res.json().catch(() => null)) as { message?: string } | null;
  if (data?.message !== "API running.") {
    // certaines instances renvoient 200 sans json
  }
  return "Home Assistant : connexion OK — API running";
}

export async function haGetStates(cfg: HomeAssistantConfig): Promise<unknown[]> {
  const res = await haFetch(cfg, "/states");
  if (!res.ok) throw new Error(`HA getStates échec (${res.status})`);
  return (await res.json()) as unknown[];
}

export async function haGetState(
  cfg: HomeAssistantConfig,
  entityId: string,
): Promise<unknown> {
  const res = await haFetch(cfg, `/states/${encodeURIComponent(entityId)}`);
  if (!res.ok) throw new Error(`HA getState échec (${res.status})`);
  return await res.json();
}

export async function haCallService(
  cfg: HomeAssistantConfig,
  input: { domain: string; service: string; entityId?: string; data?: Record<string, unknown> },
): Promise<unknown> {
  const res = await haFetch(cfg, `/services/${input.domain}/${input.service}`, {
    method: "POST",
    body: JSON.stringify({
      entity_id: input.entityId,
      ...input.data,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HA callService échec (${res.status})`);
  }
  return await res.json().catch(() => ({}));
}

export async function haGetHistory(
  cfg: HomeAssistantConfig,
  entityId: string,
  opts: { minimalResponse?: boolean } = {},
): Promise<unknown> {
  const qp = opts.minimalResponse ? "?minimal_response" : "";
  const res = await haFetch(cfg, `/history/period/${encodeURIComponent(entityId)}${qp}`);
  if (!res.ok) throw new Error(`HA history échec (${res.status})`);
  return await res.json();
}

export const homeassistantProvider = {
  type: "homeassistant",
  label: "Home Assistant",
  schema: homeassistantSchema,
  test: testHomeAssistant,
  sdk: {
    namespace: "homeassistant",
    methods: {
      getStates: haGetStates as (cfg: HomeAssistantConfig, ...args: unknown[]) => Promise<unknown>,
      getState: haGetState as (cfg: HomeAssistantConfig, ...args: unknown[]) => Promise<unknown>,
      callService: haCallService as (cfg: HomeAssistantConfig, ...args: unknown[]) => Promise<unknown>,
    },
  },
  ui: { icon: "Home", descriptionKey: "providerHomeAssistantDescription" },
} satisfies ConnectionProvider<HomeAssistantConfig>;
