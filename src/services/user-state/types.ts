// ---------------------------------------------------------------------------
// User State Graph — a derived view of a user's state.
//
// This module builds, on demand, a graph linking what the platform already
// knows about a user: connections, apps, scripts, storage, durable memory and
// derived signals (routines, health, interests). It is a VIEW, not a source of
// truth: nothing is written, everything is recomputed.
//
// See `docs/key-flows.md` § User State Graph for the construction rules.
// ---------------------------------------------------------------------------

export type UserStateNodeKind =
  | "user"
  | "connection"
  | "app"
  | "script"
  | "storage"
  | "memory"
  | "thread"
  | "signal";

export type UserStateEdgeKind =
  | "OWNS"
  | "ATTACHED_TO"
  | "STORES"
  | "RELATES_TO"
  | "ROUTINE"
  | "HEALTH"
  | "INTEREST"
  | "ACTIVITY";

/** Kind of the `signal` nodes (discriminant in `data.signalKind`). */
export type UserStateSignalKind = "routine" | "health" | "interest";

export interface UserStateNode {
  id: string;
  kind: UserStateNodeKind;
  /** English rendering — used as-is by the LLM prompt and as a UI fallback. */
  label: string;
  /** Message key under the `state.signals` namespace, when the label is localisable. */
  labelKey?: string;
  /** Interpolation values for `labelKey`. */
  labelParams?: Record<string, string | number>;
  /** Light, non-sensitive data (never secrets, never a whole storage value). */
  data?: Record<string, unknown>;
  updatedAt: string | null;
  /** Importance 0..1 (e.g. pinned memory, active script). */
  weight?: number;
}

export interface UserStateEdge {
  from: string;
  to: string;
  kind: UserStateEdgeKind;
  label?: string;
  weight: number;
  meta?: Record<string, unknown>;
}

export interface UserStateGraph {
  userId: string;
  generatedAt: string;
  nodes: UserStateNode[];
  edges: UserStateEdge[];
}