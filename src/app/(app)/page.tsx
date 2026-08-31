import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  LayoutTemplate,
  PlugZap,
  Puzzle,
} from "lucide-react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";

import { Alert, Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { DATE_TIME_FORMAT, formatRelativeTime } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { getDashboard } from "@/services/dashboard";

function StatCard({
  href,
  icon: Icon,
  label,
  value,
  hint,
}: {
  href: string;
  icon: typeof Puzzle;
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <Link href={href}>
      <Card interactive className="group flex items-center gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-brand-light text-brand-dark transition group-hover:bg-gradient-to-br group-hover:from-brand group-hover:to-accent group-hover:text-white">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-2xl font-bold leading-tight text-ink">{value}</p>
          <p className="text-sm font-medium text-brand group-hover:text-brand-dark">
            {label}
          </p>
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
      </Card>
    </Link>
  );
}

export default async function DashboardPage() {
  const t = await getTranslations("home");
  const locale = await getLocale();
  const format = await getFormatter();
  const user = await requireUser();
  const data = await getDashboard(user.id);
  const { counts, failingScripts, brokenConnections, recentApps, upcomingScripts } = data;
  const allClear = failingScripts.length === 0 && brokenConnections.length === 0;
  const isEmpty = counts.apps === 0 && counts.connections === 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title={user.name ? t("welcomeNamed", { name: user.name }) : t("welcome")}
        description={t("description")}
      />

      {isEmpty ? (
        <EmptyState
          icon={<Puzzle className="size-6" />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Link
                href="/connections"
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 font-semibold text-white shadow-sm transition hover:bg-brand-dark"
              >
                <PlugZap className="size-4" />
                {t("connectService")}
              </Link>
              <Link
                href="/apps"
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand px-4 py-2 font-semibold text-brand transition hover:bg-brand-light"
              >
                <Puzzle className="size-4" />
                {t("createApp")}
              </Link>
              <Link
                href="/apps"
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-canvas px-4 py-2 font-semibold text-ink transition hover:bg-line"
              >
                <LayoutTemplate className="size-4" />
                {t("browseTemplates")}
              </Link>
            </div>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard href="/apps" icon={Puzzle} label={t("statApps")} value={counts.apps} />
            <StatCard
              href="/scripts"
              icon={Clock}
              label={t("statScripts")}
              value={counts.scriptsTotal}
              hint={t("scriptsEnabled", { count: counts.scriptsEnabled })}
            />
            <StatCard
              href="/connections"
              icon={PlugZap}
              label={t("statConnections")}
              value={counts.connections}
            />
          </div>

          {/* Ce qui demande une action */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-brand-dark">{t("watchlist")}</h2>

            {allClear && (
              <Alert variant="success">
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 shrink-0" />
                  {t("allClear")}
                </span>
              </Alert>
            )}

            {failingScripts.length > 0 && (
              <Card>
                <h3 className="flex items-center gap-2 font-semibold text-danger">
                  <AlertTriangle className="size-4" />
                  {t("failingScripts", { count: failingScripts.length })}
                </h3>
                <ul className="mt-3 space-y-2">
                  {failingScripts.map((c) => (
                    <li
                      key={c.id}
                      className="rounded-lg border border-danger/40 bg-danger-light/50 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/scripts#${c.id}`}
                          className="font-medium text-ink hover:text-brand-dark hover:underline"
                        >
                          {c.name}
                        </Link>
                        <Badge variant="danger">{c.status}</Badge>
                        <span className="text-xs text-muted">
                          {c.lastRunAt ? formatRelativeTime(c.lastRunAt, locale) : ""}
                        </span>
                      </div>
                      {c.error && (
                        <p className="mt-1 line-clamp-2 font-mono text-xs text-danger">
                          {c.error}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {brokenConnections.length > 0 && (
              <Card>
                <h3 className="flex items-center gap-2 font-semibold text-danger">
                  <AlertTriangle className="size-4" />
                  {t("brokenConnections", { count: brokenConnections.length })}
                </h3>
                <ul className="mt-3 space-y-2">
                  {brokenConnections.map((c) => (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-danger/40 bg-danger-light/50 px-3 py-2"
                    >
                      <span className="font-medium text-ink">{c.label}</span>
                      <Badge variant={c.status === "expired" ? "neutral" : "danger"}>
                        {c.status === "expired" ? t("statusExpired") : t("statusError")}
                      </Badge>
                      {c.lastError && (
                        <span className="min-w-0 flex-1 truncate text-xs text-danger">
                          {c.lastError}
                        </span>
                      )}
                      <Link
                        href="/connections"
                        className="ml-auto text-sm font-semibold text-brand hover:text-brand-dark"
                      >
                        {t("fix")}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Apps récentes */}
            <Card>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-brand-dark">{t("recentApps")}</h2>
                <Link
                  href="/apps"
                  className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:text-brand-dark"
                >
                  {t("allApps")}
                  <ArrowRight className="size-3.5" />
                </Link>
              </div>
              {recentApps.length === 0 ? (
                <p className="mt-3 text-sm text-muted">{t("noApps")}</p>
              ) : (
                <ul className="mt-3 divide-y divide-line">
                  {recentApps.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 py-2.5">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-light text-brand-dark">
                        {a.hasUi ? <Puzzle className="size-4" /> : <Clock className="size-4" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/apps/${a.id}`}
                          className="block truncate font-medium text-ink hover:text-brand-dark hover:underline"
                        >
                          {a.name}
                        </Link>
                        <p className="text-xs text-muted">
                          {t("appUpdatedAt", { time: formatRelativeTime(a.updatedAt, locale) })}
                        </p>
                      </div>
                      {a.hasUi && (
                        <Link
                          href={`/a/${a.slug}`}
                          className="shrink-0 text-sm font-semibold text-brand hover:text-brand-dark"
                        >
                          {t("open")}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* Prochaines exécutions */}
            <Card>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-brand-dark">{t("upcomingRuns")}</h2>
                <Link
                  href="/scripts"
                  className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:text-brand-dark"
                >
                  {t("allScripts")}
                  <ArrowRight className="size-3.5" />
                </Link>
              </div>
              {upcomingScripts.length === 0 ? (
                <p className="mt-3 text-sm text-muted">{t("noUpcomingScripts")}</p>
              ) : (
                <ul className="mt-3 divide-y divide-line">
                  {upcomingScripts.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 py-2.5">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-light text-brand-dark">
                        <CalendarClock className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/scripts#${c.id}`}
                          className="block truncate font-medium text-ink hover:text-brand-dark hover:underline"
                        >
                          {c.name}
                        </Link>
                        <p className="truncate text-xs text-muted">{c.schedule}</p>
                      </div>
                      <span className="shrink-0 text-xs font-medium text-muted">
                        {format.dateTime(new Date(c.nextRunAt), DATE_TIME_FORMAT)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
