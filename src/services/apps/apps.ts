import { and, desc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { db, tables } from "@/db/client";
import type { AppVisibility } from "@/db/schema";
import { HttpError } from "@/lib/errors";
import { parseTags, serializeTags } from "@/lib/tags";

export class AppError extends HttpError {
  constructor(message: string) {
    super(message, 400);
  }
}

function now() {
  return new Date();
}

export interface NewAppInput {
  name: string;
  description?: string;
  hasUi?: boolean;
  slug?: string;
  /** Slug de la template d'origine si l'app a été installée depuis un modèle. */
  sourceTemplate?: string | null;
}

/** Génère un slug lisible unique à partir d'un nom. */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "app";
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let i = 1;
  // Boucle tant que le slug existe déjà.
  while (
    await db
      .select({ id: tables.apps.id })
      .from(tables.apps)
      .where(eq(tables.apps.slug, slug))
      .get()
  ) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

export async function createApp(userId: string, input: NewAppInput) {
  const slug = await uniqueSlug(input.slug ?? slugify(input.name));
  const id = randomUUID();
  await db.insert(tables.apps).values({
    id,
    slug,
    name: input.name,
    description: input.description,
    ownerId: userId,
    visibility: "private",
    hasUi: input.hasUi ?? false,
    sourceTemplate: input.sourceTemplate ?? null,
    createdAt: now(),
    updatedAt: now(),
  });
  return { id, slug };
}

/** Récupère une app si l'utilisateur y a accès (propriétaire ou visibilité famille). */
export async function getApp(userId: string, id: string) {
  const row = await db
    .select()
    .from(tables.apps)
    .where(eq(tables.apps.id, id))
    .get();
  if (!row) return null;
  if (row.ownerId !== userId && row.visibility !== "family") return null;
  return row;
}

export async function listApps(userId: string) {
  const rows = await db
    .select()
    .from(tables.apps)
    .where(sql`${tables.apps.ownerId} = ${userId} OR ${tables.apps.visibility} = 'family'`)
    .orderBy(desc(tables.apps.updatedAt));
  // Enrichit avec métadonnées utiles aux cards (hasHtml, manifestKeys, lastPrompt, versionCount) sans casser l'API existante
  const enriched = await Promise.all(
    rows.map(async (r) => {
      const tags = parseTags(r.tags);
      let manifestKeys: string[] = [];
      if (r.manifest) {
        try {
          const parsed = JSON.parse(r.manifest) as { storages?: { key: string }[]; tools?: unknown[] };
          manifestKeys = (parsed.storages ?? []).map((s) => s.key).filter(Boolean);
        } catch {}
      }
      // latest version for prompt / hasHtml
      const latest = await db
        .select({ prompt: tables.appVersions.prompt, html: tables.appVersions.html })
        .from(tables.appVersions)
        .where(eq(tables.appVersions.appId, r.id))
        .orderBy(desc(tables.appVersions.version))
        .get();
      const hasHtml = Boolean(latest?.html ?? (r.currentVersionId ? true : false));
      const lastPrompt = latest?.prompt ?? null;
      const countRow = await db
        .select({ c: sql<number>`count(*)` })
        .from(tables.appVersions)
        .where(eq(tables.appVersions.appId, r.id))
        .get();
      const versionCount = Number(countRow?.c ?? 0);
      return { ...r, tags, manifestKeys, hasHtml, lastPrompt, versionCount };
    }),
  );
  return enriched;
}

/** Récupère une app par slug si l'utilisateur y a accès. */
export async function getAppBySlug(userId: string, slug: string) {
  const row = await db
    .select()
    .from(tables.apps)
    .where(eq(tables.apps.slug, slug))
    .get();
  if (!row) return null;
  if (row.ownerId !== userId && row.visibility !== "family") return null;
  return row;
}

export async function updateApp(
  userId: string,
  id: string,
  patch: {
    name?: string;
    description?: string;
    visibility?: AppVisibility;
    tags?: string[];
    manifest?: string | null;
  },
) {
  const app = await getApp(userId, id);
  if (!app) throw new AppError("App introuvable.");
  const { tags, manifest, ...rest } = patch;
  const set: Record<string, unknown> = { ...rest, updatedAt: now() };
  if (tags !== undefined) set.tags = serializeTags(tags);
  if (manifest !== undefined) set.manifest = manifest;
  await db.update(tables.apps).set(set).where(eq(tables.apps.id, id));
}

export async function deleteApp(userId: string, id: string) {
  const app = await getApp(userId, id);
  if (!app) throw new AppError("App introuvable.");
  await db
    .delete(tables.assistantThreads)
    .where(and(eq(tables.assistantThreads.contextKind, "app"), eq(tables.assistantThreads.contextId, id)));
  await db.delete(tables.apps).where(eq(tables.apps.id, id));
}

/** Propriétaire d'une app (pour rattacher un message de génération). */
export async function getAppOwnerId(id: string): Promise<string | null> {
  const row = await db
    .select({ ownerId: tables.apps.ownerId })
    .from(tables.apps)
    .where(eq(tables.apps.id, id))
    .get();
  return row?.ownerId ?? null;
}
