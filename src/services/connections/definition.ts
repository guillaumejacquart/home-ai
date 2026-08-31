import type { z } from "zod";

import type { ConnectionType } from "@/db/schema";

/**
 * Common contract for every connection.
 * Every provider declares its zod schema, its test function and the methods
 * exposed on the homeSDK / script side.
 */
export interface ConnectionProvider<TConfig> {
  type: ConnectionType;
  label: string;
  schema: z.ZodType<TConfig>;
  test(cfg: TConfig): Promise<string>;
  /** Optional hook to refresh the config (Google). Returns the same ref when unchanged. */
  resolve?(cfg: TConfig): Promise<TConfig>;
  sdk: {
    namespace: string;
    /** key = exposed name, e.g. "send" or "drive.list" */
    methods: Record<string, (cfg: TConfig, ...args: unknown[]) => Promise<unknown>>;
  };
  ui?: {
    icon: string;
    descriptionKey: string;
  };
}

/** Entry of the "namespace.method" -> provider method registry */
export interface MethodEntry {
  type: ConnectionType;
  namespace: string;
  methodKey: string; // ex "drive.list"
  fullMethod: string; // ex "google.drive.list"
  fn: (cfg: unknown, ...args: unknown[]) => Promise<unknown>;
}
