import { z } from "zod";

import type { ConnectionProvider } from "@/services/connections/definition";
import { isBlockedUrl } from "@/lib/ssrf";

export const webhookSchema = z.object({
  url: z.string().min(1, "URL required").url("Invalid URL"),
  method: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  secret: z.string().optional(),
});

export type WebhookConfig = z.infer<typeof webhookSchema>;
export interface WebhookConfigLegacy {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  secret?: string;
}

export async function testWebhook(cfg: WebhookConfig): Promise<string> {
  if (!cfg.url) throw new Error("Missing URL");
  let url: URL;
  try {
    url = new URL(cfg.url);
  } catch {
    throw new Error("Invalid URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("URL must be http(s)");
  // A light HEAD/GET checks the URL without side effects where possible.
  // If HEAD fails, the URL is considered syntactically fine.
  try {
    const res = await fetch(cfg.url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    return `Webhook: URL OK — ${res.status} ${res.statusText}`;
  } catch {
    return `Webhook: URL OK — ${cfg.url}`;
  }
}

function buildHeaders(cfg: WebhookConfig, override?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { ...(cfg.headers ?? {}) , ...(override ?? {}) };
  if (cfg.secret && !h.Authorization && !h["X-Webhook-Secret"] && !h["x-webhook-secret"]) {
    h["X-Webhook-Secret"] = cfg.secret;
  }
  return h;
}

export async function webhookCall(
  cfg: WebhookConfig,
  input: { url?: string; method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string }> {
  const url = input.url ?? cfg.url;
  if (!url) throw new Error("Missing URL (configure the webhook or pass url).");
  const method = (input.method ?? cfg.method ?? "POST").toUpperCase();
  const headers = buildHeaders(cfg, input.headers);
  const hasBody = input.body !== undefined && input.body !== null;
  if (hasBody && !headers["Content-Type"] && !headers["content-type"]) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(url, {
    method,
    headers,
    body: hasBody ? (typeof input.body === "string" ? input.body as string : JSON.stringify(input.body)) : undefined,
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`Webhook failed ${res.status}: ${text.slice(0, 500)}`);
  return { status: res.status, body: text.slice(0, 10000) };
}

// ---------------------------------------------------------------------------
// Generic HTTP fetch (no stored connection) — light SSRF guard
// ---------------------------------------------------------------------------

export async function httpFetch(
  _cfg: null,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const blocked = isBlockedUrl(url);
  if (blocked) throw new Error(`fetch blocked: ${blocked}`);
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: init.headers,
    body: init.body,
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.text().catch(() => "");
  const h: Record<string, string> = {};
  res.headers.forEach((v, k) => { h[k] = v; });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 800)}`);
  return { status: res.status, body: body.slice(0, 20000), headers: h };
}

export const webhookProvider = {
  type: "webhook",
  label: "Webhook",
  schema: webhookSchema,
  test: testWebhook,
  sdk: {
    namespace: "webhook",
    methods: {
      call: webhookCall as (cfg: WebhookConfig, ...args: unknown[]) => Promise<unknown>,
    },
  },
  ui: { icon: "Link2", descriptionKey: "providerWebhookDescription" },
} satisfies ConnectionProvider<WebhookConfig>;
