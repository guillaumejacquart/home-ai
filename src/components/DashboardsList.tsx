"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Grid3X3, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge, Button, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { useRelativeTime } from "@/lib/use-relative-time";
import { thumbInitial, thumbStyle } from "@/lib/thumbnail";

type DashboardRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  visibility: "private" | "family";
  layout: { cols: number; widgets: { i: string; appId: string }[] };
  updatedAt: string;
};

export function DashboardsList() {
  const t = useTranslations("dashboards");
  const tCommon = useTranslations("common");
  const relativeTime = useRelativeTime();
  const router = useRouter();
  const [rows, setRows] = useState<DashboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/dashboards")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (active) {
          setRows(data);
          setLoading(false);
        }
      })
      .catch(() => setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/dashboards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? tCommon("unknownError"));
      setBusy(false);
      return;
    }
    setBusy(false);
    router.push(`/dashboards/${data.id}`);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        count={!loading && rows.length > 0 ? rows.length : undefined}
        description={t("listDescription")}
        actions={
          <Button variant={creating ? "secondary" : "primary"} onClick={() => setCreating((v) => !v)}>
            {creating ? (
              tCommon("cancel")
            ) : (
              <>
                <Plus className="size-4" />
                {t("new")}
              </>
            )}
          </Button>
        }
      />

      {creating && (
        <Card>
          <form onSubmit={create} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-muted">{t("nameLabel")}</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("namePlaceholder")}
                  required
                  className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
                />
              </label>
              {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? t("creating") : tCommon("create")}
            </Button>
          </form>
        </Card>
      )}

      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      )}

      {!loading && rows.length === 0 && (
        <EmptyState
          icon={<Grid3X3 className="size-6" />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" /> {t("new")}
            </Button>
          }
        />
      )}

      {!loading && rows.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((d) => (
            <Card key={d.id} interactive className="group flex flex-col overflow-hidden p-0">
              <Link href={`/dashboards/${d.id}`} className="block">
                <div style={thumbStyle(d.slug)} className="relative flex h-24 items-center justify-center">
                  <span className="text-4xl font-bold text-white drop-shadow">{thumbInitial(d.name)}</span>
                  <span className="absolute right-2 top-2 rounded-full bg-black/25 px-2 py-0.5 text-xs text-white backdrop-blur">
                    {t("appCount", { count: d.layout.widgets.length })}
                  </span>
                </div>
              </Link>
              <div className="flex flex-1 flex-col p-4">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <Link href={`/dashboards/${d.id}`} className="truncate font-semibold text-brand group-hover:text-brand-dark">
                    {d.name}
                  </Link>
                  <Badge variant={d.visibility === "family" ? "default" : "neutral"}>
                    {d.visibility === "family" ? t("visibilityFamily") : t("visibilityPrivate")}
                  </Badge>
                </div>
                {d.description && <p className="line-clamp-2 text-sm text-muted">{d.description}</p>}
                <div className="mt-2 text-xs text-muted">{t("updatedAt", { time: relativeTime(d.updatedAt) })}</div>
                <div className="mt-3 flex gap-2">
                  <Link href={`/dashboards/${d.id}`} className="flex-1 rounded-lg border border-line bg-white px-3 py-2 text-center text-sm font-medium hover:bg-brand-light/50">
                    {t("edit")}
                  </Link>
                  <Link href={`/d/${d.slug}`} className="flex-1 rounded-lg bg-brand px-3 py-2 text-center text-sm font-medium text-white hover:bg-brand-dark">
                    {t("view")}
                  </Link>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
