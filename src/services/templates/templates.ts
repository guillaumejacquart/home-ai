import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { and, eq, isNotNull } from "drizzle-orm";

import { db, tables } from "@/db/client";
import { HttpError } from "@/lib/errors";
import { createApp } from "@/services/apps/apps";
import { extractManifestFromHtml } from "@/services/apps/manifest";
import { createVersion } from "@/services/apps/versions";
import { appScope, storageSet } from "@/services/storage/storage";

export class TemplateError extends HttpError {
  constructor(message: string, status = 400, code?: HttpError["code"]) {
    super(message, status, code);
    this.name = "TemplateError";
  }
}

export interface TemplateMeta {
  slug: string;
  name: string;
  description: string;
  tags: string[];
}

/** Template with the current user's installation state. */
export interface TemplateMetaWithInstall extends TemplateMeta {
  /** True when the user has already installed an app from this template. */
  installed: boolean;
}

export interface TemplateFull extends TemplateMeta {
  html: string;
  manifest: string | null;
}

function templatesDir(): string {
  return join(process.cwd(), "templates");
}

function readTemplateMeta(slug: string): TemplateMeta | null {
  try {
    const raw = readFileSync(join(templatesDir(), slug, "template.json"), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      slug,
      name: typeof parsed.name === "string" ? parsed.name : slug,
      description: typeof parsed.description === "string" ? parsed.description : "",
      tags: Array.isArray(parsed.tags) ? (parsed.tags as string[]) : [],
    };
  } catch {
    return null;
  }
}

function readTemplateHtml(slug: string): string | null {
  try {
    return readFileSync(join(templatesDir(), slug, "app.html"), "utf-8");
  } catch {
    return null;
  }
}

export function listTemplates(): TemplateMeta[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(templatesDir(), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
  const out: TemplateMeta[] = [];
  for (const slug of entries) {
    const meta = readTemplateMeta(slug);
    const html = readTemplateHtml(slug);
    if (meta && html) out.push(meta);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Lists the templates with per-user installation state: `installed` is true when
 * the user owns at least one app coming from that template (`sourceTemplate`).
 * The scope is the owner alone (everyone sees their own installs).
 */
export async function listTemplatesForUser(userId: string): Promise<TemplateMetaWithInstall[]> {
  const metas = listTemplates();
  if (metas.length === 0) return [];

  const rows = await db
    .select({ sourceTemplate: tables.apps.sourceTemplate })
    .from(tables.apps)
    .where(
      and(eq(tables.apps.ownerId, userId), isNotNull(tables.apps.sourceTemplate)),
    );

  const installed = new Set(rows.map((r) => r.sourceTemplate));
  return metas.map((m) => ({ ...m, installed: installed.has(m.slug) }));
}

export function getTemplate(slug: string): TemplateFull | null {
  const meta = readTemplateMeta(slug);
  const html = readTemplateHtml(slug);
  if (!meta || !html) return null;
  const manifestObj = extractManifestFromHtml(html);
  return {
    ...meta,
    html,
    manifest: manifestObj ? JSON.stringify(manifestObj) : null,
  };
}

export async function installTemplate(
  userId: string,
  slug: string,
  opts: { name?: string } = {},
): Promise<{ id: string; slug: string }> {
  const tpl = getTemplate(slug);
  if (!tpl) throw new TemplateError("Template not found.", 404, "appNotFound");
  const name = opts.name?.trim() || tpl.name;

  const app = await createApp(userId, {
    name,
    description: tpl.description || undefined,
    hasUi: true,
    sourceTemplate: slug,
  });

  await createVersion(app.id, {
    html: tpl.html,
    prompt: `Template: ${tpl.name}`,
    manifest: tpl.manifest,
  });

  // Seed declared table storages with empty array + schema so Data Studio
  // and the app have the right shape from the start.
  if (tpl.manifest) {
    try {
      const parsed = JSON.parse(tpl.manifest) as {
        storages?: { key: string; kind?: string; schema?: unknown }[];
      };
      for (const s of parsed.storages ?? []) {
        if (s.kind === "table") {
          await storageSet(appScope(app.id), s.key, [], { kind: "table", schema: s.schema });
        }
      }
    } catch {
      // Best-effort seeding — a missing or malformed manifest is already saved.
    }
  }

  return app;
}
