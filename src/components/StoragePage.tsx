"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";

import { Button, PageHeader, Select, Skeleton } from "@/components/ui";
import { StorageExplorer } from "@/components/StorageExplorer";

type AppRow = { id: string; name: string; slug: string };
type ScriptRow = { id: string; name: string };

function parseView(searchParams: URLSearchParams): string {
  const raw = searchParams.get("view");
  if (raw) return raw;
  // Legacy ?appId=xxx → view=app:xxx
  const legacy = searchParams.get("appId");
  if (legacy) return `app:${legacy}`;
  return "all";
}

export function StoragePage() {
  const t = useTranslations("storage");
  const tCommon = useTranslations("common");
  const tExplorer = useTranslations("storageExplorer");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [apps, setApps] = useState<AppRow[]>([]);
  const [scripts, setScripts] = useState<ScriptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const view = parseView(searchParams);
  const [creating, setCreating] = useState(false);

  function setView(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("appId");
    if (next === "all") params.delete("view");
    else params.set("view", next);
    const qs = params.toString();
    router.push(`/storage${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/apps").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/scripts").then((r) => (r.ok ? r.json() : [])),
    ]).then(([appsData, scriptsData]: [AppRow[], ScriptRow[]]) => {
      if (active) {
        setApps(appsData);
        setScripts(scriptsData);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  let viewApp: AppRow | undefined;
  let viewScript: ScriptRow | undefined;
  if (view.startsWith("app:")) viewApp = apps.find((a) => a.id === view.slice(4));
  if (view.startsWith("script:")) viewScript = scripts.find((s) => s.id === view.slice(7));

  const appFilter = (
    <div className="flex items-center gap-2 shrink-0">
      <Select value={view} onChange={(e) => setView(e.target.value)} className="w-auto shrink-0" aria-label={t("selectLabel")}>
        <option value="all">{t("optionAll")}</option>
        <option value="global">{t("optionGlobal")}</option>
        <option value="apps">{t("optionAllApps")}</option>
        <option value="scripts">{t("optionAllScripts")}</option>
        {apps.length > 0 && (
          <optgroup label={t("groupApps")}>
            {apps.map((app) => (
              <option key={app.id} value={`app:${app.id}`}>
                {t("optionApp", { name: app.name })}
              </option>
            ))}
          </optgroup>
        )}
        {scripts.length > 0 && (
          <optgroup label={t("groupScripts")}>
            {scripts.map((s) => (
              <option key={s.id} value={`script:${s.id}`}>
                {t("optionScript", { name: s.name })}
              </option>
            ))}
          </optgroup>
        )}
      </Select>
      {viewApp && <span className="whitespace-nowrap text-sm text-muted">{t("appSlug", { slug: viewApp.slug })}</span>}
      {viewScript && <span className="whitespace-nowrap text-sm text-muted">{viewScript.name}</span>}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button variant={creating ? "secondary" : "primary"} onClick={() => setCreating((v) => !v)}>
            {creating ? (
              tCommon("cancel")
            ) : (
              <>
                <Plus className="size-4" />
                {tExplorer("newKey")}
              </>
            )}
          </Button>
        }
      />

      {loading ? (
        <Skeleton className="h-40" />
      ) : view === "all" ? (
        <StorageExplorer
          minimal
          allApps={apps}
          allScripts={scripts}
          hideScopeFilter
          createOpen={creating}
          onCreateOpenChange={setCreating}
          toolbar={appFilter}
        />
      ) : view === "global" ? (
        <StorageExplorer appId={null} minimal createOpen={creating} onCreateOpenChange={setCreating} toolbar={appFilter} hideScopeFilter />
      ) : view === "apps" ? (
        <StorageExplorer
          minimal
          allApps={apps}
          allScripts={scripts}
          hideScopeFilter
          defaultScopeFilter="app"
          createOpen={creating}
          onCreateOpenChange={setCreating}
          toolbar={appFilter}
        />
      ) : view === "scripts" ? (
        <StorageExplorer
          minimal
          allApps={apps}
          allScripts={scripts}
          hideScopeFilter
          defaultScopeFilter="script"
          createOpen={creating}
          onCreateOpenChange={setCreating}
          toolbar={appFilter}
        />
      ) : view.startsWith("app:") ? (
        <StorageExplorer
          appId={view.slice(4)}
          showScope="app"
          minimal
          hideScopeFilter
          createOpen={creating}
          onCreateOpenChange={setCreating}
          toolbar={appFilter}
        />
      ) : view.startsWith("script:") ? (
        <StorageExplorer
          scriptId={view.slice(7)}
          showScope="script"
          minimal
          hideScopeFilter
          createOpen={creating}
          onCreateOpenChange={setCreating}
          toolbar={appFilter}
        />
      ) : (
        <StorageExplorer
          minimal
          allApps={apps}
          allScripts={scripts}
          hideScopeFilter
          createOpen={creating}
          onCreateOpenChange={setCreating}
          toolbar={appFilter}
        />
      )}
      {!loading && apps.length === 0 && scripts.length === 0 && (
        <p className="text-sm text-muted">{t("noApps")}</p>
      )}
    </div>
  );
}
