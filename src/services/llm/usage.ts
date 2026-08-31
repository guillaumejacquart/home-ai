import { and, desc, eq, gte, sql, sum } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { db, tables } from "@/db/client";
import type { LlmUsageFeature } from "@/db/schema";
import { estimateCostMicros } from "@/lib/pricing";

export interface RecordUsageInput {
  userId: string;
  provider: "opencode-go" | "openrouter";
  model: string;
  feature?: LlmUsageFeature;
  status?: "success" | "error";
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  estimated?: boolean;
  durationMs?: number | null;
  appId?: string | null;
  scriptId?: string | null;
  threadId?: string | null;
  error?: string | null;
}

export async function recordUsage(input: RecordUsageInput): Promise<void> {
  if (!input.userId) return;
  const prompt = input.promptTokens ?? null;
  const completion = input.completionTokens ?? null;
  const total =
    input.totalTokens ??
    (prompt != null || completion != null ? (prompt ?? 0) + (completion ?? 0) : null);
  const costMicros =
    prompt != null || completion != null ? estimateCostMicros(input.model, prompt, completion) : null;
  try {
    await db.insert(tables.llmUsage).values({
      id: randomUUID(),
      userId: input.userId,
      createdAt: new Date(),
      provider: input.provider,
      model: input.model,
      feature: (input.feature as LlmUsageFeature) ?? "unknown",
      status: input.status ?? "success",
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: total,
      estimated: input.estimated ?? false,
      costMicros,
      durationMs: input.durationMs ?? null,
      appId: input.appId ?? null,
      scriptId: input.scriptId ?? null,
      threadId: input.threadId ?? null,
      error: input.error ?? null,
    });
  } catch {
    // never block caller
  }
}

export function estimateTokensFromText(text: string): number {
  // crude: ~4 chars per token
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function periodStart(period: "day" | "week" | "month"): Date {
  const now = new Date();
  if (period === "day") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (period === "week") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); // 0 Sun
    const diff = day === 0 ? 6 : day - 1; // Monday start
    d.setDate(d.getDate() - diff);
    return d;
  }
  // month
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return d;
}

export async function getUsageForPeriod(
  userId: string,
  period: "day" | "week" | "month" | "all",
  opts: { appId?: string; scriptId?: string } = {},
): Promise<{ totalTokens: number; totalCostMicros: number; calls: number }> {
  const start = period === "all" ? null : periodStart(period);
  const conditions: ReturnType<typeof eq>[] = [eq(tables.llmUsage.userId, userId)];
  // status filter: count all? Include errors with 0 tokens but count calls. For totals, sum tokens regardless status (errors have 0)
  if (start) conditions.push(gte(tables.llmUsage.createdAt, start) as never);
  if (opts.appId) conditions.push(eq(tables.llmUsage.appId, opts.appId) as never);
  if (opts.scriptId) conditions.push(eq(tables.llmUsage.scriptId, opts.scriptId) as never);
  const rows = await db
    .select({
      tokens: sum(tables.llmUsage.totalTokens),
      cost: sum(tables.llmUsage.costMicros),
      count: sql<number>`count(*)`,
    })
    .from(tables.llmUsage)
    .where(and(...conditions))
    .get();
  return {
    totalTokens: Number(rows?.tokens ?? 0),
    totalCostMicros: Number(rows?.cost ?? 0),
    calls: Number(rows?.count ?? 0),
  };
}

export async function checkQuota(userId: string): Promise<{
  exceeded: "daily" | "weekly" | "monthly" | null;
  remaining: Record<string, number | null>;
}> {
  const settings = await db
    .select({
      daily: tables.userSettings.aiDailyTokenLimit,
      weekly: tables.userSettings.aiWeeklyTokenLimit,
      monthly: tables.userSettings.aiMonthlyTokenLimit,
    })
    .from(tables.userSettings)
    .where(eq(tables.userSettings.userId, userId))
    .get();
  if (!settings) return { exceeded: null, remaining: {} };
  const remaining: Record<string, number | null> = {};
  if (settings.daily != null) {
    const u = await getUsageForPeriod(userId, "day");
    remaining.daily = settings.daily - u.totalTokens;
    if (u.totalTokens >= settings.daily) return { exceeded: "daily", remaining };
  }
  if (settings.weekly != null) {
    const u = await getUsageForPeriod(userId, "week");
    remaining.weekly = settings.weekly - u.totalTokens;
    if (u.totalTokens >= settings.weekly) return { exceeded: "weekly", remaining };
  }
  if (settings.monthly != null) {
    const u = await getUsageForPeriod(userId, "month");
    remaining.monthly = settings.monthly - u.totalTokens;
    if (u.totalTokens >= settings.monthly) return { exceeded: "monthly", remaining };
  }
  return { exceeded: null, remaining };
}

export interface UsageSummary {
  totals: { day: { tokens: number; costMicros: number; calls: number }; week: { tokens: number; costMicros: number; calls: number }; month: { tokens: number; costMicros: number; calls: number }; all: { tokens: number; costMicros: number; calls: number } };
  byModel: { model: string; tokens: number; costMicros: number; calls: number }[];
  byFeature: { feature: string; tokens: number; costMicros: number; calls: number }[];
  byDay: { date: string; tokens: number; costMicros: number; calls: number }[];
  quotas: { daily: number | null; weekly: number | null; monthly: number | null };
}

export async function getUsageSummary(
  userId: string,
  opts: { appId?: string; scriptId?: string } = {},
): Promise<UsageSummary> {
  const [day, week, month, all] = await Promise.all([
    getUsageForPeriod(userId, "day", opts),
    getUsageForPeriod(userId, "week", opts),
    getUsageForPeriod(userId, "month", opts),
    getUsageForPeriod(userId, "all", opts),
  ]);

  const extraFilters: ReturnType<typeof eq>[] = [];
  if (opts.appId) extraFilters.push(eq(tables.llmUsage.appId, opts.appId) as never);
  if (opts.scriptId) extraFilters.push(eq(tables.llmUsage.scriptId, opts.scriptId) as never);

  const baseWhere = and(eq(tables.llmUsage.userId, userId), ...extraFilters);

  const byModelRows = await db
    .select({
      model: tables.llmUsage.model,
      tokens: sum(tables.llmUsage.totalTokens),
      cost: sum(tables.llmUsage.costMicros),
      count: sql<number>`count(*)`,
    })
    .from(tables.llmUsage)
    .where(baseWhere)
    .groupBy(tables.llmUsage.model)
    .all();

  const byFeatureRows = await db
    .select({
      feature: tables.llmUsage.feature,
      tokens: sum(tables.llmUsage.totalTokens),
      cost: sum(tables.llmUsage.costMicros),
      count: sql<number>`count(*)`,
    })
    .from(tables.llmUsage)
    .where(baseWhere)
    .groupBy(tables.llmUsage.feature)
    .all();

  // last 30 days buckets
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
  thirtyDaysAgo.setHours(0, 0, 0, 0);
  const dayBuckets = await db
    .select({
      day: sql<string>`date(${tables.llmUsage.createdAt}, 'localtime')`,
      tokens: sum(tables.llmUsage.totalTokens),
      cost: sum(tables.llmUsage.costMicros),
      count: sql<number>`count(*)`,
    })
    .from(tables.llmUsage)
    .where(and(baseWhere, gte(tables.llmUsage.createdAt, thirtyDaysAgo)))
    .groupBy(sql`date(${tables.llmUsage.createdAt}, 'localtime')`)
    .all();

  const quotasRow = await db
    .select({
      daily: tables.userSettings.aiDailyTokenLimit,
      weekly: tables.userSettings.aiWeeklyTokenLimit,
      monthly: tables.userSettings.aiMonthlyTokenLimit,
    })
    .from(tables.userSettings)
    .where(eq(tables.userSettings.userId, userId))
    .get();

  return {
    totals: {
      day: { tokens: day.totalTokens, costMicros: day.totalCostMicros, calls: day.calls },
      week: { tokens: week.totalTokens, costMicros: week.totalCostMicros, calls: week.calls },
      month: { tokens: month.totalTokens, costMicros: month.totalCostMicros, calls: month.calls },
      all: { tokens: all.totalTokens, costMicros: all.totalCostMicros, calls: all.calls },
    },
    byModel: byModelRows.map((r) => ({
      model: r.model,
      tokens: Number(r.tokens ?? 0),
      costMicros: Number(r.cost ?? 0),
      calls: Number(r.count ?? 0),
    })),
    byFeature: byFeatureRows.map((r) => ({
      feature: r.feature,
      tokens: Number(r.tokens ?? 0),
      costMicros: Number(r.cost ?? 0),
      calls: Number(r.count ?? 0),
    })),
    byDay: dayBuckets
      .map((r) => ({
        date: r.day,
        tokens: Number(r.tokens ?? 0),
        costMicros: Number(r.cost ?? 0),
        calls: Number(r.count ?? 0),
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    quotas: {
      daily: quotasRow?.daily ?? null,
      weekly: quotasRow?.weekly ?? null,
      monthly: quotasRow?.monthly ?? null,
    },
  };
}

export async function getFamilySummary(period: "day" | "week" | "month" | "all") {
  const start = period === "all" ? null : periodStart(period);
  const whereClause = start ? gte(tables.llmUsage.createdAt, start) : undefined;
  const rows = await db
    .select({
      userId: tables.llmUsage.userId,
      tokens: sum(tables.llmUsage.totalTokens),
      cost: sum(tables.llmUsage.costMicros),
      count: sql<number>`count(*)`,
    })
    .from(tables.llmUsage)
    .where(whereClause as never)
    .groupBy(tables.llmUsage.userId)
    .all();

  // join user names
  const userIds = rows.map((r) => r.userId);
  let users: { id: string; name: string; email: string }[] = [];
  if (userIds.length > 0) {
    const allUsers = await db.select({ id: tables.user.id, name: tables.user.name, email: tables.user.email }).from(tables.user).all();
    users = allUsers.filter((u) => userIds.includes(u.id));
  }

  const perUser = rows.map((r) => {
    const u = users.find((x) => x.id === r.userId);
    return {
      userId: r.userId,
      name: u?.name ?? r.userId,
      email: u?.email ?? "",
      tokens: Number(r.tokens ?? 0),
      costMicros: Number(r.cost ?? 0),
      calls: Number(r.count ?? 0),
    };
  });

  const totals = perUser.reduce(
    (acc, cur) => ({
      tokens: acc.tokens + cur.tokens,
      costMicros: acc.costMicros + cur.costMicros,
      calls: acc.calls + cur.calls,
    }),
    { tokens: 0, costMicros: 0, calls: 0 },
  );

  return { perUser, totals };
}

export async function listRecentUsage(
  userId: string,
  opts: { limit?: number; offset?: number; appId?: string; scriptId?: string; feature?: string } = {},
) {
  const limit = Math.min(opts.limit ?? 20, 100);
  const offset = opts.offset ?? 0;
  const conditions = [eq(tables.llmUsage.userId, userId)] as never[];
  if (opts.appId) conditions.push(eq(tables.llmUsage.appId, opts.appId) as never);
  if (opts.scriptId) conditions.push(eq(tables.llmUsage.scriptId, opts.scriptId) as never);
  if (opts.feature) conditions.push(eq(tables.llmUsage.feature, opts.feature as never) as never);
  const where = and(...conditions);
  const rows = await db
    .select()
    .from(tables.llmUsage)
    .where(where)
    .orderBy(desc(tables.llmUsage.createdAt))
    .limit(limit)
    .offset(offset)
    .all();
  const total = await db
    .select({ count: sql<number>`count(*)` })
    .from(tables.llmUsage)
    .where(where)
    .get();
  return { rows, total: Number(total?.count ?? 0) };
}
