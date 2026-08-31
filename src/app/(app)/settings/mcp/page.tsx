"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Alert, Badge, Button, Card, Field, Input, Select, Skeleton, TabPanel, useToast } from "@/components/ui";
import { api } from "@/lib/api-client";
import { useResource } from "@/lib/use-resource";

interface ToolInfo {
  name: string;
  title: string;
  description: string;
  destructive: boolean;
  source: "registry" | "manifest";
  category: string;
  appId?: string;
  appSlug?: string;
  appName?: string;
  inputSchema: Record<string, unknown>;
}

interface ToolsResponse {
  tools: ToolInfo[];
  counts: { registry: number; manifest: number; total: number };
  manifestApps: { id: string; slug: string; name: string }[];
  categories: string[];
}

interface McpCall {
  id: string;
  toolName: string;
  tokenPrefix: string | null;
  args: string | null;
  result: string | null;
  status: "success" | "error";
  error: string | null;
  durationMs: number | null;
  createdAt: string;
}

function truncatePreview(value: string | null, max = 120): string {
  if (!value) return "—";
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export default function McpSettingsPage() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const toast = useToast();

  const [mcpUrl, setMcpUrl] = useState("/api/mcp");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate origin once
    setMcpUrl(`${window.location.origin}/api/mcp`);
  }, []);

  const { data: toolsData, loading: toolsLoading, error: toolsError, reload: reloadTools } = useResource<ToolsResponse>("/api/mcp/tools");
  const tools = useMemo(() => toolsData?.tools ?? [], [toolsData]);

  const [filter, setFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "registry" | "manifest">("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [appFilter, setAppFilter] = useState("all");

  const filtered = useMemo(() => {
    let out = tools;
    if (sourceFilter !== "all") out = out.filter((tool) => tool.source === sourceFilter);
    if (sourceFilter !== "manifest" && categoryFilter !== "all") out = out.filter((tool) => tool.category === categoryFilter);
    if (sourceFilter !== "registry" && appFilter !== "all") out = out.filter((tool) => tool.source === "manifest" && tool.appId === appFilter);
    const q = filter.trim().toLowerCase();
    if (q) out = out.filter((tool) => tool.name.toLowerCase().includes(q) || tool.description.toLowerCase().includes(q));
    return out;
  }, [tools, filter, sourceFilter, categoryFilter, appFilter]);

  const [calls, setCalls] = useState<McpCall[]>([]);
  const [callsLoading, setCallsLoading] = useState(true);
  const [callsError, setCallsError] = useState<string | null>(null);

  const loadCalls = useCallback(async () => {
    setCallsLoading(true);
    setCallsError(null);
    try {
      const data = await api.get<McpCall[]>("/api/mcp/calls?limit=50");
      setCalls(data);
    } catch (e) {
      setCallsError(e instanceof Error ? e.message : String(e));
    } finally {
      setCallsLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
    void loadCalls();
  }, [loadCalls]);

  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  function copy(text: string, msg: string) {
    void navigator.clipboard.writeText(text).then(() => toast(msg));
  }

  const hermesSnippet = `hermes mcp connect ${mcpUrl} --header "Authorization: Bearer hai_..."`;
  const claudeSnippet = JSON.stringify(
    {
      mcpServers: {
        "home-ai": {
          url: mcpUrl,
          headers: { Authorization: "Bearer hai_..." },
        },
      },
    },
    null,
    2,
  );

  return (
    <TabPanel id="mcp" className="space-y-8">
      {/* URL + connexion */}
      <Card>
        <h2 className="font-semibold text-brand-dark">{t("mcpTitle")}</h2>
        <p className="mt-1 text-sm text-muted">{t("mcpDescription")}</p>

        <div className="mt-4 space-y-3">
          <div>
            <p className="text-xs font-medium text-muted">{t("mcpUrlLabel")}</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-canvas px-3 py-2 font-mono text-sm">{mcpUrl}</code>
              <Button size="sm" variant="secondary" onClick={() => copy(mcpUrl, t("mcpCopied"))}>
                {tCommon("copy") ?? "Copier"}
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted">{t("mcpUrlHint")}</p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-muted">{t("mcpHermesLabel")}</p>
              <pre className="mt-1 overflow-auto rounded bg-canvas p-3 font-mono text-xs">{hermesSnippet}</pre>
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => copy(hermesSnippet, t("mcpCopied"))}>
                {t("mcpCopySnippet")}
              </Button>
            </div>
            <div>
              <p className="text-xs font-medium text-muted">{t("mcpClaudeLabel")}</p>
              <pre className="mt-1 overflow-auto rounded bg-canvas p-3 font-mono text-xs">{claudeSnippet}</pre>
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => copy(claudeSnippet, t("mcpCopied"))}>
                {t("mcpCopySnippet")}
              </Button>
            </div>
          </div>

          <Alert>{t("mcpTokenHint")}</Alert>
        </div>
      </Card>

      {/* Catalogue d'outils */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-brand-dark">{t("mcpToolsTitle")}</h3>
            <p className="text-xs text-muted">
              {toolsData ? t("mcpToolsCount", { total: toolsData.counts.total, registry: toolsData.counts.registry, manifest: toolsData.counts.manifest }) : t("mcpToolsDescription")}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void reloadTools()}>
            {tCommon("reload")}
          </Button>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t("mcpFilterSourceLabel")}>
            <Select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as typeof sourceFilter)}>
              <option value="all">{t("mcpFilterSourceAll")}</option>
              <option value="registry">{t("mcpFilterSourceRegistry")}</option>
              <option value="manifest">{t("mcpFilterSourceManifest")}</option>
            </Select>
          </Field>
          {sourceFilter !== "manifest" && (
            <Field label={t("mcpFilterCategoryLabel")}>
              <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                <option value="all">{t("mcpFilterCategoryAll")}</option>
                {(toolsData?.categories ?? []).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {sourceFilter !== "registry" && (
            <Field label={t("mcpFilterAppLabel")}>
              <Select value={appFilter} onChange={(e) => setAppFilter(e.target.value)}>
                <option value="all">{t("mcpFilterAppAll")}</option>
                {(toolsData?.manifestApps ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.slug})
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={t("mcpToolsSearchPlaceholder")}>
            <Input placeholder={t("mcpToolsSearchPlaceholder")} value={filter} onChange={(e) => setFilter(e.target.value)} />
          </Field>
        </div>

        {toolsError && <Alert className="mt-3">{String(toolsError)}</Alert>}

        {toolsLoading ? (
          <Skeleton className="mt-3 h-24" />
        ) : filtered.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{filter ? t("mcpToolsNoResults") : t("mcpToolsEmpty")}</p>
        ) : (
          <div className="mt-3 space-y-2">
            {filtered.map((tool) => (
              <div key={tool.name} className="rounded-lg border border-line bg-canvas px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{tool.name}</span>
                      <Badge variant={tool.source === "manifest" ? "success" : "neutral"}>{tool.source}</Badge>
                      <Badge variant="neutral">{tool.category}</Badge>
                      {tool.appSlug && <Badge variant="neutral">{tool.appSlug}</Badge>}
                      {tool.destructive && <Badge variant="danger">{t("mcpDestructive")}</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-muted">{tool.description}</p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => copy(tool.name, t("mcpCopied"))}>
                      {t("mcpCopyName")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setExpandedTool(expandedTool === tool.name ? null : tool.name)}>
                      {expandedTool === tool.name ? t("mcpHideSchema") : t("mcpShowSchema")}
                    </Button>
                  </div>
                </div>
                {expandedTool === tool.name && (
                  <pre className="mt-2 max-h-48 overflow-auto rounded bg-white p-2 font-mono text-xs">
                    {JSON.stringify(tool.inputSchema, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Recent activity */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-brand-dark">{t("mcpCallsTitle")}</h3>
            <p className="text-xs text-muted">{t("mcpCallsDescription")}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void loadCalls()}>
            {tCommon("reload")}
          </Button>
        </div>

        {callsError && <Alert className="mt-3">{callsError}</Alert>}

        {callsLoading ? (
          <Skeleton className="mt-3 h-24" />
        ) : calls.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t("mcpCallsEmpty")}</p>
        ) : (
          <div className="mt-3 space-y-1">
            {calls.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-canvas px-3 py-2 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold">{c.toolName}</span>
                    <Badge variant={c.status === "error" ? "danger" : "neutral"}>{c.status}</Badge>
                    {c.tokenPrefix && <span className="font-mono text-muted">{c.tokenPrefix}…</span>}
                    {c.durationMs != null && <span className="text-muted">{c.durationMs}ms</span>}
                  </div>
                  <p className="truncate text-muted" title={c.args ?? undefined}>
                    args: {truncatePreview(c.args)}
                  </p>
                  {c.error ? (
                    <p className="truncate text-danger">{c.error}</p>
                  ) : (
                    <p className="truncate text-muted" title={c.result ?? undefined}>
                      → {truncatePreview(c.result)}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-muted">{new Date(c.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-muted">{t("mcpCallsHint")}</p>
      </Card>
    </TabPanel>
  );
}
