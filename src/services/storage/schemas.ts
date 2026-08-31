import { z } from "zod";

import { appVisibility, storageKind } from "@/db/schema";
import { isRowOpInput, type TableRowOp } from "@/lib/storage-table";

import { isJsonSerializable } from "./storage";

/**
 * Storage input schemas. Deliberately next to the service (not in the route):
 * the same definition serves the HTTP route and, eventually, the tool
 * exposure to MCP/assistant.
 *
 * Messages reuse the app's `ErrorCode` — `lib/route.ts`
 * recognises it and returns the usual translated response.
 */

/** Any JSON value, as long as it is genuinely serialisable. */
export const jsonValueSchema = z.unknown().refine(isJsonSerializable, "storageValueInvalid");

export const storageKeySchema = z.string().trim().min(1, "keyRequired");

export const rowOpSchema = z.custom<TableRowOp>(isRowOpInput, "invalidRowOp");

/** POST body: writing a key (app or script scope). */
export const storageSetBodySchema = z.object({
  key: storageKeySchema,
  value: jsonValueSchema,
  // Absent → the service applies its default; unknown value → 400.
  kind: z.enum(storageKind).optional(),
  schema: jsonValueSchema.optional(),
  baseUpdatedAt: z.string().optional(),
});

/** POST body for global storage: adds visibility. */
export const globalStorageSetBodySchema = storageSetBodySchema.extend({
  visibility: z.enum(appVisibility).optional(),
});

/** PATCH body: atomic row operation on a "table" value. */
export const storageRowOpBodySchema = z.object({
  key: storageKeySchema,
  op: rowOpSchema,
});

/** Optional `?key=`: present = one key, absent = the whole scope. */
export const storageKeyQuerySchema = z.object({ key: z.string().optional() });
