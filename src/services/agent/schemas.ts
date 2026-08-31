import { z } from "zod";

/**
 * The assistant's input schemas, kept next to the service so they are shared by
 * the HTTP route and the tool exposure. Messages = the app's `ErrorCode`.
 */

export const memoryKindSchema = z.enum(["fact", "preference", "project"], "invalidKind");

/** Editable fields of a memory; all optional (partial PATCH). */
export const memoryPatchSchema = z.object({
  content: z.string("invalidContent").optional(),
  kind: memoryKindSchema.optional(),
  pinned: z.boolean("invalidPinned").optional(),
});
