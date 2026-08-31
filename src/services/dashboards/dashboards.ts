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
    throw new DashboardError("Invalid layout.");
  }
  const l = layout as Record<string, unknown>;
  if (l.cols !== 12) throw new DashboardError("The layout must have 12 columns.");
  if (!Array.isArray(l.widgets)) throw new DashboardError("Widgets must be an array.");
  if (l.widgets.length > 20) throw new DashboardError("Maximum 20 widgets per dashboard.");

  const ids = new Set<string>();
  const widgets: DashboardWidget[] = [];
  for (const raw of l.widgets) {
    if (!raw || typeof raw !== "object") throw new DashboardError("Invalid widget.");
    const w = raw as Record<string, unknown>;
    if (typeof w.i !== "string" || !w.i.trim()) throw new DashboardError("Missing widget id.");
    if (ids.has(w.i)) throw new DashboardError(`Duplicate widget id: ${w.i}`);
    ids.add(w.i);
    if (typeof w.appId !== "string" || !w.appId.trim()) {
      throw new DashboardError(`Missing app for widget ${w.i}.`);
    }
    const x = Number(w.x);
    const y = Number(w.y);
    const ww = Number(w.w);
    const h = Number(w.h);
    if (!Number.isInteger(x) || x < 0 || x > 11) throw new DashboardError(`invalid x for ${w.i}`);
    if (!Number.isInteger(y) || y < 0) throw new DashboardError(`invalid y for ${w.i}`);
    if (!Number.isInteger(ww) || ww < 2 || ww > 12) throw new DashboardError(`invalid w for ${w.i} (2-12)`);
    if (!Number.isInteger(h) || h < 2 || h > 12) throw new DashboardError(`invalid h for ${w.i} (2-12)`);
    if (x + ww > 12) throw new DashboardError(`Widget ${w.i} overflows the grid (x+w > 12).`);
    if (w.title !== undefined && typeof w.title !== "string") {
      throw new DashboardError(`invalid title for ${w.i}`);
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
  if (!input.name?.trim()) throw new DashboardError("The name is required.");
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
  if (!existing) throw new DashboardError("Dashboard not found.");
  if (existing.ownerId !== userId) throw new DashboardError("Action not allowed.");
  // Access is checked through getDashboard to honour visibility, but update requires the owner.
  if (patch.visibility && patch.visibility !== "private" && patch.visibility !== "family") {
    throw new DashboardError("Invalid visibility.");
  }
  if (patch.name !== undefined && !patch.name.trim()) {
    throw new DashboardError("The name cannot be empty.");
  }
  // When a layout is provided, validate it and check every appId is visible to the owner.
  let layoutStr: string | undefined;
  if (patch.layout !== undefined) {
    const validated = validateLayout(patch.layout);
    // Check every referenced app is visible to the owner (not necessarily to the viewer)
    for (const w of validated.widgets) {
      const app = await db
        .select({ id: tables.apps.id, ownerId: tables.apps.ownerId, visibility: tables.apps.visibility })
        .from(tables.apps)
        .where(eq(tables.apps.id, w.appId))
        .get();
      if (!app) throw new DashboardError(`App not found: ${w.appId}`);
      if (app.ownerId !== userId && app.visibility !== "family") {
        throw new DashboardError(`App not accessible: ${w.appId}`);
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
  if (!row) throw new DashboardError("Dashboard not found.");
  if (row.ownerId !== userId) throw new DashboardError("Action not allowed.");
  await db.delete(tables.dashboards).where(eq(tables.dashboards.id, id));
}

/** Filters out widgets whose app is not visible to the viewer. */
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
// Widgets (programmatic manipulation, used by the assistant)
// ---------------------------------------------------------------------------

function widgetsOverlap(a: DashboardWidget, b: DashboardWidget): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

/**
 * Adds a widget to the grid's first free spot. Returns the
 * created widget. Rejects duplicates (one app per widget).
 */
export async function addDashboardWidget(
  userId: string,
  dashboardId: string,
  appId: string,
  opts: { title?: string; w?: number; h?: number } = {},
): Promise<DashboardWidget> {
  const dash = await getDashboard(userId, dashboardId);
  if (!dash) throw new DashboardError("Dashboard not found.");
  if (dash.ownerId !== userId) throw new DashboardError("Action not allowed.");

  const app = await db
    .select({ id: tables.apps.id, ownerId: tables.apps.ownerId, visibility: tables.apps.visibility })
    .from(tables.apps)
    .where(eq(tables.apps.id, appId))
    .get();
  if (!app) throw new DashboardError(`App not found: ${appId}`);
  if (app.ownerId !== userId && app.visibility !== "family") {
    throw new DashboardError(`App not accessible: ${appId}`);
  }

  const widgets = dash.layout.widgets;
  if (widgets.some((w) => w.appId === appId)) {
    throw new DashboardError("This app is already on the dashboard.");
  }
  if (widgets.length >= 20) throw new DashboardError("Maximum 20 widgets per dashboard.");

  const w = Math.max(2, Math.min(12, opts.w ?? 4));
  const h = Math.max(2, Math.min(12, opts.h ?? 4));

  // First free spot (scanning row by row, column by column).
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

/** Removes a widget from a dashboard (by its grid id). */
export async function removeDashboardWidget(
  userId: string,
  dashboardId: string,
  widgetId: string,
): Promise<void> {
  const dash = await getDashboard(userId, dashboardId);
  if (!dash) throw new DashboardError("Dashboard not found.");
  if (dash.ownerId !== userId) throw new DashboardError("Action not allowed.");

  const widgets = dash.layout.widgets.filter((w) => w.i !== widgetId);
  if (widgets.length === dash.layout.widgets.length) {
    throw new DashboardError("Widget not found.");
  }
  await db
    .update(tables.dashboards)
    .set({ layout: serializeLayout({ cols: 12, widgets }), updatedAt: now() })
    .where(eq(tables.dashboards.id, dashboardId));
}
