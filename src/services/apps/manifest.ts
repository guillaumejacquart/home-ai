import { z } from "zod";

import { appScope, storageGet, storageRowOp, storageSet } from "@/services/storage/storage";
import { jsonSchemaToZod } from "@/lib/json-schema";
import { HttpError, StorageRowError } from "@/lib/errors";

// Re-exported for compatibility: the implementation now lives in
// src/lib/json-schema.ts (importable from the client).
export { jsonSchemaToZod };

/**
 * An app's exposure manifest: declares the storages it uses and the tools it
 * exposes to MCP / the assistant. It is extracted from the generated HTML
 * (`#home-manifest` script) or hand-edited, strictly validated by zod, and
 * stored on `apps.manifest` and `app_versions.manifest`.
 *
 * The mapping is deliberately declarative (op + key), never JS code, to limit
 * injection through LLM-generated HTML.
 */

export const manifestToolOp = z.enum(["get", "set", "list", "append", "remove", "toggle", "update"]);
export type ManifestToolOp = z.infer<typeof manifestToolOp>;

export const manifestStorageSchema = z.object({
  key: z.string().regex(/^[a-z0-9_-]{1,64}$/),
  kind: z.enum(["kv", "table"]).default("kv"),
  description: z.string().min(2).max(200),
  schema: z.unknown().optional(),
});

export const manifestToolSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/),
  description: z.string().min(5).max(300),
  // JSON Schema of the tool's arguments (type/properties/required).
  parameters: z.record(z.string(), z.unknown()).optional(),
  storage: z.object({
    op: manifestToolOp,
    key: z.string().regex(/^[a-z0-9_-]{1,64}$/),
  }),
});

export const appManifestSchema = z.object({
  storages: z.array(manifestStorageSchema).max(10).optional(),
  tools: z.array(manifestToolSchema).max(10).optional(),
});

export type AppManifest = z.infer<typeof appManifestSchema>;
export type AppManifestTool = z.infer<typeof manifestToolSchema>;
export type AppManifestStorage = z.infer<typeof manifestStorageSchema>;

/** Max total tools exposed to the LLM (assistant), to avoid an explosion. */
export const MAX_MANIFEST_TOOLS_TOTAL = 50;

const MANIFEST_RE =
  /<script[^>]*id=["']home-manifest["'][^>]*>\s*([\s\S]*?)\s*<\/script>/i;

/** Extracts and validates the manifest from an app's HTML (null if missing/invalid). */
export function extractManifestFromHtml(html: string): AppManifest | null {
  const m = html.match(MANIFEST_RE);
  if (!m?.[1]) return null;
  return parseManifest(m[1]);
}

/** Parses a raw JSON string stored in the database. */
export function parseManifest(raw: string | null | undefined): AppManifest | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const result = appManifestSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Runs a tool declared by an app's manifest against its storage.
 * The args are already validated against the declared schema by the caller.
 */
export async function executeManifestTool(
  appId: string,
  tool: AppManifestTool,
  args: Record<string, unknown>,
): Promise<unknown> {
  const key = tool.storage.key;
  switch (tool.storage.op) {
    case "get":
    case "list":
      return { key, value: await storageGet(appScope(appId), key) };

    case "set": {
      await storageSet(appScope(appId), key, args.value);
      return { ok: true };
    }

    case "append": {
      // Guard: tasks created through the assistant/MCP arrived without `status`
      // (`add_task` tool with no status field) → invisible in the kanban.
      // We inject a server-side default, scoped to the `tasks` key.
      const row = { ...(args as Record<string, unknown>) };
      if (key === "tasks" && (row.status === undefined || row.status === null || String(row.status).trim() === "")) {
        row.status = "todo";
      }
      const { changed } = await storageRowOp(appScope(appId), key, {
        kind: "add",
        row,
      });
      return changed;
    }

    case "remove": {
      const result = await storageRowOp(appScope(appId), key, { kind: "remove", id: String(args.id) });
      return { ok: true, removed: result.removed ?? 0 };
    }

    case "toggle": {
      try {
        const { changed } = await storageRowOp(appScope(appId), key, {
          kind: "toggle",
          id: String(args.id),
          field: typeof args.field === "string" ? args.field : undefined,
        });
        return changed;
      } catch (err) {
        // Compat: return the business error instead of throwing (legacy shape).
        if (err instanceof StorageRowError && err.code === "rowNotFound") {
          return { error: `Item ${args.id} not found.` };
        }
        throw err;
      }
    }

    case "update": {
      try {
        const rawPatch =
          args.patch != null && typeof args.patch === "object" && !Array.isArray(args.patch)
            ? (args.patch as Record<string, unknown>)
            : (() => {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { id: _id, ...rest } = args;
                return rest as Record<string, unknown>;
              })();
        if (Object.keys(rawPatch).length === 0) {
          throw new HttpError("No data to update.", 400, "invalidRowOp");
        }
        const { changed } = await storageRowOp(appScope(appId), key, {
          kind: "update",
          id: String(args.id),
          patch: rawPatch,
        });
        return changed;
      } catch (err) {
        if (err instanceof StorageRowError && err.code === "rowNotFound") {
          return { error: `Item ${args.id} not found.` };
        }
        throw err;
      }
    }
  }
}