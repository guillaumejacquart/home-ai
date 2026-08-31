import type { z } from "zod";

import type { ConnectionType } from "@/db/schema";

/**
 * Contrat commun pour chaque connexion.
 * Chaque provider déclare son schéma zod, sa fonction de test
 * et les méthodes exposées côté homeSDK / script.
 */
export interface ConnectionProvider<TConfig> {
  type: ConnectionType;
  label: string;
  schema: z.ZodType<TConfig>;
  test(cfg: TConfig): Promise<string>;
  /** Hook optionnel pour rafraîchir la config (Google). Retourne la même ref si pas de changement. */
  resolve?(cfg: TConfig): Promise<TConfig>;
  sdk: {
    namespace: string;
    /** clé = nom exposé, ex "send" ou "drive.list" */
    methods: Record<string, (cfg: TConfig, ...args: unknown[]) => Promise<unknown>>;
  };
  ui?: {
    icon: string;
    descriptionKey: string;
  };
}

/** Entrée du registre des méthodes "namespace.method" -> provider */
export interface MethodEntry {
  type: ConnectionType;
  namespace: string;
  methodKey: string; // ex "drive.list"
  fullMethod: string; // ex "google.drive.list"
  fn: (cfg: unknown, ...args: unknown[]) => Promise<unknown>;
}
