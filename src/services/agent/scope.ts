import { getApp } from "@/services/apps/apps";
import { currentHtml } from "@/services/apps/versions";
import { getScript } from "@/services/scripts/scripts";
import { extractStorageKeys, truncateCode, truncateHtml } from "@/services/generation/shared";
import { appScope, globalScope, scriptScope, storageGet } from "@/services/storage/storage";

export interface AgentScope {
  appId?: string | null;
  scriptId?: string | null;
  storage?: {
    scope: "app" | "global" | "script";
    key: string;
    appId?: string | null;
    scriptId?: string | null;
  } | null;
}

const STORAGE_PREVIEW_MAX = 4000;

/** Résout le scope effectif : la requête, complétée par le contexte du fil. */
export function resolveScope(
  requested: AgentScope | null | undefined,
  thread: { contextKind: string; contextId: string | null } | null,
): AgentScope | null {
  const scope: AgentScope = { ...(requested ?? {}) };
  if (thread?.contextId) {
    if (thread.contextKind === "app" && !scope.appId) scope.appId = thread.contextId;
    if (thread.contextKind === "script" && !scope.scriptId) scope.scriptId = thread.contextId;
  }
  return scope.appId || scope.scriptId || scope.storage ? scope : null;
}

async function scriptBlock(userId: string, scriptId: string): Promise<string | null> {
  const script = await getScript(scriptId, userId).catch(() => null);
  if (!script) return null;
  const parts = [
    `CONTEXTE STRICT — tu travailles sur le script « ${script.name} » (id ${script.id}, schedule ${script.schedule})`,
    `Code actuel (tronqué) :\n\`\`\`js\n${truncateCode(script.code, 8000)}\n\`\`\``,
  ];
  parts.push(
    "Consigne : reste sur ce script. Utilise plan_script puis generate_script. Ne touche pas aux autres sans demande explicite.",
  );
  return parts.join("\n\n");
}

async function appBlock(userId: string, appId: string): Promise<string | null> {
  const app = await getApp(userId, appId).catch(() => null);
  if (!app) return null;
  const parts = [
    `CONTEXTE STRICT — tu travailles sur l'app « ${app.name} » (slug ${app.slug}, id ${app.id}, visibilité ${app.visibility})`,
  ];
  if (app.description) parts.push(`Description : ${app.description}`);
  const html = await currentHtml(app.id).catch(() => null);
  if (html) {
    const keys = extractStorageKeys(html);
    if (keys.length) parts.push(`Clés storage : ${keys.join(", ")}`);
    parts.push(`Code HTML actuel (tronqué) :\n\`\`\`html\n${truncateHtml(html, 12000)}\n\`\`\``);
  } else {
    parts.push("Aucune version HTML pour l'instant (app vide).");
  }
  parts.push(
    "Consigne : reste sur cette app. Utilise plan_app puis generate_app. Ne touche pas aux autres sans demande explicite.",
  );
  return parts.join("\n\n");
}

async function storageBlock(
  userId: string,
  s: NonNullable<AgentScope["storage"]>,
): Promise<string | null> {
  let raw: unknown = null;
  if (s.scope === "app" && s.appId) {
    // L'accès à l'app conditionne l'accès à son storage.
    const app = await getApp(userId, s.appId).catch(() => null);
    if (app) raw = await storageGet(appScope(app.id), s.key).catch(() => null);
  } else if (s.scope === "script" && s.scriptId) {
    const script = await getScript(s.scriptId, userId).catch(() => null);
    if (script) raw = await storageGet(scriptScope(script.id), s.key).catch(() => null);
  } else if (s.scope === "global") {
    raw = await storageGet(globalScope(userId), s.key).catch(() => null);
  }

  const label = `clé "${s.key}" (${s.scope})`;
  if (raw === null || raw === undefined) return `CONTEXTE STORAGE — ${label} : (vide ou introuvable)`;

  let pretty: string;
  try {
    pretty = typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
  } catch {
    pretty = String(raw);
  }
  if (pretty.length > STORAGE_PREVIEW_MAX) {
    pretty = `${pretty.slice(0, STORAGE_PREVIEW_MAX)}\n… (tronqué)`;
  }
  return `CONTEXTE STORAGE — ${label} :\n\`\`\`json\n${pretty}\n\`\`\``;
}

/** Bloc de contexte injecté dans le prompt système pour un scope donné. */
export async function buildScopeBlock(
  userId: string,
  scope: AgentScope | null | undefined,
): Promise<string> {
  if (!scope) return "";
  const blocks: (string | null)[] = [];
  // Un script porte déjà son app liée : on n'ajoute pas le bloc app en double.
  if (scope.scriptId) blocks.push(await scriptBlock(userId, scope.scriptId));
  else if (scope.appId) blocks.push(await appBlock(userId, scope.appId));
  if (scope.storage) blocks.push(await storageBlock(userId, scope.storage));
  return blocks.filter(Boolean).join("\n\n");
}
