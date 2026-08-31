import { z } from "zod";

import { appScope, storageGet, storageRowOp, storageSet } from "@/services/storage/storage";
import { jsonSchemaToZod } from "@/lib/json-schema";
import { HttpError, StorageRowError } from "@/lib/errors";

// Ré-export pour compatibilité : l'implémentation vit désormais dans
// src/lib/json-schema.ts (importable côté client).
export { jsonSchemaToZod };

/**
 * Manifeste d'exposition d'une app : déclare les storages utilisés et les
 * tools que l'app expose au MCP / Assistant. Il est extrait du HTML généré
 * (script `#home-manifest`) ou édité à la main, validé strictement par zod,
 * stocké sur `apps.manifest` et `app_versions.manifest`.
 *
 * Le mapping est volontairement déclaratif (op + clé), jamais de code JS : on
 * limite l'injection via un HTML généré par LLM.
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
  // JSON Schema des arguments du tool (type/properties/required).
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

/** Nombre max de tools totaux exposés au LLM (assistant) pour éviter l'explosion. */
export const MAX_MANIFEST_TOOLS_TOTAL = 50;

const MANIFEST_RE =
  /<script[^>]*id=["']home-manifest["'][^>]*>\s*([\s\S]*?)\s*<\/script>/i;

/** Extrait et valide le manifeste depuis le HTML d'une app (null si absent/invalide). */
export function extractManifestFromHtml(html: string): AppManifest | null {
  const m = html.match(MANIFEST_RE);
  if (!m?.[1]) return null;
  return parseManifest(m[1]);
}

/** Parse une chaîne JSON brute stockée en DB. */
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
 * Exécute un tool déclaré par le manifeste d'une app contre son storage.
 * Les args sont déjà validés contre le schéma déclaré par la couche appelante.
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
      // Garde : les tâches créées via l'assistant/MCP arrivaient sans `status`
      // (outil `add_task` sans champ status) → invisibles dans le kanban.
      // On injecte un défaut côté serveur, scopé à la clé `tasks`.
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
        // Compat : renvoyer l'erreur métier au lieu de jeter (shape historique).
        if (err instanceof StorageRowError && err.code === "rowNotFound") {
          return { error: `Élément ${args.id} introuvable.` };
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
          throw new HttpError("Aucune donnée à mettre à jour.", 400, "invalidRowOp");
        }
        const { changed } = await storageRowOp(appScope(appId), key, {
          kind: "update",
          id: String(args.id),
          patch: rawPatch,
        });
        return changed;
      } catch (err) {
        if (err instanceof StorageRowError && err.code === "rowNotFound") {
          return { error: `Élément ${args.id} introuvable.` };
        }
        throw err;
      }
    }
  }
}