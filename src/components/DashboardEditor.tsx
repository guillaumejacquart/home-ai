"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Grid3X3, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { AppFrame } from "@/components/AppFrame";
import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  PageHeader,
  Select,
  Skeleton,
  TabPanel,
  Tabs,
  Textarea,
  useConfirm,
  useToast,
} from "@/components/ui";

function LazyFrame({ appId, doc, height }: { appId: string; doc: string; height: string }) {
  const t = useTranslations("dashboardEditor");
  const [visible, setVisible] = useState(false);
  return (
    <div
      ref={(el) => {
        if (!el || visible) return;
        const obs = new IntersectionObserver(
          (entries) => {
            if (entries[0]?.isIntersecting) {
              setVisible(true);
              obs.disconnect();
            }
          },
          { rootMargin: "200px" },
        );
        obs.observe(el);
      }}
      className="h-full w-full"
      style={{ height }}
    >
      {visible ? (
        <AppFrame appId={appId} document={doc} height={height} />
      ) : (
        <div className="flex h-full items-center justify-center text-xs text-muted">{t("loadingApp")}</div>
      )}
    </div>
  );
}

type Dashboard = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  visibility: "private" | "family";
  layout: { cols: 12; widgets: Widget[] };
  updatedAt: string;
};

type Widget = { i: string; appId: string; x: number; y: number; w: number; h: number; title?: string };
type AppRow = { id: string; slug: string; name: string; visibility: "private" | "family"; hasUi: boolean };
type WidgetHtml = {
  widgetId: string;
  appId: string;
  slug: string;
  name: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  doc: string | null;
  hasUi: boolean;
};

// Legacy wrapper: stable v1 API via the compat build (avoids the rewritten v2)
import dynamic from "next/dynamic";
const ResponsiveGridLayout = dynamic(
  () =>
    import("react-grid-layout/legacy").then((m) => {
      // WidthProvider supplies the container width, same as classic v1
      const R = m.Responsive as unknown as React.ComponentType<Record<string, unknown>>;
      const W = m.WidthProvider as unknown as (
        c: React.ComponentType<Record<string, unknown>>,
      ) => React.ComponentType<Record<string, unknown>>;
      return W(R);
    }),
  { ssr: false },
);

const ROW_HEIGHT = 70;

function nextPosition(widgets: Widget[]): { x: number; y: number } {
  if (widgets.length === 0) return { x: 0, y: 0 };
  const maxY = Math.max(...widgets.map((w) => w.y + w.h));
  return { x: 0, y: maxY };
}

export function DashboardEditor({ dashboardId }: { dashboardId: string }) {
  const t = useTranslations("dashboardEditor");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [apps, setApps] = useState<AppRow[]>([]);
  const [widgetsHtml, setWidgetsHtml] = useState<WidgetHtml[]>([]);
  const [tab, setTab] = useState<"preview" | "params">("preview");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [localWidgets, setLocalWidgets] = useState<Widget[] | null>(null);

  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editVis, setEditVis] = useState<"private" | "family">("private");
  const [showPicker, setShowPicker] = useState(false);

  const load = useCallback(async () => {
    const [dashRes, appsRes] = await Promise.all([
      fetch(`/api/dashboards/${dashboardId}`),
      fetch("/api/apps"),
    ]);
    if (!dashRes.ok) {
      toast(t("notFound"), "danger");
      router.push("/dashboards");
      return;
    }
    const d = (await dashRes.json()) as Dashboard;
    setDash(d);
    setLocalWidgets(d.layout.widgets);
    setEditName(d.name);
    setEditDesc(d.description ?? "");
    setEditVis(d.visibility);
    const a = appsRes.ok ? ((await appsRes.json()) as AppRow[]) : [];
    setApps(a.filter((app) => app.hasUi));
    setLoading(false);
    const wh = await fetch(`/api/dashboards/${dashboardId}/widgets-html`).then((r) =>
      r.ok ? r.json() : { widgets: [] },
    );
    setWidgetsHtml(wh.widgets ?? []);
  }, [dashboardId, router, toast, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const appsById = useMemo(() => {
    const m = new Map<string, AppRow>();
    for (const a of apps) m.set(a.id, a);
    return m;
  }, [apps]);

  async function persistLayout(nextWidgets: Widget[]) {
    if (!dash) return;
    setSaving(true);
    setSaveError(null);
    const layout = { cols: 12 as const, widgets: nextWidgets };
    const res = await fetch(`/api/dashboards/${dashboardId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layout }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSaveError(data.error ?? t("layoutSaveError"));
      setSaving(false);
      return;
    }
    setDash((prev) => (prev ? { ...prev, layout } : prev));
    setLocalWidgets(nextWidgets);
    const hadAppChange =
      nextWidgets.length !== widgetsHtml.length ||
      nextWidgets.some((w) => !widgetsHtml.some((wh) => wh.widgetId === w.i));
    if (hadAppChange) {
      const wh = await fetch(`/api/dashboards/${dashboardId}/widgets-html`).then((r) =>
        r.ok ? r.json() : { widgets: [] },
      );
      setWidgetsHtml(wh.widgets ?? []);
    }
    setSaving(false);
    toast(t("layoutSaved"), "success");
  }

  async function addApp(appId: string) {
    const widgets = localWidgets ?? dash?.layout.widgets ?? [];
    if (widgets.some((w) => w.appId === appId)) {
      toast(t("appAlreadyAdded"), "danger");
      return;
    }
    const pos = nextPosition(widgets);
    // eslint-disable-next-line react-hooks/purity -- id generated on add, not on render
    const widget: Widget = { i: `w-${Date.now()}`, appId, x: pos.x, y: pos.y, w: 6, h: 4 };
    const next = [...widgets, widget];
    await persistLayout(next);
  }

  async function removeWidget(widgetId: string) {
    const widgets = localWidgets ?? dash?.layout.widgets ?? [];
    const next = widgets.filter((w) => w.i !== widgetId);
    await persistLayout(next);
  }

  async function saveParams(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch(`/api/dashboards/${dashboardId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim(), description: editDesc.trim(), visibility: editVis }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(data.error ?? tCommon("unknownError"), "danger");
      setSaving(false);
      return;
    }
    setDash((prev) =>
      prev ? { ...prev, name: editName.trim(), description: editDesc.trim() || null, visibility: editVis } : prev,
    );
    setSaving(false);
    toast(t("paramsSaved"), "success");
  }

  async function handleDelete() {
    const ok = await confirm({
      title: t("deleteTitle"),
      description: t("deleteDescription"),
      confirmLabel: tCommon("delete"),
      danger: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/dashboards/${dashboardId}`, { method: "DELETE" });
    if (!res.ok) {
      toast(t("deleteFailed"), "danger");
      return;
    }
    router.push("/dashboards");
  }

  const displayWidgets = useMemo(
    () => (dash ? (localWidgets ?? dash.layout.widgets) : []),
    [dash, localWidgets],
  );

  const rglLayouts = useMemo(
    () => ({
      lg: displayWidgets.map((w) => ({ i: w.i, x: w.x, y: w.y, w: w.w, h: w.h, minW: 2, minH: 2, maxW: 12, maxH: 12 })),
    }),
    [displayWidgets],
  );

  const htmlByWidgetId = new Map(widgetsHtml.map((w) => [w.widgetId, w]));

  const displayRef = useRef<Widget[]>(displayWidgets);
  useEffect(() => {
    displayRef.current = displayWidgets;
  }, [displayWidgets]);

  if (loading || !dash) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={dash.name}
        description={dash.description ?? undefined}
        badge={
          <Badge variant={dash.visibility === "family" ? "default" : "neutral"}>
            {dash.visibility === "family" ? t("visibilityFamily") : t("visibilityPrivate")}
          </Badge>
        }
        actions={
          <div className="flex gap-2">
            <Link
              href={`/d/${dash.slug}`}
              className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-brand-light/50"
            >
              <ExternalLink className="mr-1.5 inline size-4" /> {t("view")}
            </Link>
            <Button variant="ghost" size="sm" onClick={handleDelete}>
              <Trash2 className="size-4" /> {tCommon("delete")}
            </Button>
          </div>
        }
      />

      <Tabs
        label={t("tabsLabel")}
        tabs={[
          { id: "preview", label: t("tabPreview") },
          { id: "params", label: t("tabSettings") },
        ]}
        value={tab}
        onChange={(id) => setTab(id as typeof tab)}
      />

      {tab === "params" && (
        <TabPanel id="params">
          <Card className="max-w-2xl space-y-4">
            <form onSubmit={saveParams} className="space-y-4">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-muted">{tCommon("name")}</span>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} required />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-muted">{tCommon("description")}</span>
                <Textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={2} />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-muted">{t("visibilityLabel")}</span>
                <Select value={editVis} onChange={(e) => setEditVis(e.target.value as "private" | "family")}>
                  <option value="private">{t("visibilityPrivate")}</option>
                  <option value="family">{t("visibilityFamily")}</option>
                </Select>
              </label>
              <p className="text-xs text-muted">
                {t("publicLink")}{" "}
                <Link href={`/d/${dash.slug}`} className="text-brand underline">
                  /d/{dash.slug}
                </Link>
              </p>
              <Button type="submit" disabled={saving}>
                {saving ? tCommon("saving") : tCommon("save")}
              </Button>
            </form>
          </Card>
        </TabPanel>
      )}

      {tab === "preview" && (
        <TabPanel id="preview">
          <div className="space-y-3">
            {/* Action bar: same width as the grid, no side column that would skew the preview */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Button onClick={() => setShowPicker(true)}>
                  <Plus className="size-4" /> {t("addApp")}
                </Button>
                <span className="text-sm text-muted">
                  {t("widgetCount", { count: displayWidgets.length })}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted">
                {saving && <span>{tCommon("saving")}</span>}
                <span className="hidden sm:inline">{t("dragHint")}</span>
              </div>
            </div>
            {saveError && <Alert>{saveError}</Alert>}

            <div
              className={`dashboard-grid min-h-[400px] rounded-card border border-line bg-white p-2 ${isDragging ? "is-dragging" : ""}`}
              style={{
                backgroundImage:
                  "linear-gradient(to right, rgba(148,163,184,0.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.08) 1px, transparent 1px)",
                backgroundSize: `calc((100% - 16px) / 12) ${ROW_HEIGHT + 8}px`,
              }}
            >
              {displayWidgets.length === 0 ? (
                <div className="flex h-64 flex-col items-center justify-center gap-2 text-sm text-muted">
                  <Grid3X3 className="size-8 opacity-40" />
                  <p>{t("emptyGrid")}</p>
                  <p className="text-xs">{t("emptyGridHint")}</p>
                </div>
              ) : (
                <ResponsiveGridLayout
                  className="layout"
                  layouts={rglLayouts}
                  breakpoints={{ lg: 1200 }}
                  cols={{ lg: 12 }}
                  rowHeight={ROW_HEIGHT}
                  margin={[8, 8]}
                  containerPadding={[8, 8]}
                  compactType="vertical"
                  isDraggable
                  isResizable
                  draggableHandle=".drag-handle"
                  onDragStart={() => setIsDragging(true)}
                  onDragStop={(layout: unknown) => {
                    setIsDragging(false);
                    const arr = layout as { i: string; x: number; y: number; w: number; h: number }[];
                    const byId = new Map(displayRef.current.map((w) => [w.i, w]));
                    const next = arr
                      .map((l) => {
                        const orig = byId.get(l.i);
                        if (!orig) return null;
                        return { ...orig, x: l.x, y: l.y, w: l.w, h: l.h };
                      })
                      .filter(Boolean) as Widget[];
                    void persistLayout(next);
                  }}
                  onResizeStart={() => setIsDragging(true)}
                  onResizeStop={(layout: unknown) => {
                    setIsDragging(false);
                    const arr = layout as { i: string; x: number; y: number; w: number; h: number }[];
                    const byId = new Map(displayRef.current.map((w) => [w.i, w]));
                    const next = arr
                      .map((l) => {
                        const orig = byId.get(l.i);
                        if (!orig) return null;
                        return { ...orig, x: l.x, y: l.y, w: l.w, h: l.h };
                      })
                      .filter(Boolean) as Widget[];
                    void persistLayout(next);
                  }}
                >
                  {displayWidgets.map((w) => {
                    const info = htmlByWidgetId.get(w.i);
                    const app = appsById.get(w.appId);
                    const title = w.title ?? app?.name ?? info?.title ?? t("defaultWidgetTitle");
                    return (
                      <div
                        key={w.i}
                        className="relative overflow-hidden rounded-lg border border-line bg-card shadow-card"
                      >
                        <div className="flex h-full flex-col">
                          <div className="drag-handle flex cursor-move items-center justify-between gap-2 border-b border-line bg-brand-light/30 px-2 py-1.5">
                            <span className="truncate text-xs font-semibold text-brand-dark">{title}</span>
                            <div className="flex shrink-0 items-center gap-1">
                              {app && (
                                <Link
                                  href={`/a/${app.slug}`}
                                  target="_blank"
                                  className="rounded p-1 hover:bg-white"
                                  title={t("openApp")}
                                >
                                  <ExternalLink className="size-3.5" />
                                </Link>
                              )}
                              <button
                                onClick={() => void removeWidget(w.i)}
                                className="rounded p-1 text-red-600 hover:bg-white"
                                title={t("removeWidget")}
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </div>
                          </div>
                          <div className="min-h-0 flex-1 bg-white">
                            {info?.doc ? (
                              <LazyFrame appId={w.appId} doc={info.doc} height="100%" />
                            ) : (
                              <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted">
                                {info && !info.hasUi ? t("appHasNoUi") : tCommon("loading")}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </ResponsiveGridLayout>
              )}
            </div>

            {/* Picker dialog — an overlay, so it doesn't shrink the grid (preview matches prod) */}
            {showPicker && (
              <div
                className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
                onClick={() => setShowPicker(false)}
              >
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label={t("pickerLabel")}
                  className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-card border border-line bg-card shadow-card-hover"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between border-b border-line px-4 py-3">
                    <h3 className="font-semibold">{t("addApp")}</h3>
                    <button
                      onClick={() => setShowPicker(false)}
                      className="rounded-lg px-2 py-1 text-sm text-muted hover:bg-brand-light"
                    >
                      {tCommon("close")}
                    </button>
                  </div>
                  <div className="overflow-y-auto p-4">
                    {apps.length === 0 ? (
                      <p className="py-8 text-center text-sm text-muted">
                        {t("pickerEmpty")}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {apps.map((app) => {
                          const already = displayWidgets.some((w) => w.appId === app.id);
                          return (
                            <div
                              key={app.id}
                              className="flex items-center justify-between gap-3 rounded-lg border border-line bg-white px-3 py-2.5"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium">{app.name}</div>
                                <div className="truncate text-xs text-muted">/a/{app.slug}</div>
                              </div>
                              <Button
                                size="sm"
                                variant={already ? "ghost" : "secondary"}
                                disabled={already}
                                onClick={async () => {
                                  await addApp(app.id);
                                  if (!already) setShowPicker(false);
                                }}
                              >
                                {already ? t("alreadyAdded") : t("add")}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </TabPanel>
      )}
    </div>
  );
}
