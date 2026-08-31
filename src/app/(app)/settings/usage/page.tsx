"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Alert, Badge, Button, Card, Field, Input, Skeleton, TabPanel, useToast } from "@/components/ui";
import {
  formatMicros,
  formatTokens,
  putSettings,
  useAction,
  useSettings,
  useSyncFrom,
} from "@/components/settings/shared";
import { api } from "@/lib/api-client";
import { useSession } from "@/lib/auth-client";
import { can } from "@/lib/rbac";

interface Bucket {
  tokens: number;
  costMicros: number;
  calls: number;
}

interface UsageSummary {
  totals: { day: Bucket; week: Bucket; month: Bucket; all: Bucket };
  byModel: { model: string; tokens: number; costMicros: number; calls: number }[];
  byFeature: { feature: string; tokens: number; costMicros: number; calls: number }[];
  byDay: { date: string; tokens: number; costMicros: number; calls: number }[];
  quotas: { daily: number | null; weekly: number | null; monthly: number | null };
}

interface RecentRow {
  id: string;
  createdAt: string;
  provider: string;
  model: string;
  feature: string;
  totalTokens: number | null;
  costMicros: number | null;
  estimated: boolean;
  durationMs: number | null;
  appId: string | null;
  scriptId: string | null;
  status: string;
}

interface FamilySummary {
  perUser: {
    userId: string;
    name: string;
    email: string;
    tokens: number;
    costMicros: number;
    calls: number;
  }[];
  totals: Bucket;
}

export default function UsageSettingsPage() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const toast = useToast();
  const { data: sessionData } = useSession();
  const isAdmin = can(sessionData?.user?.role, "platform.settings");
  const { data: settings, reload: reloadSettings } = useSettings();
  const { pending, error, setError, run } = useAction();

  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [recentRows, setRecentRows] = useState<RecentRow[]>([]);
  const [recentTotal, setRecentTotal] = useState(0);
  const [recentLoading, setRecentLoading] = useState(true);
  const [family, setFamily] = useState<FamilySummary | null>(null);

  const [quotaDaily, setQuotaDaily] = useState("");
  const [quotaWeekly, setQuotaWeekly] = useState("");
  const [quotaMonthly, setQuotaMonthly] = useState("");

  useSyncFrom(settings, (s) => {
    setQuotaDaily(s.quotas?.daily ? String(s.quotas.daily) : "");
    setQuotaWeekly(s.quotas?.weekly ? String(s.quotas.weekly) : "");
    setQuotaMonthly(s.quotas?.monthly ? String(s.quotas.monthly) : "");
  });

  const loadUsage = useCallback(async () => {
    setSummaryLoading(true);
    try {
      setSummary(await api.get<UsageSummary>("/api/usage/summary"));
    } catch {
      // affichage vide plutôt qu'une erreur bloquante
    } finally {
      setSummaryLoading(false);
    }
    setRecentLoading(true);
    try {
      const d = await api.get<{ rows: RecentRow[]; total: number }>("/api/usage/recent?limit=20");
      setRecentRows(d.rows);
      setRecentTotal(d.total);
    } catch {
      // idem
    } finally {
      setRecentLoading(false);
    }
    if (isAdmin) {
      try {
        setFamily(await api.get<FamilySummary>("/api/usage/family?period=month"));
      } catch {
        // idem
      }
    }
  }, [isAdmin]);

  useEffect(() => {
    // Chargement initial : `loadUsage` pose ses drapeaux de chargement.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadUsage();
  }, [loadUsage]);

  function parseQuota(v: string): number | null {
    return v.trim() === "" ? null : Number(v);
  }

  function saveQuota() {
    const values = {
      aiDailyTokenLimit: parseQuota(quotaDaily),
      aiWeeklyTokenLimit: parseQuota(quotaWeekly),
      aiMonthlyTokenLimit: parseQuota(quotaMonthly),
    };
    const invalid = Object.values(values).some(
      (n) => n !== null && (!Number.isInteger(n) || n <= 0),
    );
    if (invalid) {
      setError(t("quotaInvalid"));
      return;
    }
    void run(
      "quota",
      async () => {
        await putSettings(values);
        toast(t("quotaSaved"));
        void reloadSettings();
        void loadUsage();
      },
      t("saveError"),
    );
  }

  const periods = [
    { key: "day" as const, label: t("usageToday"), quota: summary?.quotas.daily ?? null },
    { key: "week" as const, label: t("usageWeek"), quota: summary?.quotas.weekly ?? null },
    { key: "month" as const, label: t("usageMonth"), quota: summary?.quotas.monthly ?? null },
    { key: "all" as const, label: t("usageAll"), quota: null },
  ];

  return (
    <TabPanel id="usage" className="space-y-8">
      {error && <Alert>{error}</Alert>}

      {/* Quotas */}
      <Card>
        <h2 className="font-semibold text-brand-dark">{t("usageQuotaTitle")}</h2>
        <p className="mt-1 text-sm text-muted">{t("usageQuotaDescription")}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label={t("quotaDailyLabel")}>
            <Input
              value={quotaDaily}
              onChange={(e) => setQuotaDaily(e.target.value)}
              placeholder={t("quotaPlaceholder")}
              inputMode="numeric"
            />
          </Field>
          <Field label={t("quotaWeeklyLabel")}>
            <Input
              value={quotaWeekly}
              onChange={(e) => setQuotaWeekly(e.target.value)}
              placeholder={t("quotaPlaceholder")}
              inputMode="numeric"
            />
          </Field>
          <Field label={t("quotaMonthlyLabel")}>
            <Input
              value={quotaMonthly}
              onChange={(e) => setQuotaMonthly(e.target.value)}
              placeholder={t("quotaPlaceholder")}
              inputMode="numeric"
            />
          </Field>
        </div>
        <p className="mt-2 text-xs text-muted">{t("quotaHint")}</p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" disabled={pending === "quota"} onClick={saveQuota}>
            {pending === "quota" ? tCommon("saving") : tCommon("save")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void loadUsage()}>
            {tCommon("reload")}
          </Button>
        </div>
      </Card>

      {/* Totaux par période */}
      {summaryLoading ? (
        <Skeleton className="h-32" />
      ) : summary ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {periods.map((p) => {
              const v = summary.totals[p.key];
              const pct = p.quota && v.tokens ? Math.min(100, Math.round((v.tokens / p.quota) * 100)) : null;
              return (
                <Card key={p.key} className="p-4">
                  <p className="text-xs font-medium text-muted">{p.label}</p>
                  <p className="mt-1 text-lg font-semibold">
                    {formatTokens(v.tokens)}{" "}
                    <span className="text-xs font-normal text-muted">tokens</span>
                  </p>
                  <p className="text-xs text-muted">
                    {v.calls} {t("usageCalls")} · {formatMicros(v.costMicros)}
                  </p>
                  {pct !== null && (
                    <>
                      <div className="mt-2 h-1.5 rounded bg-line">
                        <div
                          className={`h-1.5 rounded ${pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-amber-500" : "bg-success"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        {pct}% {t("quotaUsed")}
                      </p>
                    </>
                  )}
                </Card>
              );
            })}
          </div>

          {summary.byDay.length > 0 && (
            <Card>
              <h3 className="font-semibold text-brand-dark">{t("usageByDayTitle")}</h3>
              <div className="mt-3 overflow-x-auto">
                <div className="flex items-end gap-1" style={{ height: 80 }}>
                  {summary.byDay.map((d) => {
                    const max = Math.max(...summary.byDay.map((x) => x.tokens), 1);
                    const h = Math.max(4, Math.round((d.tokens / max) * 72));
                    return (
                      <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
                        <div
                          className="w-full rounded bg-brand-dark"
                          style={{ height: h }}
                          title={`${d.date}: ${formatTokens(d.tokens)}`}
                        />
                        <span className="text-[10px] text-muted">{d.date.slice(5)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <h3 className="font-semibold text-brand-dark">{t("usageByFeatureTitle")}</h3>
              <div className="mt-3 space-y-1">
                {summary.byFeature.length === 0 ? (
                  <p className="text-sm text-muted">{t("usageEmpty")}</p>
                ) : (
                  summary.byFeature
                    .slice()
                    .sort((a, b) => b.tokens - a.tokens)
                    .map((f) => (
                      <div key={f.feature} className="flex justify-between gap-2 text-sm">
                        <span className="font-mono text-xs">{f.feature}</span>
                        <span className="text-muted">
                          {formatTokens(f.tokens)} · {formatMicros(f.costMicros)} · {f.calls}
                        </span>
                      </div>
                    ))
                )}
              </div>
            </Card>
            <Card>
              <h3 className="font-semibold text-brand-dark">{t("usageByModelTitle")}</h3>
              <div className="mt-3 space-y-1">
                {summary.byModel.length === 0 ? (
                  <p className="text-sm text-muted">{t("usageEmpty")}</p>
                ) : (
                  summary.byModel
                    .slice()
                    .sort((a, b) => b.tokens - a.tokens)
                    .map((m) => (
                      <div key={m.model} className="flex justify-between gap-2 text-sm">
                        <span className="truncate font-mono text-xs">{m.model}</span>
                        <span className="shrink-0 text-muted">
                          {formatTokens(m.tokens)} · {formatMicros(m.costMicros)} · {m.calls}
                        </span>
                      </div>
                    ))
                )}
              </div>
            </Card>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted">{t("usageEmpty")}</p>
      )}

      {/* Appels récents */}
      <Card>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-brand-dark">{t("usageRecentTitle")}</h3>
          <Button size="sm" variant="ghost" onClick={() => void loadUsage()}>
            {tCommon("reload")}
          </Button>
        </div>
        {recentLoading ? (
          <Skeleton className="mt-3 h-24" />
        ) : recentRows.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t("usageEmpty")}</p>
        ) : (
          <div className="mt-3 space-y-1">
            <p className="text-xs text-muted">
              {recentTotal} {t("usageTotalCalls")}
            </p>
            {recentRows.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-canvas px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold">{r.feature}</span>
                    <span className="text-muted">{r.model}</span>
                    <Badge variant={r.status === "error" ? "danger" : "neutral"}>{r.status}</Badge>
                    {r.estimated && <Badge variant="neutral">{t("estimated")}</Badge>}
                  </div>
                  <p className="text-muted">
                    {new Date(r.createdAt).toLocaleString()} · {formatTokens(r.totalTokens)} tokens ·{" "}
                    {formatMicros(r.costMicros)} · {r.durationMs ? `${r.durationMs}ms` : "—"}
                    {r.appId && ` · app ${r.appId.slice(0, 6)}`}
                    {r.scriptId && ` · script ${r.scriptId.slice(0, 6)}`}
                  </p>
                </div>
                <span className="font-mono text-muted">{r.provider}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {isAdmin && family && (
        <Card>
          <h3 className="font-semibold text-brand-dark">{t("usageFamilyTitle")}</h3>
          <p className="mt-1 text-sm text-muted">{t("usageFamilyDescription")}</p>
          <div className="mt-3 space-y-1">
            <div className="flex justify-between text-xs font-semibold">
              <span>{t("usageFamilyUser")}</span>
              <span>{t("usageFamilyTokens")}</span>
            </div>
            {family.perUser.map((u) => (
              <div key={u.userId} className="flex justify-between gap-2 text-sm">
                <span className="truncate">
                  {u.name} <span className="text-muted">{u.email}</span>
                </span>
                <span className="shrink-0 font-mono text-xs">
                  {formatTokens(u.tokens)} · {formatMicros(u.costMicros)} · {u.calls}
                </span>
              </div>
            ))}
            <div className="flex justify-between border-t border-line pt-2 text-sm font-semibold">
              <span>Total</span>
              <span className="font-mono text-xs">
                {formatTokens(family.totals.tokens)} · {formatMicros(family.totals.costMicros)} ·{" "}
                {family.totals.calls}
              </span>
            </div>
          </div>
        </Card>
      )}
    </TabPanel>
  );
}
