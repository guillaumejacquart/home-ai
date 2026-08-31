import { and, desc, eq, inArray } from "drizzle-orm";

import { db, tables } from "@/db/client";
import { parseTags } from "@/lib/tags";
import { describeSchedule, formatRoutine, type RoutineDescriptor } from "./schedule";
import { matchMemoryToApps, matchMemoryToStorages } from "./match";
import type {
  AppMatchTarget,
  StorageMatchTarget,
} from "./match";
import type {
  UserStateEdge,
  UserStateGraph,
  UserStateNode,
} from "./types";

const STORAGE_LIMIT = 50;

function toIso(d: Date | null | undefined): string | null {
  return d ? new Date(d).toISOString() : null;
}

export { describeSchedule, matchMemoryToApps, matchMemoryToStorages };

/** Flattens a routine descriptor into interpolation values for the UI. */
function routineParams(routine: RoutineDescriptor): Record<string, string | number> {
  if (routine.key === "hourly") return {};
  if (routine.key === "weekly") return { weekday: routine.weekday, hour: routine.hour };
  if (routine.key === "monthly") return { day: routine.day, hour: routine.hour };
  return { hour: routine.hour };
}
export type { AppMatchTarget, StorageMatchTarget };

// ---------------------------------------------------------------------------
// Building the graph
// ---------------------------------------------------------------------------

export async function getUserStateGraph(userId: string): Promise<UserStateGraph> {
  const generatedAt = new Date();
  const nodes: UserStateNode[] = [];
  const edges: UserStateEdge[] = [];

  const [apps, scripts, conns, memories] = await Promise.all([
    db.select().from(tables.apps).where(eq(tables.apps.ownerId, userId)).all(),
    // Explicit selection: the database can lag behind the schema (WIP
    // migrations, e.g. scripts.trigger_kind). Only select columns that exist.
    db
      .select({
        id: tables.scripts.id,
        ownerId: tables.scripts.ownerId,
        triggerKind: tables.scripts.triggerKind,
        name: tables.scripts.name,
        schedule: tables.scripts.schedule,
        enabled: tables.scripts.enabled,
        nextRunAt: tables.scripts.nextRunAt,
        updatedAt: tables.scripts.updatedAt,
      })
      .from(tables.scripts)
      .where(eq(tables.scripts.ownerId, userId))
      .all(),
    db
      .select()
      .from(tables.connections)
      .where(eq(tables.connections.userId, userId))
      .all(),
    db
      .select()
      .from(tables.assistantMemory)
      .where(eq(tables.assistantMemory.userId, userId))
      .orderBy(desc(tables.assistantMemory.pinned), desc(tables.assistantMemory.updatedAt))
      .all(),
  ]);

  const appIds = apps.map((a) => a.id);
  const scriptIds = scripts.map((c) => c.id);

  const [appStorages, globalStorages, scriptStorages, threads] = await Promise.all([
    appIds.length
      ? db
          .select()
          .from(tables.appStorage)
          .where(inArray(tables.appStorage.appId, appIds))
          .orderBy(desc(tables.appStorage.updatedAt))
          .limit(STORAGE_LIMIT)
          .all()
      : [],
    db
      .select()
      .from(tables.globalStorage)
      .where(eq(tables.globalStorage.ownerId, userId))
      .orderBy(desc(tables.globalStorage.updatedAt))
      .limit(STORAGE_LIMIT)
      .all(),
    scriptIds.length
      ? db
          .select()
          .from(tables.scriptStorage)
          .where(inArray(tables.scriptStorage.scriptId, scriptIds))
          .orderBy(desc(tables.scriptStorage.updatedAt))
          .limit(STORAGE_LIMIT)
          .all()
      : [],
    db
      .select({
        id: tables.assistantThreads.id,
        title: tables.assistantThreads.title,
        contextKind: tables.assistantThreads.contextKind,
        contextId: tables.assistantThreads.contextId,
        updatedAt: tables.assistantThreads.updatedAt,
      })
      .from(tables.assistantThreads)
      .where(
        and(
          eq(tables.assistantThreads.userId, userId),
          inArray(tables.assistantThreads.contextKind, ["app", "script"]),
        ),
      )
      .orderBy(desc(tables.assistantThreads.updatedAt))
      .limit(20)
      .all(),
  ]);

  const userNodeId = `user:${userId}`;
  nodes.push({ id: userNodeId, kind: "user", label: "User", labelKey: "user", updatedAt: null });

  // Connections
  for (const c of conns) {
    const id = `conn:${c.id}`;
    nodes.push({
      id,
      kind: "connection",
      label: c.label,
      data: { type: c.type, status: c.status },
      updatedAt: toIso(c.updatedAt),
    });
    edges.push({ from: userNodeId, to: id, kind: "OWNS", weight: 1 });
  }

  // Apps
  const appById = new Map<string, (typeof apps)[number]>();
  for (const a of apps) {
    appById.set(a.id, a);
    const id = `app:${a.id}`;
    nodes.push({
      id,
      kind: "app",
      label: a.name,
      data: { slug: a.slug, visibility: a.visibility, hasUi: Boolean(a.hasUi) },
      updatedAt: toIso(a.updatedAt),
      weight: a.visibility === "family" ? 0.9 : 0.7,
    });
    edges.push({ from: userNodeId, to: id, kind: "OWNS", weight: 1 });
  }

  // Scripts (+ routines derived from the schedule)
  const scriptById = new Map<string, (typeof scripts)[number]>();
  for (const c of scripts) {
    scriptById.set(c.id, c);
    const id = `script:${c.id}`;
    nodes.push({
      id,
      kind: "script",
      label: c.name,
      data: { triggerKind: c.triggerKind, schedule: c.schedule, enabled: Boolean(c.enabled) },
      updatedAt: toIso(c.updatedAt),
      weight: c.enabled ? 0.8 : 0.3,
    });
    edges.push({ from: userNodeId, to: id, kind: "OWNS", weight: 1 });
    const routine = describeSchedule(c.schedule);
    if (routine) {
      const sigId = `signal:routine:${c.id}`;
      nodes.push({
        id: sigId,
        kind: "signal",
        label: formatRoutine(routine),
        labelKey: `routine.${routine.key}`,
        labelParams: routineParams(routine),
        data: { signalKind: "routine", schedule: c.schedule },
        updatedAt: toIso(c.nextRunAt ?? c.updatedAt),
        weight: c.enabled ? 0.7 : 0.3,
      });
      edges.push({ from: id, to: sigId, kind: "ROUTINE", weight: c.enabled ? 1 : 0.3 });
    }
  }

  // Storage (app / global / script)
  for (const s of appStorages) {
    const app = appById.get(s.appId);
    if (!app) continue;
    const id = `storage:app:${app.id}:${s.key}`;
    nodes.push({
      id,
      kind: "storage",
      label: s.key,
      data: { scope: "app", appSlug: app.slug, kind: s.kind },
      updatedAt: toIso(s.updatedAt),
    });
    edges.push({ from: `app:${app.id}`, to: id, kind: "STORES", weight: 1 });
  }
  for (const s of globalStorages) {
    const id = `storage:global:${userId}:${s.key}`;
    nodes.push({
      id,
      kind: "storage",
      label: s.key,
      data: { scope: "global", kind: s.kind, visibility: s.visibility },
      updatedAt: toIso(s.updatedAt),
    });
    edges.push({ from: userNodeId, to: id, kind: "STORES", weight: 1 });
  }
  for (const s of scriptStorages) {
    const script = scriptById.get(s.scriptId);
    if (!script) continue;
    const id = `storage:script:${script.id}:${s.key}`;
    nodes.push({
      id,
      kind: "storage",
      label: s.key,
      data: { scope: "script", kind: s.kind },
      updatedAt: toIso(s.updatedAt),
    });
    edges.push({ from: `script:${script.id}`, to: id, kind: "STORES", weight: 1 });
  }

  // Memory + keyword links to apps/storage (interests first)
  const appTargets: AppMatchTarget[] = apps.map((a) => ({
    id: `app:${a.id}`,
    name: a.name,
    slug: a.slug,
    tags: parseTags(a.tags),
  }));
  const storageTargets: StorageMatchTarget[] = [
    ...appStorages
      .filter((s) => appById.has(s.appId))
      .map((s) => ({
        id: `storage:app:${s.appId}:${s.key}`,
        text: `${appById.get(s.appId)?.name ?? ""} ${s.key}`,
      })),
    ...globalStorages.map((s) => ({
      id: `storage:global:${userId}:${s.key}`,
      text: s.key,
    })),
    ...scriptStorages.map((s) => ({
      id: `storage:script:${s.scriptId}:${s.key}`,
      text: s.key,
    })),
  ];

  const memoryToApp = new Map<string, { id: string; score: number }>();
  for (const m of memories) {
    const id = `memory:${m.id}`;
    nodes.push({
      id,
      kind: "memory",
      label: m.content,
      data: { kind: m.kind, source: m.source, pinned: Boolean(m.pinned) },
      updatedAt: toIso(m.updatedAt),
      weight: m.pinned ? 1 : 0.6,
    });
    edges.push({ from: userNodeId, to: id, kind: "OWNS", weight: m.pinned ? 1 : 0.6 });

    const appMatch = matchMemoryToApps(m.content, appTargets);
    if (appMatch) {
      memoryToApp.set(id, appMatch);
      edges.push({
        from: id,
        to: appMatch.id,
        kind: "RELATES_TO",
        weight: appMatch.score,
        meta: { reason: "keywords" },
      });
    }
    const storageMatch = matchMemoryToStorages(m.content, storageTargets);
    if (storageMatch) {
      edges.push({
        from: id,
        to: storageMatch.id,
        kind: "RELATES_TO",
        weight: storageMatch.score,
        meta: { reason: "keywords" },
      });
    }
  }

  // Interest signals: >= 2 memories linked to the same app
  const interestCounts = new Map<string, number>();
  for (const app of memoryToApp.values()) {
    interestCounts.set(app.id, (interestCounts.get(app.id) ?? 0) + 1);
  }
  for (const [appNodeId, count] of interestCounts) {
    if (count < 2) continue;
    const app = appById.get(appNodeId.replace(/^app:/, ""));
    if (!app) continue;
    const sigId = `signal:interest:${app.id}`;
    nodes.push({
      id: sigId,
      kind: "signal",
      label: `Interest: ${app.name} (${count} memories)`,
      labelKey: "interest",
      labelParams: { name: app.name, count },
      data: { signalKind: "interest", count },
      updatedAt: toIso(app.updatedAt),
      weight: 0.6 + count * 0.1,
    });
    edges.push({
      from: sigId,
      to: `app:${app.id}`,
      kind: "INTEREST",
      weight: 0.6 + count * 0.1,
      meta: { count },
    });
  }

  // Scoped threads (app/script) = recent activity
  for (const t of threads) {
    if (t.contextKind === "app" && t.contextId && appById.has(t.contextId)) {
      const id = `thread:${t.id}`;
      nodes.push({ id, kind: "thread", label: t.title, updatedAt: toIso(t.updatedAt), weight: 0.4 });
      edges.push({ from: id, to: `app:${t.contextId}`, kind: "ACTIVITY", weight: 0.5 });
    } else if (t.contextKind === "script" && t.contextId && scriptById.has(t.contextId)) {
      const id = `thread:${t.id}`;
      nodes.push({ id, kind: "thread", label: t.title, updatedAt: toIso(t.updatedAt), weight: 0.4 });
      edges.push({ from: id, to: `script:${t.contextId}`, kind: "ACTIVITY", weight: 0.5 });
    }
  }

  // Health signals: failing scripts / connections in error
  for (const c of scripts) {
    let run: { status: string; startedAt: Date } | undefined;
    try {
      run = await db
        .select({
          status: tables.scriptRuns.status,
          startedAt: tables.scriptRuns.startedAt,
        })
        .from(tables.scriptRuns)
        .where(eq(tables.scriptRuns.scriptId, c.id))
        .orderBy(desc(tables.scriptRuns.startedAt))
        .limit(1)
        .get();
    } catch {
      run = undefined;
    }
    if (run && run.status !== "success" && run.status !== "running") {
      const sigId = `signal:health:script:${c.id}`;
      nodes.push({
        id: sigId,
        kind: "signal",
        label: `Failing script: ${c.name} (${run.status})`,
        labelKey: "healthScript",
        labelParams: { name: c.name, status: run.status },
        data: { signalKind: "health", target: "script", status: run.status },
        updatedAt: toIso(run.startedAt),
        weight: 1,
      });
      edges.push({ from: sigId, to: `script:${c.id}`, kind: "HEALTH", weight: 1 });
    }
  }
  for (const c of conns) {
    if (c.status !== "active") {
      const sigId = `signal:health:conn:${c.id}`;
      nodes.push({
        id: sigId,
        kind: "signal",
        label: `Connection needing repair: ${c.label} (${c.status})`,
        labelKey: "healthConnection",
        labelParams: { name: c.label, status: c.status },
        data: { signalKind: "health", target: "connection", status: c.status },
        updatedAt: toIso(c.updatedAt),
        weight: 1,
      });
      edges.push({ from: sigId, to: `conn:${c.id}`, kind: "HEALTH", weight: 1 });
    }
  }

  return {
    userId,
    generatedAt: generatedAt.toISOString(),
    nodes,
    edges,
  };
}