// ---------------------------------------------------------------------------
// User State Graph — vue dérivée de l'état d'un utilisateur.
//
// Ce module construit, à la demande, un graphe qui relie ce que la plateforme
// sait déjà d'un utilisateur : connexions, apps, scripts, stockage, mémoire
// durable et signaux dérivés (routines, santé, intérêts). C'est une VUE, pas
// une source de vérité : rien n'est écrit, tout se recalcule.
//
// Voir `docs/key-flows.md` § User State Graph pour les règles de construction.
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

/** Kind des noeuds `signal` (discriminant dans `data.signalKind`). */
export type UserStateSignalKind = "routine" | "health" | "interest";

export interface UserStateNode {
  id: string;
  kind: UserStateNodeKind;
  label: string;
  /** Données légères et non sensibles (jamais de secrets, jamais de valeur de stockage entière). */
  data?: Record<string, unknown>;
  updatedAt: string | null;
  /** Importance 0..1 (ex. mémoire épinglée, script actif). */
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