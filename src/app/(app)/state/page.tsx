"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw, Share2 } from "lucide-react";

import { Badge, Button, Card, Input, PageHeader, Select, Skeleton } from "@/components/ui";
import type { BadgeVariant } from "@/components/ui/Badge";
import { useResource } from "@/lib/use-resource";

type NodeKind =
  | "user"
  | "connection"
  | "app"
  | "script"
  | "storage"
  | "memory"
  | "thread"
  | "signal";

type EdgeKind =
  | "OWNS"
  | "ATTACHED_TO"
  | "STORES"
  | "RELATES_TO"
  | "ROUTINE"
  | "HEALTH"
  | "INTEREST"
  | "ACTIVITY";

interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  data?: Record<string, unknown>;
  updatedAt: string | null;
  weight?: number;
}

interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  label?: string;
  weight: number;
  meta?: Record<string, unknown>;
}

interface UserStateGraph {
  userId: string;
  generatedAt: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const NODE_KINDS: NodeKind[] = [
  "user",
  "connection",
  "app",
  "script",
  "storage",
  "memory",
  "thread",
  "signal",
];

type T = ReturnType<typeof useTranslations<"state">>;

const KIND_KEY = {
  user: "kindUser",
  connection: "kindConnection",
  app: "kindApp",
  script: "kindScript",
  storage: "kindStorage",
  memory: "kindMemory",
  thread: "kindThread",
  signal: "kindSignal",
} as const satisfies Record<NodeKind, string>;

const SIGNAL_KEY = {
  routine: "signalRoutine",
  health: "signalHealth",
  interest: "signalInterest",
} as const;

/**
 * Node labels come from the server in English; `labelKey` lets the UI render the
 * localised wording instead.
 */
const LABEL_KEY = {
  user: "kindUser",
  "routine.hourly": "signalRoutineHourly",
  "routine.daily": "signalRoutineDaily",
  "routine.weekly": "signalRoutineWeekly",
  "routine.monthly": "signalRoutineMonthly",
  interest: "signalInterestLabel",
  healthScript: "signalHealthScript",
  healthConnection: "signalHealthConnection",
} as const;

function nodeLabel(t: T, n: GraphNode): string {
  const key = n.labelKey && LABEL_KEY[n.labelKey as keyof typeof LABEL_KEY];
  if (!key) return n.label;
  const params = { ...(n.labelParams ?? {}) };
  if (typeof params.weekday === "number") {
    params.weekday = t(`weekday${params.weekday}` as "weekday0");
  }
  if (typeof params.hour === "number") params.hour = String(params.hour).padStart(2, "0");
  return t(key, params as never);
}

export default function UserStatePage() {
  const t = useTranslations("state");
  const { data, loading, reload } = useResource<UserStateGraph>("/api/user-state");
  const [nodeKind, setNodeKind] = useState<string>("all");
  const [query, setQuery] = useState("");

  const graph = data;

  const counts = useMemo(() => {
    const out: Partial<Record<NodeKind, number>> = {};
    for (const n of graph?.nodes ?? []) out[n.kind] = (out[n.kind] ?? 0) + 1;
    return out;
  }, [graph]);

  const filteredNodes = useMemo(() => {
    const nodes = graph?.nodes ?? [];
    const q = query.trim().toLowerCase();
    return nodes.filter((n) => {
      if (nodeKind !== "all" && n.kind !== nodeKind) return false;
      if (q && !n.label.toLowerCase().includes(q) && !n.id.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [graph, nodeKind, query]);

  const filteredEdges = useMemo(() => {
    const edges = graph?.edges ?? [];
    const ids = new Set(filteredNodes.map((n) => n.id));
    return edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  }, [graph, filteredNodes]);

  const labelById = (id: string) => {
    const n = graph?.nodes.find((x) => x.id === id);
    return n ? nodeLabel(t, n) : id;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        count={graph?.nodes.length}
        badge={<Share2 className="size-4 text-muted" />}
        actions={
          <Button size="sm" variant="ghost" onClick={() => void reload()} disabled={loading}>
            <RefreshCw className="size-4" />
            {t("reload")}
          </Button>
        }
      />

      {loading && !graph && <Skeleton className="h-40" />}

      {graph && (
        <div className="flex flex-wrap gap-2">
          {NODE_KINDS.map((k) => (
            <Badge key={k} variant={counts[k] ? "success" : "neutral"}>
              {t(KIND_KEY[k])} : {counts[k] ?? 0}
            </Badge>
          ))}
          <Badge variant="neutral">
            {t("generatedAt", { time: new Date(graph.generatedAt).toLocaleTimeString() })}
          </Badge>
        </div>
      )}

      <Card className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-semibold text-brand-dark">
            {t("nodes", { count: filteredNodes.length })}
          </h2>
          <div className="flex items-center gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="w-48"
            />
            <Select value={nodeKind} onChange={(e) => setNodeKind(e.target.value)} className="w-36">
              <option value="all">{t("allKinds")}</option>
              {NODE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(KIND_KEY[k])}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {filteredNodes.length === 0 ? (
          <p className="text-sm text-muted">{t("noNode")}</p>
        ) : (
          <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
            {filteredNodes.map((n) => {
              const signalKind = n.kind === "signal" ? String(n.data?.signalKind ?? "") : "";
              const signalKey = SIGNAL_KEY[signalKind as keyof typeof SIGNAL_KEY];
              return (
                <div key={n.id} className="flex items-center gap-3 px-3 py-2">
                  <Badge variant={kindBadge(n)}>{t(KIND_KEY[n.kind])}</Badge>
                  <span className="min-w-0 flex-1 truncate text-sm">{nodeLabel(t, n)}</span>
                  <span className="hidden shrink-0 font-mono text-xs text-muted md:inline">
                    {n.id}
                  </span>
                  {signalKind && (
                    <Badge variant={signalVariant(signalKind)}>
                      {t(signalKey ?? "signalOther")}
                    </Badge>
                  )}
                  <span className="shrink-0 text-xs text-muted">
                    {n.weight != null ? t("weight", { value: n.weight.toFixed(2) }) : ""}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold text-brand-dark">
          {t("edges", { count: filteredEdges.length })}
        </h2>
        {filteredEdges.length === 0 ? (
          <p className="text-sm text-muted">{t("noEdge")}</p>
        ) : (
          <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
            {filteredEdges.map((e, i) => (
              <div key={`${e.from}-${e.to}-${e.kind}-${i}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{labelById(e.from)}</span>
                <Badge variant="neutral">{t(`edge${e.kind}`)}</Badge>
                <span className="shrink-0 text-xs text-muted">
                  {t("weight", { value: e.weight.toFixed(2) })}
                </span>
                <span className="min-w-0 flex-1 truncate text-right">{labelById(e.to)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function kindBadge(n: GraphNode): BadgeVariant {
  if (n.kind === "signal") {
    const k = String(n.data?.signalKind ?? "");
    if (k === "health") return "danger";
    if (k === "interest") return "success";
    return "neutral";
  }
  if (n.kind === "memory") return "success";
  return "neutral";
}

function signalVariant(kind: string): BadgeVariant {
  if (kind === "routine") return "success";
  if (kind === "health") return "danger";
  if (kind === "interest") return "default";
  return "neutral";
}
