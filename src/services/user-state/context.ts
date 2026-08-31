import type { UserStateGraph } from "./types";

// Budget of the block injected into the system prompt (same order as formatMemoryBlock).
const GRAPH_BLOCK_MAX_CHARS = 2000;

export interface GraphBlock {
  text: string;
  /** Ids of the memories actually referenced in the block (for touchMemory). */
  memoryIds: string[];
}

function nodeLabelById(graph: UserStateGraph, id: string): string | null {
  return graph.nodes.find((n) => n.id === id)?.label ?? null;
}

/**
 * Serialises the graph into a compact block for the assistant's system prompt.
 * Priority: interests/projects (c), routines (b), health, capabilities. The block
 * is truncated to ~2000 characters; we keep the most important memories (pinned
 * first) and those that have links.
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

  push(`User state (${graph.nodes.length} items, ${graph.edges.length} links):`);

  // Priority c — interests/projects: interest signals then linked memories.
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

  // Priority b — routines/habits derived from the scripts' schedules.
  const routineSignals = signals.filter((s) => s.data?.signalKind === "routine");
  if (routineSignals.length > 0 && push("Routines:")) {
    for (const r of routineSignals) {
      const scriptEdge = graph.edges.find((e) => e.kind === "ROUTINE" && e.to === r.id);
      const scriptLabel = scriptEdge ? nodeLabelById(graph, scriptEdge.from) : null;
      push(`- ${scriptLabel ? `${scriptLabel}: ` : ""}${r.label}`);
    }
  }

  // Health (failing scripts, connections needing repair).
  const healthSignals = signals.filter((s) => s.data?.signalKind === "health");
  if (healthSignals.length > 0 && push("Signals:")) {
    for (const h of healthSignals) push(`- ${h.label}`);
  }

  // Capabilities: available connections.
  if (connections.length > 0) {
    push(
      `Capabilities: ${connections
        .map((c) => `${c.label} (${c.data?.status ?? "?"})`)
        .join(", ")}`,
    );
  }

  if (lines.length <= 1) return { text: "", memoryIds: [] };
  return { text: lines.join("\n"), memoryIds: [...shownMemoryIds] };
}