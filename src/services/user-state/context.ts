import type { UserStateGraph } from "./types";

// Budget du bloc injecté dans le system prompt (même ordre que formatMemoryBlock).
const GRAPH_BLOCK_MAX_CHARS = 2000;

export interface GraphBlock {
  text: string;
  /** Ids des souvenirs effectivement référencés dans le bloc (pour touchMemory). */
  memoryIds: string[];
}

function nodeLabelById(graph: UserStateGraph, id: string): string | null {
  return graph.nodes.find((n) => n.id === id)?.label ?? null;
}

/**
 * Sérialise le graphe en un bloc compact pour le system prompt de l'assistant.
 * Priorité : intérêts/projets (c), routines (b), santé, capacités. Le bloc est
 * tronqué à ~2000 caractères ; on garde les souvenirs les plus importants
 * (épinglés d'abord) et ceux qui ont des liens.
 */
export function formatGraphBlock(graph: UserStateGraph): GraphBlock {
  if (graph.nodes.length === 0) return { text: "", memoryIds: [] };

  const memoryIds: string[] = [];
  const lines: string[] = [];
  let chars = 0;

  const push = (line: string, memoryId?: string): boolean => {
    if (lines.length > 0 && chars + line.length + 1 > GRAPH_BLOCK_MAX_CHARS) return false;
    lines.push(line);
    chars += line.length + 1;
    if (memoryId) memoryIds.push(memoryId);
    return true;
  };

  const signals = graph.nodes.filter((n) => n.kind === "signal");
  const memories = graph.nodes.filter((n) => n.kind === "memory");
  const rels = graph.edges.filter(
    (e) => e.kind === "RELATES_TO" && e.from.startsWith("memory:"),
  );
  const connections = graph.nodes.filter((n) => n.kind === "connection");

  push(`État utilisateur (${graph.nodes.length} éléments, ${graph.edges.length} liens) :`);

  // Priorité c — intérêts/projets : signaux d'intérêt puis souvenirs liés.
  const interestSignals = signals.filter((s) => s.data?.signalKind === "interest");
  for (const sig of interestSignals) push(`- ${sig.label}`);

  const memoryOrder = [...memories].sort(
    (a, b) => (b.weight ?? 0) - (a.weight ?? 0),
  );
  const shownMemoryIds = new Set<string>();
  for (const m of memoryOrder) {
    const target = rels.find((e) => e.from === m.id)?.to;
    const targetLabel = target ? nodeLabelById(graph, target) : null;
    const link = targetLabel ? ` → ${targetLabel}` : "";
    if (push(`- [${m.data?.kind ?? "fact"}] ${m.label}${link}`, m.id)) {
      shownMemoryIds.add(m.id);
    }
  }

  // Priorité b — routines/habitudes dérivées des planifications de scripts.
  const routineSignals = signals.filter((s) => s.data?.signalKind === "routine");
  if (routineSignals.length > 0 && push("Routines :")) {
    for (const r of routineSignals) {
      const scriptEdge = graph.edges.find((e) => e.kind === "ROUTINE" && e.to === r.id);
      const scriptLabel = scriptEdge ? nodeLabelById(graph, scriptEdge.from) : null;
      push(`- ${scriptLabel ? `${scriptLabel} : ` : ""}${r.label}`);
    }
  }

  // Santé (scripts en échec, connexions à réparer).
  const healthSignals = signals.filter((s) => s.data?.signalKind === "health");
  if (healthSignals.length > 0 && push("Signaux :")) {
    for (const h of healthSignals) push(`- ${h.label}`);
  }

  // Capacités : connexions disponibles.
  if (connections.length > 0) {
    push(
      `Capacités : ${connections
        .map((c) => `${c.label} (${c.data?.status ?? "?"})`)
        .join(", ")}`,
    );
  }

  if (lines.length <= 1) return { text: "", memoryIds: [] };
  return { text: lines.join("\n"), memoryIds: [...shownMemoryIds] };
}