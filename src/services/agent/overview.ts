import { and, desc, eq } from "drizzle-orm";

import { db, tables } from "@/db/client";
import { listApps } from "@/services/apps/apps";
import { listScripts } from "@/services/scripts/scripts";
import { listDashboards } from "@/services/dashboards/dashboards";
import { listConnections } from "@/services/connections/connections";

export interface OverviewScriptHealth {
  id: string;
  name: string;
  enabled: boolean;
  triggerKind: string;
  schedule: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
}

export interface OverviewApp {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  hasUi: boolean;
  tags: string[] | null;
  updatedAt: string;
}

export interface OverviewDashboard {
  id: string;
  slug: string;
  name: string;
  description: string | null;
}

export interface OverviewStorage {
  scope: "app" | "global" | "script";
  appSlug?: string;
  key: string;
  kind: string;
  updatedAt: string;
  preview: string;
}

export interface PlatformOverview {
  generatedAt: string;
  counts: {
    apps: number;
    scripts: number;
    scriptsEnabled: number;
    dashboards: number;
    connections: number;
    memories: number;
  };
  connections: { type: string; label: string; status: string }[];
  apps: OverviewApp[];
  scriptsHealth: OverviewScriptHealth[];
  dashboards: OverviewDashboard[];
  recentStorages: OverviewStorage[];
  recentMemories: { kind: string; content: string; source: string }[];
  recentThreads: { title: string; updatedAt: string }[];
}

function toIso(d: Date | null | undefined): string | null {
  return d ? new Date(d).toISOString() : null;
}

function truncate(s: string, n = 100): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}

export async function getPlatformOverview(userId: string): Promise<PlatformOverview> {
  const [apps, scripts, dashboards, connections] = await Promise.all([
    listApps(userId).catch(() => []),
    listScripts(userId).catch(() => []),
    listDashboards(userId).catch(() => []),
    listConnections(userId).catch(() => []),
  ]);

  // Scripts health: last run per script
  const scriptsHealth: OverviewScriptHealth[] = [];
  for (const script of scripts.slice(0, 10)) {
    // last run
    let lastStatus: string | null = null;
    let lastError: string | null = null;
    let lastRunAt: string | null = null;
    try {
      const runs = await db
        .select({ status: tables.scriptRuns.status, error: tables.scriptRuns.error, startedAt: tables.scriptRuns.startedAt })
        .from(tables.scriptRuns)
        .where(eq(tables.scriptRuns.scriptId, script.id))
        .orderBy(desc(tables.scriptRuns.startedAt))
        .limit(1)
        .all();
      if (runs[0]) {
        lastStatus = runs[0].status;
        lastError = runs[0].error ? truncate(runs[0].error, 200) : null;
        lastRunAt = toIso(runs[0].startedAt as Date);
      }
    } catch {
      // ignore
    }
    scriptsHealth.push({
      id: script.id,
      name: script.name,
      enabled: Boolean(script.enabled),
      triggerKind: script.triggerKind,
      schedule: script.schedule,
      nextRunAt: toIso(script.nextRunAt as Date | null),
      lastRunAt,
      lastStatus,
      lastError,
    });
  }

  // Recent storages: app + global + script
  const recentStorages: OverviewStorage[] = [];
  try {
    const appStorages = await db
      .select({
        appId: tables.appStorage.appId,
        key: tables.appStorage.key,
        kind: tables.appStorage.kind,
        updatedAt: tables.appStorage.updatedAt,
        value: tables.appStorage.value,
      })
      .from(tables.appStorage)
      .orderBy(desc(tables.appStorage.updatedAt))
      .limit(5)
      .all();
    // Need to map appId -> slug for context
    const appMap = new Map<string, string>(apps.map((a) => [a.id, a.slug]));
    for (const s of appStorages) {
      // Only include if user owns the app (listApps already filtered, but storage could be from any app? Check)
      // We filter by appMap presence
      if (!appMap.has(s.appId)) continue;
      recentStorages.push({
        scope: "app",
        appSlug: appMap.get(s.appId),
        key: s.key,
        kind: s.kind,
        updatedAt: toIso(s.updatedAt as Date) ?? new Date().toISOString(),
        preview: truncate(s.value ?? "", 120),
      });
    }
  } catch {
    // ignore
  }
  try {
    const globalStorages = await db
      .select({
        key: tables.globalStorage.key,
        kind: tables.globalStorage.kind,
        updatedAt: tables.globalStorage.updatedAt,
        value: tables.globalStorage.value,
      })
      .from(tables.globalStorage)
      .where(eq(tables.globalStorage.ownerId, userId))
      .orderBy(desc(tables.globalStorage.updatedAt))
      .limit(5)
      .all();
    for (const s of globalStorages) {
      recentStorages.push({
        scope: "global",
        key: s.key,
        kind: s.kind,
        updatedAt: toIso(s.updatedAt as Date) ?? new Date().toISOString(),
        preview: truncate(s.value ?? "", 120),
      });
    }
  } catch {
    // ignore
  }

  // Sort storages by updatedAt desc and keep top 5
  recentStorages.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const topStorages = recentStorages.slice(0, 5);

  // Memories
  let recentMemories: { kind: string; content: string; source: string }[] = [];
  try {
    const mems = await db
      .select({ kind: tables.assistantMemory.kind, content: tables.assistantMemory.content, source: tables.assistantMemory.source })
      .from(tables.assistantMemory)
      .where(eq(tables.assistantMemory.userId, userId))
      .orderBy(desc(tables.assistantMemory.updatedAt))
      .limit(5)
      .all();
    recentMemories = mems.map((m) => ({ kind: m.kind, content: truncate(m.content, 120), source: m.source }));
  } catch {
    // ignore
  }

  // Recent threads
  let recentThreads: { title: string; updatedAt: string }[] = [];
  try {
    const threads = await db
      .select({ title: tables.assistantThreads.title, updatedAt: tables.assistantThreads.updatedAt })
      .from(tables.assistantThreads)
      .where(and(eq(tables.assistantThreads.userId, userId), eq(tables.assistantThreads.contextKind, "assistant")))
      .orderBy(desc(tables.assistantThreads.updatedAt))
      .limit(3)
      .all();
    recentThreads = threads.map((t) => ({ title: t.title, updatedAt: toIso(t.updatedAt as Date) ?? "" }));
  } catch {
    // ignore
  }

  // Memories count
  let memoriesCount = recentMemories.length;
  try {
    const allMems = await db
      .select()
      .from(tables.assistantMemory)
      .where(eq(tables.assistantMemory.userId, userId))
      .all();
    memoriesCount = allMems.length;
  } catch {
    // keep
  }

  const overview: PlatformOverview = {
    generatedAt: new Date().toISOString(),
    counts: {
      apps: apps.length,
      scripts: scripts.length,
      scriptsEnabled: scripts.filter((c) => c.enabled).length,
      dashboards: dashboards.length,
      connections: connections.length,
      memories: memoriesCount,
    },
    connections: connections.map((c) => ({ type: c.type, label: c.label, status: c.status })),
    apps: apps.slice(0, 10).map((a) => ({
      id: a.id,
      slug: a.slug,
      name: a.name,
      description: a.description,
      hasUi: Boolean(a.hasUi),
      tags: a.tags,
      updatedAt: toIso((a.updatedAt as unknown as Date) ?? new Date()) ?? new Date().toISOString(),
    })),
    scriptsHealth,
    dashboards: dashboards.slice(0, 10).map((d) => ({
      id: d.id,
      slug: d.slug,
      name: d.name,
      description: d.description,
    })),
    recentStorages: topStorages,
    recentMemories,
    recentThreads,
  };

  return overview;
}
