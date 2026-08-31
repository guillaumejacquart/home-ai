"use client";
/* eslint-disable react/no-unescaped-entities */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";

import { AppFrame } from "@/components/AppFrame";
import { StorageExplorer } from "@/components/StorageExplorer";
import { TagEditor } from "@/components/TagEditor";
import { DATE_TIME_FORMAT } from "@/lib/format";
import { useAssistant } from "@/components/agent/AgentContext";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  TabPanel,
  Tabs,
  Textarea,
  useToast,
} from "@/components/ui";
import type { TabItem } from "@/components/ui";
import {
  Database,
  Monitor,
  Package,
  Settings,
  ExternalLink,
  Bot,
  RefreshCw,
} from "lucide-react";

type Version = {
  id: string;
  version: number;
  model: string | null;
  prompt: string | null;
  createdAt: string;
};

type AppDetail = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  visibility: "private" | "family";
  hasUi: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  currentVersionId: string | null;
  manifest: string | null;
  versions: Version[];
};

type TabId = "apercu" | "versions" | "params" | "storage";

const TAB_IDS = ["apercu", "versions", "params", "storage"] as const;

function isTabId(value: string | null): value is TabId {
  return TAB_IDS.includes(value as TabId);
}

function AppUsageCard({ appId }: { appId: string }) {
  const t = useTranslations("settings");
  const [data, setData] = useState<{ totals: { month: { tokens: number; costMicros: number; calls: number }; all: { tokens: number; costMicros: number; calls: number } } } | null>(null);
  useEffect(() => {
    fetch(`/api/usage/summary?appId=${appId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setData(d);
      })
      .catch(() => {});
  }, [appId]);
  if (!data) return null;
  const m = data.totals.month;
  const a = data.totals.all;
  if (m.calls === 0 && a.calls === 0) return null;
  const fmtCost = (v: number | null) => {
    if (v == null || v === 0) return "—";
    const d = v / 1_000_000;
    return d < 0.01 ? `$${d.toFixed(4)}` : `$${d.toFixed(2)}`;
  };
  return (
    <Card>
      <h3 className="font-semibold text-brand-dark">{t("usageAppTitle")}</h3>
      <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-muted">{t("usageMonth")}</p>
          <p className="font-mono text-sm">{m.tokens.toLocaleString("fr-FR")} tokens · {fmtCost(m.costMicros)} · {m.calls} {t("usageCalls")}</p>
        </div>
        <div>
          <p className="text-xs text-muted">{t("usageAll")}</p>
          <p className="font-mono text-sm">{a.tokens.toLocaleString("fr-FR")} tokens · {fmtCost(a.costMicros)} · {a.calls} {t("usageCalls")}</p>
        </div>
      </div>
      <Link href="/settings/usage" className="mt-2 inline-block text-xs font-semibold text-brand hover:underline">
        {t("usageRecentTitle")} →
      </Link>
    </Card>
  );
}

export function AppEditor({ appId }: { appId: string }) {
  const t = useTranslations("appEditor");
  const tApps = useTranslations("apps");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const { openAssistant } = useAssistant();

  const [app, setApp] = useState<AppDetail | null>(null);
  const [doc, setDoc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const tabParam = searchParams.get("tab");
  const tab: TabId = isTabId(tabParam) ? tabParam : "apercu";

  const setTab = useCallback(
    (next: TabId) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "apercu") params.delete("tab");
      else params.set("tab", next);
      const query = params.toString();
      router.push(`/apps/${appId}${query ? `?${query}` : ""}`, { scroll: false });
    },
    [appId, router, searchParams],
  );

  const tabs: readonly TabItem<TabId>[] = [
    { id: "apercu", label: t("tabPreview"), icon: Monitor },
    { id: "versions", label: t("tabVersions"), icon: Package },
    { id: "storage", label: t("tabStorage"), icon: Database },
    { id: "params", label: t("tabSettings"), icon: Settings },
  ];

  const load = useCallback(async () => {
    const res = await fetch(`/api/apps/${appId}`);
    if (res.ok) setApp(await res.json());
  }, [appId]);

  const loadDoc = useCallback(async () => {
    const res = await fetch(`/api/apps/${appId}/html`);
    if (res.ok) {
      const data = await res.json();
      setDoc(data.document);
    }
  }, [appId]);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(`/api/apps/${appId}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/apps/${appId}/html`).then((r) => (r.ok ? r.json() : null)),
    ]).then(([appData, htmlData]) => {
      if (!active) return;
      if (appData) setApp(appData);
      setDoc(htmlData?.document ?? null);
    });
    return () => {
      active = false;
    };
  }, [appId]);

  // Ouverture auto de l'assistant si ?prompt= est présent (création)
  useEffect(() => {
    const q = searchParams.get("prompt");
    if (!q || !app) return;
    // Nettoie l'URL puis ouvre l'assistant scopé
    router.replace(`/apps/${appId}`, { scroll: false });
    const t = setTimeout(() => {
      openAssistant({ appId }, q);
    }, 300);
    return () => clearTimeout(t);
  }, [searchParams, app, appId, router, openAssistant]);

  async function rollback(versionId: string) {
    const res = await fetch(`/api/apps/${appId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId }),
    });
    if (res.ok) {
      await load();
      await loadDoc();
      toast(t("versionRestored"));
    } else {
      toast(t("versionRestoreError"), "danger");
    }
  }

  async function saveSettings() {
    if (!app || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/apps/${appId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: app.name,
          description: app.description ?? "",
          visibility: app.visibility,
          tags: app.tags,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? t("saveError"));
      toast(t("settingsSaved"));
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : t("saveError");
      setError(message);
      toast(message, "danger");
    } finally {
      setSaving(false);
    }
  }

  async function removeApp() {
    const res = await fetch(`/api/apps/${appId}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/apps");
      return;
    }
    const data = await res.json().catch(() => null);
    setError(data?.error ?? t("deleteError"));
    setConfirmDelete(false);
  }

  if (!app) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-[65vh]" />
      </div>
    );
  }

  const currentVersion =
    app.versions.find((v) => v.id === app.currentVersionId) ?? app.versions[0];

  return (
    <div className="space-y-4">
      <Link href="/apps" className="inline-block text-sm text-muted hover:text-brand-dark">
        {tApps("backToList")}
      </Link>
      <PageHeader
        title={app.name}
        badge={
          <Badge variant={app.visibility === "family" ? "default" : "neutral"}>
            {app.visibility === "family" ? t("visibilityFamily") : t("visibilityPrivate")}
          </Badge>
        }
        actions={
          app.hasUi ? (
            <Link
              href={`/a/${app.slug}`}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:text-brand-dark"
            >
              <ExternalLink className="size-4" />
              {t("openApp", { slug: app.slug })}
            </Link>
          ) : undefined
        }
      />

      {error && <Alert>{error}</Alert>}

      <Tabs tabs={tabs} value={tab} onChange={setTab} label={t("tabsLabel")} />

      {/* Aperçu : preview live + bouton assistant */}
      {tab === "apercu" && (
        <TabPanel id="apercu" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => openAssistant({ appId })}>
              <Bot className="size-4" />
              Modifier avec l'assistant
            </Button>
            <Button variant="secondary" onClick={() => { void load(); void loadDoc(); }}>
              <RefreshCw className="size-4" />
              Actualiser l'aperçu
            </Button>
            <span className="text-xs text-muted">Le chat a déménagé dans l'assistant global (⌘J) — contexte strict sur cette app.</span>
          </div>

          <Card className="overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-line px-4 py-2">
              <span className="text-sm font-semibold text-brand-dark">{t("previewTitle")}</span>
              {doc && currentVersion ? (
                <span className="text-xs text-muted">{t("previewVersion", { version: currentVersion.version })}</span>
              ) : (
                <span className="text-xs text-muted">{t("previewNoRender")}</span>
              )}
            </div>
            <div className="h-[70vh] bg-white">
              {doc ? (
                <AppFrame appId={app.id} document={doc} />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                  <p className="text-sm text-muted">{t("previewEmpty")}</p>
                  <Button size="sm" onClick={() => openAssistant({ appId }, "Crée le contenu initial de cette app")}>
                    <Bot className="size-4" />
                    Générer avec l'assistant
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </TabPanel>
      )}

      {/* Versions : la plus récente en premier */}
      {tab === "versions" && (
        <TabPanel id="versions" className="max-w-3xl">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-brand-dark">{t("versionsTitle")}</h2>
            <p className="text-sm text-muted">{t("versionsDescription")}</p>
          </div>

          {app.versions.length === 0 && (
            <p className="text-sm text-muted">{t("versionsEmpty")}</p>
          )}

          <ol className="space-y-3">
            {app.versions.map((v) => {
              const isCurrent = v.id === app.currentVersionId;
              return (
                <li
                  key={v.id}
                  className={`relative flex gap-4 rounded-xl border p-4 transition ${
                    isCurrent
                      ? "border-brand bg-brand-light"
                      : "border-line bg-card hover:border-brand/50"
                  }`}
                >
                  <div className="flex flex-col items-center">
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                        isCurrent ? "bg-brand text-white" : "bg-canvas text-muted"
                      }`}
                    >
                      v{v.version}
                    </div>
                    <div className="mt-1 h-full w-px bg-line" />
                  </div>

                  <div className="flex flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {isCurrent && <Badge>{t("currentBadge")}</Badge>}
                      <span className="text-xs font-medium text-muted">
                        {format.dateTime(new Date(v.createdAt), DATE_TIME_FORMAT)}
                      </span>
                      {v.model && (
                        <span className="rounded-full bg-canvas px-2 py-0.5 text-xs text-muted">
                          {v.model}
                        </span>
                      )}
                    </div>
                    {v.prompt && <p className="line-clamp-2 text-sm text-ink">{v.prompt}</p>}
                    {!isCurrent && (
                      <div className="mt-1">
                        <Button size="sm" variant="secondary" onClick={() => rollback(v.id)}>
                          {t("restoreVersion")}
                        </Button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </TabPanel>
      )}

      {/* Stockage */}
      {tab === "storage" && (
        <TabPanel id="storage">
          <StorageExplorer appId={app.id} manifest={app.manifest} showScope="app" />
        </TabPanel>
      )}

      {/* Paramètres */}
      {tab === "params" && (
        <TabPanel id="params" className="max-w-2xl space-y-4">
          <Card>
            <h3 className="mb-3 font-semibold text-brand-dark">{t("settingsTitle")}</h3>

            <div className="mb-4 rounded-lg border border-line bg-canvas p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted">{t("slugLabel")}</span>
                <code className="rounded bg-white px-1.5 py-0.5 text-xs font-semibold">
                  {app.slug}
                </code>
                {app.hasUi && (
                  <Link
                    href={`/a/${app.slug}`}
                    className="font-semibold text-brand hover:underline"
                  >
                    {t("openApp", { slug: app.slug })}
                  </Link>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted">
                <span>{t("createdAt", { date: format.dateTime(new Date(app.createdAt), DATE_TIME_FORMAT) })}</span>
                <span>{t("updatedAt", { date: format.dateTime(new Date(app.updatedAt), DATE_TIME_FORMAT) })}</span>
              </div>
            </div>

            <div className="space-y-3">
              <Field label={tCommon("name")}>
                <Input
                  value={app.name}
                  onChange={(e) => setApp({ ...app, name: e.target.value })}
                />
              </Field>
              <Field label={tCommon("description")}>
                <Textarea
                  value={app.description ?? ""}
                  onChange={(e) => setApp({ ...app, description: e.target.value })}
                  rows={3}
                />
              </Field>
              <Field label={t("visibilityLabel")}>
                <Select
                  value={app.visibility}
                  onChange={(e) =>
                    setApp({ ...app, visibility: e.target.value as "private" | "family" })
                  }
                >
                  <option value="private">{t("visibilityPrivateOption")}</option>
                  <option value="family">{t("visibilityFamilyOption")}</option>
                </Select>
              </Field>

              <div>
                <span className="block text-sm font-medium text-muted">{t("tagsLabel")}</span>
                <div className="mt-1.5">
                  <TagEditor tags={app.tags} onChange={(tags) => setApp({ ...app, tags })} />
                </div>
                <p className="mt-1 text-xs text-muted">{t("tagsHint")}</p>
              </div>

              <div className="flex items-center gap-3">
                <Button variant="secondary" size="sm" onClick={saveSettings} disabled={saving}>
                  {saving ? tCommon("saving") : tCommon("save")}
                </Button>
              </div>
            </div>
          </Card>

          <AppUsageCard appId={app.id} />

          <div className="rounded-xl border border-danger bg-danger-light p-4">
            <h3 className="font-semibold text-danger">{t("dangerZone")}</h3>
            <p className="mt-1 text-sm text-danger">{t("dangerDescription")}</p>
            <div className="mt-3">
              {!confirmDelete ? (
                <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
                  {t("deleteApp")}
                </Button>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-danger">{t("deleteConfirmQuestion")}</span>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                    {tCommon("cancel")}
                  </Button>
                  <Button variant="danger" size="sm" onClick={removeApp}>
                    {t("deleteForever")}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </TabPanel>
      )}
    </div>
  );
}
