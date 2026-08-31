"use client";
/* eslint-disable react/no-unescaped-entities */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Clock, ExternalLink, Globe, LayoutTemplate, Puzzle, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAssistant } from "@/components/agent/AgentContext";

import {
  Badge,
  Button,
  buttonStyles,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Skeleton,
  useToast,
} from "@/components/ui";
import { TagEditor } from "@/components/TagEditor";
import { useRelativeTime } from "@/lib/use-relative-time";
import { thumbBarStyle } from "@/lib/thumbnail";
import { AppThumb } from "@/components/AppThumb";

type AppRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  visibility: "private" | "family";
  hasUi: boolean;
  tags: string[];
  updatedAt: string;
  manifestKeys?: string[];
  hasHtml?: boolean;
  lastPrompt?: string | null;
  versionCount?: number;
  sourceTemplate?: string | null;
};

type TypeFilter = "all" | "web" | "script";

export function AppsList() {
  const t = useTranslations("apps");
  const relativeTime = useRelativeTime();
  const router = useRouter();
  const toast = useToast();
  const { openAssistant } = useAssistant();
  const [apps, setApps] = useState<AppRow[]>([]);
  const [loading, setLoading] = useState(true);

  type TemplateMeta = { slug: string; name: string; description: string; tags: string[]; installed?: boolean };
  const tTpl = useTranslations("templates");
  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [installing, setInstalling] = useState<string | null>(null);

  // Recherche + filtres du catalogue.
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [visFilter, setVisFilter] = useState<"all" | "private" | "family">("all");
  const [tagFilter, setTagFilter] = useState<string>("all");

  useEffect(() => {
    let active = true;
    fetch("/api/apps")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (active) {
          setApps(data);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    fetch("/api/templates")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setTemplates(Array.isArray(data) ? data : []))
      .catch(() => setTemplates([]));
  }, []);

  async function installTemplate(slug: string) {
    setInstalling(slug);
    try {
      const res = await fetch(`/api/templates/${slug}/install`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? tTpl("installError"));
      toast(tTpl("installed"), "success");
      router.push(`/apps/${data.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : tTpl("installError"), "danger");
    } finally {
      setInstalling(null);
    }
  }

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const app of apps) for (const tag of app.tags) set.add(tag);
    return [...set].sort();
  }, [apps]);

  // Templates non encore installées par l'user → vitrine principale.
  const visibleTemplates = useMemo(
    () => templates.filter((t) => !t.installed),
    [templates],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return apps.filter((app) => {
      if (typeFilter === "web" && !app.hasUi) return false;
      if (typeFilter === "script" && app.hasUi) return false;
      if (visFilter !== "all" && app.visibility !== visFilter) return false;
      if (tagFilter !== "all" && !app.tags.includes(tagFilter)) return false;
      if (q) {
        const hay = `${app.name} ${app.description ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [apps, search, typeFilter, visFilter, tagFilter]);

  const activeFilters =
    search !== "" || typeFilter !== "all" || visFilter !== "all" || tagFilter !== "all";

  function resetFilters() {
    setSearch("");
    setTypeFilter("all");
    setVisFilter("all");
    setTagFilter("all");
  }

  async function setAppTags(id: string, tags: string[]) {
    const previous = apps.find((a) => a.id === id)?.tags ?? [];
    setApps((prev) => prev.map((a) => (a.id === id ? { ...a, tags } : a)));
    const res = await fetch(`/api/apps/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags }),
    });
    if (!res.ok) {
      setApps((prev) => prev.map((a) => (a.id === id ? { ...a, tags: previous } : a)));
      toast(t("tagsSaveError"), "danger");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        count={!loading && apps.length > 0 ? apps.length : undefined}
        actions={
          <Button onClick={() => openAssistant(null, "Je veux créer une nouvelle app : ")}>
            <Bot className="size-4" />
            {t("new")} avec l'assistant
          </Button>
        }
      />




      {/* Modèles */}
      {visibleTemplates.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-brand-dark">
            <LayoutTemplate className="size-4" />
            {tTpl("sectionTitle")}
          </h2>
          <p className="text-sm text-muted">{tTpl("sectionDescription")}</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleTemplates.map((tpl) => (
              <Card key={tpl.slug} className="flex flex-col gap-3">
                <div>
                  <p className="font-semibold text-ink">{tpl.name}</p>
                  {tpl.description && <p className="mt-1 text-sm text-muted">{tpl.description}</p>}
                  {tpl.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {tpl.tags.map((tag) => (
                        <Badge key={tag} variant="neutral">
                          #{tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <Button size="sm" onClick={() => installTemplate(tpl.slug)} disabled={installing === tpl.slug} className="mt-auto">
                  {installing === tpl.slug ? tTpl("installing") : tTpl("install")}
                </Button>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Barre de recherche + filtres */}
      {!loading && apps.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchLabel")}
              className="pl-9"
            />
          </div>
          <Select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            className="w-auto"
            aria-label={t("filterByType")}
          >
            <option value="all">{t("allTypes")}</option>
            <option value="web">{t("typeWeb")}</option>
            <option value="script">{t("typeScript")}</option>
          </Select>
          <Select
            value={visFilter}
            onChange={(e) => setVisFilter(e.target.value as "all" | "private" | "family")}
            className="w-auto"
            aria-label={t("filterByVisibility")}
          >
            <option value="all">{t("allVisibilities")}</option>
            <option value="family">{t("visibilityFamily")}</option>
            <option value="private">{t("visibilityPrivate")}</option>
          </Select>
          <Select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="w-auto"
            aria-label={t("filterByTag")}
          >
            <option value="all">{t("allTags")}</option>
            {allTags.map((tag) => (
              <option key={tag} value={tag}>
                #{tag}
              </option>
            ))}
          </Select>
          {activeFilters && (
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              {t("resetFilters")}
            </Button>
          )}
        </div>
      )}

      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      )}

      {!loading && apps.length === 0 && (
        <EmptyState
          icon={<Puzzle className="size-6" />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={<Button onClick={() => openAssistant(null, "Je veux créer une nouvelle app : ")}>{t("emptyAction")}</Button>}
        />
      )}

      {!loading && apps.length > 0 && filtered.length === 0 && (
        <EmptyState
          icon={<Search className="size-6" />}
          title={t("noResultsTitle")}
          description={t("noResultsDescription")}
          action={
            <Button variant="secondary" onClick={resetFilters}>
              {t("resetFiltersLong")}
            </Button>
          }
        />
      )}

      {!loading && filtered.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((app) => (
            <Card key={app.id} interactive className="group flex flex-col overflow-hidden p-0">
              <div style={thumbBarStyle(app.slug)} className="h-1.5 w-full shrink-0" />
              {app.hasUi && app.hasHtml ? (
                <Link href={`/apps/${app.id}`} className="block">
                  <AppThumb appId={app.id} slug={app.slug} name={app.name} />
                </Link>
              ) : null}
              <div className="flex flex-1 flex-col p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <Link href={`/apps/${app.id}`} className="truncate font-semibold text-brand group-hover:text-brand-dark">
                    {app.name}
                  </Link>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge variant={app.hasUi ? "success" : "neutral"} className="gap-1">
                      {app.hasUi ? <Globe className="size-3" /> : <Clock className="size-3" />}
                      {app.hasUi ? t("badgeWeb") : t("badgeScript")}
                    </Badge>
                    <Badge variant={app.visibility === "family" ? "default" : "neutral"}>
                      {app.visibility === "family" ? t("visibilityFamily") : t("visibilityPrivate")}
                    </Badge>
                  </div>
                </div>
                {app.description ? (
                  <p className="line-clamp-3 text-sm text-muted">{app.description}</p>
                ) : (
                  <p className="text-sm italic text-muted">{app.hasHtml ? "Aucune description" : "Brouillon — génère le contenu avec l'assistant"}</p>
                )}
                {(app.manifestKeys?.length ?? 0) > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {app.manifestKeys!.slice(0, 4).map((k) => (
                      <span key={k} className="rounded bg-canvas px-1.5 py-0.5 text-xs text-muted">
                        {k}
                      </span>
                    ))}
                    {(app.manifestKeys!.length ?? 0) > 4 && (
                      <span className="text-xs text-muted">+{app.manifestKeys!.length - 4}</span>
                    )}
                  </div>
                )}
                {app.lastPrompt && (
                  <p className="mt-2 line-clamp-2 rounded bg-canvas px-2 py-1 text-xs italic text-muted">“{app.lastPrompt}”</p>
                )}
                <div className="mt-2">
                  <TagEditor tags={app.tags} onChange={(tags) => void setAppTags(app.id, tags)} size="sm" />
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted">
                  <span className="truncate">
                    {app.hasUi ? `/a/${app.slug}` : t("scheduledTask")}
                    {app.versionCount ? ` · v${app.versionCount}` : ""}
                    {!app.hasHtml && app.hasUi ? " · brouillon" : ""}
                  </span>
                  <span className="shrink-0">{t("updatedAt", { time: relativeTime(app.updatedAt) })}</span>
                </div>
                <div className="mt-auto flex gap-2 pt-4">
                  <Link href={`/apps/${app.id}`} className={`${buttonStyles("secondary", "sm")} flex-1`}>
                    Éditer
                  </Link>
                  {app.hasUi && (
                    <Link href={`/a/${app.slug}`} className={`${buttonStyles("secondary", "sm")} flex-1`}>
                      <ExternalLink className="size-4" />
                      {t("openApp")}
                    </Link>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {activeFilters && filtered.length > 0 && (
        <p className="text-xs text-muted">
          {t("resultCount", { count: filtered.length, total: apps.length })}
        </p>
      )}
    </div>
  );
}
