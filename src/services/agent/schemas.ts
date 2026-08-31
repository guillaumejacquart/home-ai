import { z } from "zod";

/**
 * Schémas d'entrée de l'assistant, à côté du service pour être partagés entre
 * la route HTTP et l'exposition en tool. Messages = `ErrorCode` de l'app.
 */

export const memoryKindSchema = z.enum(["fact", "preference", "project"], "invalidKind");

/** Champs modifiables d'un souvenir ; tous optionnels (PATCH partiel). */
export const memoryPatchSchema = z.object({
  content: z.string("invalidContent").optional(),
  kind: memoryKindSchema.optional(),
  pinned: z.boolean("invalidPinned").optional(),
});
