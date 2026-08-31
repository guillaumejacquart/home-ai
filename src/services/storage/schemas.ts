import { z } from "zod";

import { appVisibility, storageKind } from "@/db/schema";
import { isRowOpInput, type TableRowOp } from "@/lib/storage-table";

import { isJsonSerializable } from "./storage";

/**
 * Schémas d'entrée du stockage. Volontairement à côté du service (et non dans
 * la route) : la même définition sert la route HTTP et, à terme, l'exposition
 * en tool MCP/assistant.
 *
 * Les messages reprennent les `ErrorCode` de l'app — `lib/route.ts` les
 * reconnaît et renvoie la réponse traduite habituelle.
 */

/** Valeur JSON quelconque, mais réellement sérialisable. */
export const jsonValueSchema = z.unknown().refine(isJsonSerializable, "storageValueInvalid");

export const storageKeySchema = z.string().trim().min(1, "keyRequired");

export const rowOpSchema = z.custom<TableRowOp>(isRowOpInput, "invalidRowOp");

/** Corps de POST : écriture d'une clé (portée app ou script). */
export const storageSetBodySchema = z.object({
  key: storageKeySchema,
  value: jsonValueSchema,
  // Absent → le service applique son défaut ; valeur inconnue → 400.
  kind: z.enum(storageKind).optional(),
  schema: jsonValueSchema.optional(),
  baseUpdatedAt: z.string().optional(),
});

/** Corps de POST du stockage global : ajoute la visibilité. */
export const globalStorageSetBodySchema = storageSetBodySchema.extend({
  visibility: z.enum(appVisibility).optional(),
});

/** Corps de PATCH : opération ligne atomique sur une valeur « table ». */
export const storageRowOpBodySchema = z.object({
  key: storageKeySchema,
  op: rowOpSchema,
});

/** `?key=` optionnel : présent = une clé, absent = toute la portée. */
export const storageKeyQuerySchema = z.object({ key: z.string().optional() });
