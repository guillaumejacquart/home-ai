import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { db, tables } from "@/db/client";
import { AppError } from "@/services/apps/apps";

function now() {
  return new Date();
}

export async function createVersion(
  appId: string,
  input: { html?: string; prompt?: string; model?: string; manifest?: string | null },
) {
  const last = await db
    .select({ version: tables.appVersions.version })
    .from(tables.appVersions)
    .where(eq(tables.appVersions.appId, appId))
    .orderBy(desc(tables.appVersions.version))
    .get();

  const version = (last?.version ?? 0) + 1;
  const id = randomUUID();
  await db.insert(tables.appVersions).values({
    id,
    appId,
    version,
    html: input.html,
    prompt: input.prompt,
    model: input.model,
    manifest: input.manifest ?? null,
    createdAt: now(),
  });

  // Updates the current version and hasUi (when HTML is provided).
  await db
    .update(tables.apps)
    .set({
      currentVersionId: id,
      hasUi: input.html != null ? true : undefined,
      manifest: input.manifest !== undefined ? input.manifest : undefined,
      updatedAt: now(),
    })
    .where(eq(tables.apps.id, appId));

  return { id, version };
}

export async function listVersions(appId: string) {
  return db
    .select()
    .from(tables.appVersions)
    .where(eq(tables.appVersions.appId, appId))
    .orderBy(desc(tables.appVersions.version));
}

export async function getVersion(appId: string, versionId: string) {
  return db
    .select()
    .from(tables.appVersions)
    .where(and(eq(tables.appVersions.id, versionId), eq(tables.appVersions.appId, appId)))
    .get();
}

export async function rollbackToVersion(appId: string, versionId: string) {
  const version = await getVersion(appId, versionId);
  if (!version) throw new AppError("Version not found.");
  await db
    .update(tables.apps)
    .set({
      currentVersionId: version.id,
      manifest: version.manifest ?? null,
      updatedAt: now(),
    })
    .where(eq(tables.apps.id, appId));
  return version;
}

/** HTML of an app's current version (or null if none). */
export async function currentHtml(appId: string): Promise<string | null> {
  const app = await db
    .select()
    .from(tables.apps)
    .where(eq(tables.apps.id, appId))
    .get();
  if (!app?.currentVersionId) return null;
  const v = await getVersion(appId, app.currentVersionId);
  const html = v?.html;
  if (!html) return null;
  // Defensive cleanup: strips a leading markdown marker left over (older runs).
  return html.trim().replace(/^```html\s*/i, "").replace(/^```\s*/, "").replace(/\s*```$/, "");
}