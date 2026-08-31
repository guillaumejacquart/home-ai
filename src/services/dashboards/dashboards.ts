import { desc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { db, tables } from "@/db/client";
import type { AppVisibility } from "@/db/schema";
import { HttpError } from "@/lib/errors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export class DashboardError extends HttpError {
  constructor(message: string) {
    super(message, 400);
  }
}

export interface DashboardWidget {
  i: string; // unique id in grid
  appId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title?: string;
}

export interface DashboardLayout {
  cols: 12;
  widgets: DashboardWidget[];
}

export interface DashboardRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  ownerId: string;
  visibility: AppVisibility;
  layout: DashboardLayout;
  createdAt: Date;
  updatedAt: Date;
}

function now() {
  return new Date();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "dashboard";
}

async function uniqueDashboardSlug(base: string): Promise<string> {
  let slug = base;
  let i = 1;
  while (
    await db
      .select({ id: tables.dashboards.id })
      .from(tables.dashboards)
      .where(eq(tables.dashboards.slug, slug))
      .get()
  ) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

function parseLayout(raw: string | null): DashboardLayout {
  if (!raw) return { cols: 12, widgets: [] };
  try {
    const parsed = JSON.parse(raw) as DashboardLayout;
    if (parsed.cols !== 12 || !Array.isArray(parsed.widgets)) {
      return { cols: 12, widgets: [] };
    }
    return parsed;
  } catch {
    return { cols: 12, widgets: [] };
  }
}

function serializeLayout(layout: DashboardLayout): string {
  return JSON.stringify(layout);
}

function toRow(row: typeof tables.dashboards.$inferSelect): DashboardRow {
  return {
    ...row,
    layout: parseLayout(row.layout),
    visibility: row.visibility as AppVisibility,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateLayout(layout: unknown): DashboardLayout {
  if (!layout || typeof layout !== "object") {
    throw new DashboardError("Layout invalide.");
  }
  const l = layout as Record<string, unknown>;
  if (l.cols !== 12) throw new DashboardError("Le layout doit avoir 12 colonnes.");
  if (!Array.isArray(l.widgets)) throw new DashboardError("Widgets doit être un tableau.");
  if (l.widgets.length > 20) throw new DashboardError("Maximum 20 widgets par tableau.");

  const ids = new Set<string>();
  const widgets: DashboardWidget[] = [];
  for (const raw of l.widgets) {
    if (!raw || typeof raw !== "object") throw new DashboardError("Widget invalide.");
    const w = raw as Record<string, unknown>;
    if (typeof w.i !== "string" || !w.i.trim()) throw new DashboardError("Widget id manquant.");
    if (ids.has(w.i)) throw new DashboardError(`Widget id dupliqué: ${w.i}`);
    ids.add(w.i);
    if (typeof w.appId !== "string" || !w.appId.trim()) {
      throw new DashboardError(`App manquante pour le widget ${w.i}.`);
    }
    const x = Number(w.x);
    const y = Number(w.y);
    const ww = Number(w.w);
    const h = Number(w.h);
    if (!Number.isInteger(x) || x < 0 || x > 11) throw new DashboardError(`x invalide pour ${w.i}`);
    if (!Number.isInteger(y) || y < 0) throw new DashboardError(`y invalide pour ${w.i}`);
    if (!Number.isInteger(ww) || ww < 2 || ww > 12) throw new DashboardError(`w invalide pour ${w.i} (2-12)`);
    if (!Number.isInteger(h) || h < 2 || h > 12) throw new DashboardError(`h invalide pour ${w.i} (2-12)`);
    if (x + ww > 12) throw new DashboardError(`Widget ${w.i} dépasse la grille (x+w > 12).`);
    if (w.title !== undefined && typeof w.title !== "string") {
      throw new DashboardError(`title invalide pour ${w.i}`);
    }
    widgets.push({
      i: w.i,
      appId: String(w.appId),
      x,
      y,
      w: ww,
      h,
      title: typeof w.title === "string" ? w.title.slice(0, 80) : undefined,
    });
  }
  return { cols: 12, widgets };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createDashboard(
  userId: string,
  input: { name: string; description?: string; visibility?: AppVisibility; slug?: string },
) {
  if (!input.name?.trim()) throw new DashboardError("Le nom est requis.");
  const slug = await uniqueDashboardSlug(input.slug ?? slugify(input.name));
  const id = randomUUID();
  const vis: AppVisibility = input.visibility === "family" ? "family" : "private";
  await db.insert(tables.dashboards).values({
    id,
    slug,
    name: input.name.trim().slice(0, 80),
    description: input.description?.trim().slice(0, 500) ?? null,
    ownerId: userId,
    visibility: vis,
    layout: serializeLayout({ cols: 12, widgets: [] }),
    createdAt: now(),
    updatedAt: now(),
  });
  return { id, slug };
}

export async function getDashboard(userId: string, id: string): Promise<DashboardRow | null> {
  const row = await db
    .select()
    .from(tables.dashboards)
    .where(eq(tables.dashboards.id, id))
    .get();
  if (!row) return null;
  if (row.ownerId !== userId && row.visibility !== "family") return null;
  return toRow(row);
}

export async function getDashboardBySlug(userId: string, slug: string): Promise<DashboardRow | null> {
  const row = await db
    .select()
    .from(tables.dashboards)
    .where(eq(tables.dashboards.slug, slug))
    .get();
  if (!row) return null;
  if (row.ownerId !== userId && row.visibility !== "family") return null;
  return toRow(row);
}

export async function listDashboards(userId: string): Promise<DashboardRow[]> {
  const rows = await db
    .select()
    .from(tables.dashboards)
    .where(sql`${tables.dashboards.ownerId} = ${userId} OR ${tables.dashboards.visibility} = 'family'`)
    .orderBy(desc(tables.dashboards.updatedAt));
  return rows.map(toRow);
}

export async function updateDashboard(
  userId: string,
  id: string,
  patch: { name?: string; description?: string; visibility?: AppVisibility; layout?: DashboardLayout },
) {
  const existing = await db
    .select()
    .from(tables.dashboards)
    .where(eq(tables.dashboards.id, id))
    .get();
  if (!existing) throw new DashboardError("Tableau introuvable.");
  if (existing.ownerId !== userId) throw new DashboardError("Action non autorisée.");
  // On vérifie l'accès via getDashboard pour respecter la visibilité, mais update exige owner.
  if (patch.visibility && patch.visibility !== "private" && patch.visibility !== "family") {
    throw new DashboardError("Visibilité invalide.");
  }
  if (patch.name !== undefined && !patch.name.trim()) {
    throw new DashboardError("Le nom ne peut pas être vide.");
  }
  // Si un layout est fourni, on valide et on vérifie que chaque appId est visible par le propriétaire.
  let layoutStr: string | undefined;
  if (patch.layout !== undefined) {
    const validated = validateLayout(patch.layout);
    // Vérifie que chaque app référencée est visible par le owner (pas forcément par le viewer)
    for (const w of validated.widgets) {
      const app = await db
        .select({ id: tables.apps.id, ownerId: tables.apps.ownerId, visibility: tables.apps.visibility })
        .from(tables.apps)
        .where(eq(tables.apps.id, w.appId))
        .get();
      if (!app) throw new DashboardError(`App introuvable: ${w.appId}`);
      if (app.ownerId !== userId && app.visibility !== "family") {
        throw new DashboardError(`App non accessible: ${w.appId}`);
      }
    }
    layoutStr = serializeLayout(validated);
  }
  const set: Record<string, unknown> = { updatedAt: now() };
  if (patch.name !== undefined) set.name = patch.name.trim().slice(0, 80);
  if (patch.description !== undefined) set.description = patch.description.trim().slice(0, 500) || null;
  if (patch.visibility !== undefined) set.visibility = patch.visibility;
  if (layoutStr !== undefined) set.layout = layoutStr;
  await db.update(tables.dashboards).set(set).where(eq(tables.dashboards.id, id));
}

export async function deleteDashboard(userId: string, id: string) {
  const row = await db
    .select()
    .from(tables.dashboards)
    .where(eq(tables.dashboards.id, id))
    .get();
  if (!row) throw new DashboardError("Tableau introuvable.");
  if (row.ownerId !== userId) throw new DashboardError("Action non autorisée.");
  await db.delete(tables.dashboards).where(eq(tables.dashboards.id, id));
}

/** Filtre les widgets dont l'app n'est pas visible pour le viewer. */
export async function sanitizeLayoutForViewer(
  layout: DashboardLayout,
  viewerId: string,
): Promise<DashboardLayout> {
  const filtered: DashboardWidget[] = [];
  for (const w of layout.widgets) {
    const app = await db
      .select({ ownerId: tables.apps.ownerId, visibility: tables.apps.visibility })
      .from(tables.apps)
      .where(eq(tables.apps.id, w.appId))
      .get();
    if (!app) continue;
    if (app.ownerId !== viewerId && app.visibility !== "family") continue;
    filtered.push(w);
  }
  return { cols: 12, widgets: filtered };
}

// ---------------------------------------------------------------------------
// Widgets (manipulation programmatique, utilisée par l'assistant)
// ---------------------------------------------------------------------------

function widgetsOverlap(a: DashboardWidget, b: DashboardWidget): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

/**
 * Ajoute un widget au premier emplacement libre de la grille. Retourne le
 * widget créé. Refuse les doublons (une app par widget).
 */
export async function addDashboardWidget(
  userId: string,
  dashboardId: string,
  appId: string,
  opts: { title?: string; w?: number; h?: number } = {},
): Promise<DashboardWidget> {
  const dash = await getDashboard(userId, dashboardId);
  if (!dash) throw new DashboardError("Tableau introuvable.");
  if (dash.ownerId !== userId) throw new DashboardError("Action non autorisée.");

  const app = await db
    .select({ id: tables.apps.id, ownerId: tables.apps.ownerId, visibility: tables.apps.visibility })
    .from(tables.apps)
    .where(eq(tables.apps.id, appId))
    .get();
  if (!app) throw new DashboardError(`App introuvable : ${appId}`);
  if (app.ownerId !== userId && app.visibility !== "family") {
    throw new DashboardError(`App non accessible : ${appId}`);
  }

  const widgets = dash.layout.widgets;
  if (widgets.some((w) => w.appId === appId)) {
    throw new DashboardError("Cette app est déjà dans le tableau.");
  }
  if (widgets.length >= 20) throw new DashboardError("Maximum 20 widgets par tableau.");

  const w = Math.max(2, Math.min(12, opts.w ?? 4));
  const h = Math.max(2, Math.min(12, opts.h ?? 4));

  // Premier emplacement libre (balayage ligne par ligne, colonne par colonne).
  let x = 0;
  let y = 0;
  outer: for (let yy = 0; yy < 100; yy++) {
    for (let xx = 0; xx + w <= 12; xx++) {
      const candidate: DashboardWidget = { i: "", appId, x: xx, y: yy, w, h };
      if (!widgets.some((wid) => widgetsOverlap(candidate, wid))) {
        x = xx;
        y = yy;
        break outer;
      }
    }
  }

  const widget: DashboardWidget = {
    i: randomUUID(),
    appId,
    x,
    y,
    w,
    h,
    title: opts.title,
  };
  const layout: DashboardLayout = { cols: 12, widgets: [...widgets, widget] };
  validateLayout(layout);
  await db
    .update(tables.dashboards)
    .set({ layout: serializeLayout(layout), updatedAt: now() })
    .where(eq(tables.dashboards.id, dashboardId));
  return widget;
}

/** Retire un widget d'un tableau (par son id de grille). */
export async function removeDashboardWidget(
  userId: string,
  dashboardId: string,
  widgetId: string,
): Promise<void> {
  const dash = await getDashboard(userId, dashboardId);
  if (!dash) throw new DashboardError("Tableau introuvable.");
  if (dash.ownerId !== userId) throw new DashboardError("Action non autorisée.");

  const widgets = dash.layout.widgets.filter((w) => w.i !== widgetId);
  if (widgets.length === dash.layout.widgets.length) {
    throw new DashboardError("Widget introuvable.");
  }
  await db
    .update(tables.dashboards)
    .set({ layout: serializeLayout({ cols: 12, widgets }), updatedAt: now() })
    .where(eq(tables.dashboards.id, dashboardId));
}
