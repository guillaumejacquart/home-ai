import { inArray, sql } from "drizzle-orm";

import { db, tables } from "@/db/client";
import type { ScriptRunStatus } from "@/db/schema";
import { listApps } from "@/services/apps/apps";
import { listConnections } from "@/services/connections/connections";
import { listScripts } from "@/services/scripts/scripts";

export interface DashboardData {
  counts: { apps: number; scriptsEnabled: number; scriptsTotal: number; connections: number };
  failingScripts: {
    id: string;
    name: string;
    status: ScriptRunStatus;
    error: string | null;
    lastRunAt: string | null;
  }[];
  brokenConnections: {
    id: string;
    label: string;
    type: string;
    status: string;
    lastError: string | null;
  }[];
  recentApps: {
    id: string;
    name: string;
    slug: string;
    hasUi: boolean;
    visibility: string;
    updatedAt: string;
  }[];
  upcomingScripts: {
    id: string;
    name: string;
    schedule: string;
    nextRunAt: string;
  }[];
}

/**
 * Status of each script's latest run. Relies on SQLite's `max()` behaviour
 * with GROUP BY: the bare columns come from the row that carries the
 * maximum.
 */
async function latestRunByScript(scriptIds: string[]) {
  if (scriptIds.length === 0) return new Map<string, { status: ScriptRunStatus; error: string | null }>();
  const rows = await db
    .select({
      scriptId: tables.scriptRuns.scriptId,
      status: tables.scriptRuns.status,
      error: tables.scriptRuns.error,
      startedAt: sql<number>`max(${tables.scriptRuns.startedAt})`,
    })
    .from(tables.scriptRuns)
    .where(inArray(tables.scriptRuns.scriptId, scriptIds))
    .groupBy(tables.scriptRuns.scriptId);
  return new Map(rows.map((r) => [r.scriptId, { status: r.status, error: r.error }]));
}

const RECENT_LIMIT = 6;

export async function getDashboard(userId: string): Promise<DashboardData> {
  const [apps, scripts, connections] = await Promise.all([
    listApps(userId),
    listScripts(userId),
    listConnections(userId),
  ]);

  const latest = await latestRunByScript(scripts.map((c) => c.id));

  const failingScripts = scripts
    .map((c) => ({ script: c, run: latest.get(c.id) }))
    .filter((x) => x.run && x.run.status !== "success" && x.run.status !== "running")
    .map(({ script, run }) => ({
      id: script.id,
      name: script.name,
      status: run!.status,
      error: run!.error,
      lastRunAt: script.lastRunAt?.toISOString() ?? null,
    }));
  const brokenConnections = connections
    .filter((c) => c.status !== "active")
    .map((c) => ({
      id: c.id,
      label: c.label,
      type: c.type,
      status: c.status,
      lastError: c.lastError,
    }));

  const recentApps = apps.slice(0, RECENT_LIMIT).map((a) => ({
    id: a.id,
    name: a.name,
    slug: a.slug,
    hasUi: a.hasUi,
    visibility: a.visibility,
    updatedAt: a.updatedAt.toISOString(),
  }));

  const upcomingScripts = scripts
    .filter((c) => c.enabled && c.nextRunAt)
    .sort((a, b) => a.nextRunAt!.getTime() - b.nextRunAt!.getTime())
    .slice(0, RECENT_LIMIT)
    .map((c) => ({
      id: c.id,
      name: c.name,
      schedule: c.schedule,
      nextRunAt: c.nextRunAt!.toISOString(),
    }));

  return {
    counts: {
      apps: apps.length,
      scriptsEnabled: scripts.filter((c) => c.enabled).length,
      scriptsTotal: scripts.length,
      connections: connections.length,
    },
    failingScripts,
    brokenConnections,
    recentApps,
    upcomingScripts,
  };
}
