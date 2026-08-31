"use client";

import { useMemo, useState } from "react";
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

const KIND_LABELS: Record<NodeKind, string> = {
  user: "Utilisateur",
  connection: "Connexion",
  app: "App",
  script: "Script",
  storage: "Stockage",
  memory: "Mémoire",
  thread: "Conversation",
  signal: "Signal",
};

const EDGE_LABELS: Record<EdgeKind, string> = {
  OWNS: "possède",
  ATTACHED_TO: "rattaché à",
  STORES: "stocke",
  RELATES_TO: "lié à",
  ROUTINE: "routine",
  HEALTH: "santé",
  INTEREST: "intérêt",
  ACTIVITY: "activité",
};

const SIGNAL_LABELS: Record<string, string> = {
  routine: "routine",
  health: "santé",
  interest: "intérêt",
};

export default function UserStatePage() {
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
    return n?.label ?? id;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="État utilisateur"
        description="Vue dérivée (lecture seule) de ce que la plateforme sait de vous : connexions, apps, scripts, stockage, mémoire durable et signaux (routines, santé, intérêts). Tout est recalculé à la demande — rien n'est écrit."
        count={graph?.nodes.length}
        badge={<Share2 className="size-4 text-muted" />}
        actions={
          <Button size="sm" variant="ghost" onClick={() => void reload()} disabled={loading}>
            <RefreshCw className="size-4" />
            Recharger
          </Button>
        }
      />

      {loading && !graph && <Skeleton className="h-40" />}

      {graph && (
        <div className="flex flex-wrap gap-2">
          {(Object.keys(KIND_LABELS) as NodeKind[]).map((k) => (
            <Badge key={k} variant={counts[k] ? "success" : "neutral"}>
              {KIND_LABELS[k]} : {counts[k] ?? 0}
            </Badge>
          ))}
          <Badge variant="neutral">
            généré à {new Date(graph.generatedAt).toLocaleTimeString()}
          </Badge>
        </div>
      )}

      <Card className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-semibold text-brand-dark">Noeuds ({filteredNodes.length})</h2>
          <div className="flex items-center gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher…"
              className="w-48"
            />
            <Select value={nodeKind} onChange={(e) => setNodeKind(e.target.value)} className="w-36">
              <option value="all">Tous les types</option>
              {(Object.keys(KIND_LABELS) as NodeKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {filteredNodes.length === 0 ? (
          <p className="text-sm text-muted">Aucun noeud ne correspond.</p>
        ) : (
          <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
            {filteredNodes.map((n) => {
              const signalKind = n.kind === "signal" ? String(n.data?.signalKind ?? "") : "";
              return (
                <div key={n.id} className="flex items-center gap-3 px-3 py-2">
                  <Badge variant={kindBadge(n)}>{KIND_LABELS[n.kind]}</Badge>
                  <span className="min-w-0 flex-1 truncate text-sm">{n.label}</span>
                  <span className="hidden shrink-0 font-mono text-xs text-muted md:inline">
                    {n.id}
                  </span>
                  {signalKind && (
                    <Badge variant={signalVariant(signalKind)}>
                      {SIGNAL_LABELS[signalKind] ?? "signal"}
                    </Badge>
                  )}
                  <span className="shrink-0 text-xs text-muted">
                    {n.weight != null ? `poids ${n.weight.toFixed(2)}` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold text-brand-dark">Liens ({filteredEdges.length})</h2>
        {filteredEdges.length === 0 ? (
          <p className="text-sm text-muted">Aucun lien ne correspond.</p>
        ) : (
          <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
            {filteredEdges.map((e, i) => (
              <div key={`${e.from}-${e.to}-${e.kind}-${i}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{labelById(e.from)}</span>
                <Badge variant="neutral">{EDGE_LABELS[e.kind]}</Badge>
                <span className="shrink-0 text-xs text-muted">poids {e.weight.toFixed(2)}</span>
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