"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
  Activity,
  Bot,
  ChevronDown,
  Code2,
  Database,
  History,
  Loader2,
  Play,
  Plus,
  Trash2,
} from "lucide-react";

import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  TabPanel,
  Tabs,
  Textarea,
  Toggle,
  useConfirm,
  useToast,
} from "@/components/ui";
import type { TabItem } from "@/components/ui";
import { previewSchedule } from "@/lib/script-format";
import { SCRIPT_PRESETS } from "@/lib/natural-script";
import { type FlowSpan } from "@/components/ScriptFlow";
import { StorageExplorer } from "@/components/StorageExplorer";
import { useAssistant } from "@/components/agent/AgentContext";
import { DATE_TIME_FORMAT } from "@/lib/format";
import { RunRow } from "@/components/scripts/RunRow";
import { SchedulePreview } from "@/components/scripts/SchedulePreview";
import { RUN_VARIANT } from "@/components/scripts/types";
import type {
  ScriptDetail,
  ScriptRow,
  ScriptVersion,
  PanelTab,
  Run,
  TriggerKind,
} from "@/components/scripts/types";

/** Shared style for icon-only action buttons in script lists. */
const ICON_BTN = "px-2";

const RUN_POLL_INTERVAL_MS = 1000;
// Margin beyond the server-side execution timeout (60 s).
const RUN_POLL_TIMEOUT_MS = 90_000;

/** i18n key for a trigger's label. */
function triggerLabelKey(kind: TriggerKind): "triggerSchedule" | "triggerManual" | "triggerWebhook" {
  if (kind === "manual") return "triggerManual";
  if (kind === "webhook") return "triggerWebhook";
  return "triggerSchedule";
}

/** French intent phrase passed to the assistant to steer script creation. */
function triggerIntent(kind: TriggerKind): string {
  if (kind === "manual") return "déclenché manuellement (à la demande)";
  if (kind === "webhook") return "déclenché par webhook (POST public)";
  return "planifié";
}

export function ScriptsManager() {
  const t = useTranslations("scripts");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const toast = useToast();
  const confirm = useConfirm();
  const { openAssistant } = useAssistant();

  const [scripts, setScripts] = useState<ScriptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  // Opens the creation panel (generation itself now lives in the global
  // assistant since the migration: no more streaming state here).
  const [creating, setCreating] = useState(false);
  const [createTrigger, setCreateTrigger] = useState<TriggerKind>("schedule");
  const [createPrompt, setCreatePrompt] = useState("");

  // Editing / "Modify" panel (editor variant).
  const [panelId, setPanelId] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>("runs");
  const [editing, setEditing] = useState<ScriptDetail | null>(null);
  const [saving, setSaving] = useState(false);
  const [versions, setVersions] = useState<Record<string, ScriptVersion[]>>({});
  const [runResult, setRunResult] = useState<
    Record<string, { status: Run["status"]; output: string | null; error: string | null }>
  >({});

  // Run history (inline on /scripts, a tab within the editor).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, Run[]>>({});
  const [runDetails, setRunDetails] = useState<Record<string, FlowSpan[]>>({});
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({});

  const panelTabs: readonly TabItem<PanelTab>[] = [
    { id: "runs", label: t("tabRuns"), icon: Activity },
    { id: "versions", label: t("tabVersions"), icon: History },
    { id: "code", label: t("tabCode"), icon: Code2 },
    { id: "storage", label: t("tabStorage"), icon: Database },
  ];

  const refresh = useCallback(async () => {
    const res = await fetch("/api/scripts");
    if (res.ok) setScripts(await res.json());
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/scripts")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (active) {
          setScripts(data);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function loadVersions(scriptId: string) {
    const res = await fetch(`/api/scripts/${scriptId}/versions`);
    if (res.ok) {
      const data = await res.json();
      setVersions((prev) => ({ ...prev, [scriptId]: data }));
    }
  }

  async function loadRuns(scriptId: string) {
    const res = await fetch(`/api/scripts/${scriptId}/runs`);
    if (res.ok) {
      const data = await res.json();
      setRuns((prev) => ({ ...prev, [scriptId]: data }));
    }
  }

  async function loadRunDetail(scriptId: string, runId: string) {
    if (runDetails[runId] !== undefined || detailLoading[runId]) return;
    setDetailLoading((prev) => ({ ...prev, [runId]: true }));
    try {
      const res = await fetch(`/api/scripts/${scriptId}/runs/${runId}`);
      if (res.ok) {
        const data = await res.json();
        setRunDetails((prev) => ({ ...prev, [runId]: data.spans ?? [] }));
      }
    } finally {
      setDetailLoading((prev) => ({ ...prev, [runId]: false }));
    }
  }

  function toggleRunDetail(scriptId: string, runId: string) {
    if (runDetails[runId] !== undefined) {
      setRunDetails((prev) => {
        const next = { ...prev };
        delete next[runId];
        return next;
      });
      return;
    }
    void loadRunDetail(scriptId, runId);
  }

  /** Chevron: collapses/expands the card, keeping the already-viewed tab. */
  function togglePanel(scriptId: string) {
    if (panelId === scriptId) {
      setPanelId(null);
      setEditing(null);
      return;
    }
    void openPanel(scriptId, panelTab);
  }

  async function openPanel(scriptId: string, tab: PanelTab = "runs") {
    if (panelId === scriptId && panelTab === tab) {
      setPanelId(null);
      setEditing(null);
      return;
    }
    setPanelId(scriptId);
    setPanelTab(tab);
    setEditing(null);
    if (tab === "versions") void loadVersions(scriptId);
    if (tab === "runs") void loadRuns(scriptId);
  }

  async function selectTab(tab: PanelTab) {
    setPanelTab(tab);
    if (!panelId) return;
    if (tab === "versions") void loadVersions(panelId);
    if (tab === "runs") void loadRuns(panelId);
    if (tab === "code") {
      const res = await fetch(`/api/scripts/${panelId}`);
      if (res.ok) {
        setEditing(await res.json());
        setError(null);
      }
    }
  }

  function closeCreate() {
    setCreating(false);
    setError(null);
  }

  /** Polls the run until it leaves the "running" state. */
  async function pollRun(scriptId: string, runId: string): Promise<Run> {
    const deadline = Date.now() + RUN_POLL_TIMEOUT_MS;
    for (;;) {
      const res = await fetch(`/api/scripts/${scriptId}/runs/${runId}`);
      if (!res.ok) throw new Error(t("runError"));
      const { run } = (await res.json()) as { run: Run };
      if (run.status !== "running") return run;
      if (Date.now() > deadline) throw new Error(t("runError"));
      await new Promise((r) => setTimeout(r, RUN_POLL_INTERVAL_MS));
    }
  }

  async function run(scriptId: string) {
    if (runningId) return;
    setRunningId(scriptId);
    setError(null);
    try {
      const res = await fetch(`/api/scripts/${scriptId}/run`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("runError"));
      const finished = await pollRun(scriptId, data.runId);
      setRunResult((prev) => ({
        ...prev,
        [scriptId]: {
          status: finished.status,
          output: finished.output ?? null,
          error: finished.error ?? null,
        },
      }));
      const latest = await fetch(`/api/scripts/${scriptId}/runs`);
      if (latest.ok) {
        const list = (await latest.json()) as Run[];
        setRuns((prev) => ({ ...prev, [scriptId]: list }));
      }
      await refresh();
      toast(
        finished.status === "success"
          ? t("runSuccess")
          : t("runStatus", { status: finished.status }),
        finished.status === "success" ? "success" : "danger",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : t("runError");
      setError(message);
      toast(message, "danger");
    } finally {
      setRunningId(null);
    }
  }

  async function toggle(c: ScriptRow) {
    const res = await fetch(`/api/scripts/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !c.enabled }),
    });
    if (res.ok) {
      await refresh();
      toast(c.enabled ? t("disabledToast", { name: c.name }) : t("enabledToast", { name: c.name }));
    } else {
      toast(t("toggleError"), "danger");
    }
  }

  async function remove(c: ScriptRow) {
    const ok = await confirm({
      title: t("deleteTitle", { name: c.name }),
      description: t("deleteDescription"),
    });
    if (!ok) return;
    const res = await fetch(`/api/scripts/${c.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const message = data?.error ?? t("deleteError");
      setError(message);
      toast(message, "danger");
      return;
    }
    setError(null);
    if (selectedId === c.id) setSelectedId(null);
    if (panelId === c.id) {
      setPanelId(null);
      setEditing(null);
    }
    await refresh();
    toast(t("deleted"));
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const scriptId = editing.id;
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/scripts/${scriptId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editing.name,
        triggerKind: editing.triggerKind,
        schedule: editing.triggerKind === "schedule" ? editing.schedule : "",
        code: editing.code,
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (res.ok) {
      setEditing(null);
      await refresh();
      await loadVersions(scriptId);
      toast(t("saved"));
    } else {
      const message = data.error ?? t("saveError");
      setError(message);
      toast(message, "danger");
    }
  }

  async function copyText(text: string, msg: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(msg, "success");
    } catch {
      toast(t("copyError"), "danger");
    }
  }

  async function restore(scriptId: string, versionId: string) {
    const res = await fetch(`/api/scripts/${scriptId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId }),
    });
    if (res.ok) {
      await refresh();
      await loadVersions(scriptId);
      toast(t("versionRestored"));
    } else {
      toast(t("versionRestoreError"), "danger");
    }
  }

  const createForm = (
    <div className="space-y-3">
      <p className="text-sm text-muted">{t("createHint")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("triggerLabel")}>
          <Select value={createTrigger} onChange={(e) => setCreateTrigger(e.target.value as TriggerKind)}>
            <option value="schedule">{t("triggerSchedule")}</option>
            <option value="manual">{t("triggerManual")}</option>
            <option value="webhook">{t("triggerWebhook")}</option>
          </Select>
        </Field>
        <Field label={t("createPromptLabel")}>
          <Input
            value={createPrompt}
            onChange={(e) => setCreatePrompt(e.target.value)}
            placeholder={t("createPlaceholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                openAssistant(
                  null,
                  `Crée un script ${triggerIntent(createTrigger)} : ${createPrompt.trim() || "décris ton besoin"}`,
                );
              }
            }}
          />
        </Field>
      </div>
      <Button
        onClick={() =>
          openAssistant(
            null,
            `Crée un script ${triggerIntent(createTrigger)} : ${createPrompt.trim() || "décris ton besoin"}`,
          )
        }
      >
        <Bot className="size-4" />
        {t("createWithAssistant")}
      </Button>
      <p className="text-xs text-muted">{t("createShortcut")}</p>
    </div>
  );

  const rows = (
    <div className="space-y-2">
      {scripts.map((c) => (
        <div key={c.id} className="rounded-lg border border-line bg-canvas">
          {/* The chevron remains the accessible control; the row is just a mouse shortcut. */}
          <div
            className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3"
            onClick={() => togglePanel(c.id)}
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{c.name}</span>
                <Badge variant={c.enabled ? "success" : "neutral"}>
                  {c.enabled ? t("statusEnabled") : t("statusDisabled")}
                </Badge>
                <Badge variant={c.visibility === "family" ? "default" : "neutral"}>
                  {c.visibility === "family" ? t("visibilityFamily") : t("visibilityPrivate")}
                </Badge>
                <Badge variant="neutral">{t(triggerLabelKey(c.triggerKind))}</Badge>
              </div>
              <p className="text-xs text-muted">
                {c.triggerKind === "schedule" ? (
                  <code className="rounded bg-white px-1">{c.schedule || "—"}</code>
                ) : c.triggerKind === "webhook" && c.webhookSlug ? (
                  <code className="rounded bg-white px-1">/api/hooks/{c.webhookSlug}</code>
                ) : (
                  <span>{t("triggerNoSchedule")}</span>
                )}
                {c.triggerKind === "schedule" && c.nextRunAt
                  ? t("nextRun", { date: format.dateTime(new Date(c.nextRunAt), DATE_TIME_FORMAT) })
                  : ""}
                {c.lastRunAt
                  ? t("lastRun", { date: format.dateTime(new Date(c.lastRunAt), DATE_TIME_FORMAT) })
                  : ""}
              </p>
            </div>
            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              <Toggle
                checked={c.enabled}
                onChange={() => toggle(c)}
                label={c.enabled ? t("disableAria", { name: c.name }) : t("enableAria", { name: c.name })}
              />
              <Button
                size="sm"
                variant="secondary"
                className={ICON_BTN}
                onClick={() => openAssistant({ scriptId: c.id }, `Modifie le script ${c.name} : `)}
                aria-label={t("editAria", { name: c.name })}
                title={tCommon("edit")}
              >
                <Bot className="size-4" />
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className={ICON_BTN}
                disabled={runningId === c.id}
                onClick={() => run(c.id)}
                aria-label={t("runAria", { name: c.name })}
                title={t("run")}
              >
                {runningId === c.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Play className="size-4" />
                )}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className={ICON_BTN}
                onClick={() => remove(c)}
                aria-label={t("deleteAria", { name: c.name })}
                title={tCommon("delete")}
              >
                <Trash2 className="size-4" />
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className={ICON_BTN}
                onClick={() => togglePanel(c.id)}
                aria-expanded={panelId === c.id}
                aria-label={t("detailsAria", { name: c.name })}
                title={t("details")}
              >
                <ChevronDown
                  className={`size-4 transition-transform ${panelId === c.id ? "rotate-180" : ""}`}
                />
              </Button>
            </div>
          </div>

          {/* Last run result */}
          {runResult[c.id] && (
            <div className="border-t border-line px-4 py-3">
              <div className="flex items-center gap-2">
                <Badge variant={RUN_VARIANT[runResult[c.id].status]}>
                  {runResult[c.id].status}
                </Badge>
                <span className="text-xs text-muted">{t("lastRunResult")}</span>
              </div>
              {runResult[c.id].error && (
                <pre className="mt-2 whitespace-pre-wrap rounded bg-danger-light p-2 text-xs text-danger">
                  {runResult[c.id].error}
                </pre>
              )}
              {runResult[c.id].output && (
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-xs">
                  {runResult[c.id].output}
                </pre>
              )}
            </div>
          )}

          {/* "Modify" panel (chat / versions / runs / code) */}
          {panelId === c.id && (
            <div className="border-t border-line px-4 py-3">
              <div className="mb-4">
                <Tabs
                  tabs={panelTabs}
                  value={panelTab}
                  onChange={(t) => void selectTab(t)}
                  variant="pill"
                  label={t("panelTabsLabel", { name: c.name })}
                />
              </div>

              {panelTab === "versions" && (
                <TabPanel id="versions">
                  <h4 className="mb-2 text-sm font-semibold text-brand-dark">
                    {t("versionsTitle")}{" "}
                    <span className="font-normal text-muted">{t("versionsHint")}</span>
                  </h4>
                  {(versions[c.id]?.length ?? 0) === 0 && (
                    <p className="text-sm text-muted">{t("noVersions")}</p>
                  )}
                  <ol className="space-y-2">
                    {versions[c.id]?.map((v) => (
                      <li key={v.id} className="rounded-lg border border-line bg-white p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-canvas px-2 py-0.5 text-xs font-bold">
                              v{v.version}
                            </span>
                            <span className="text-xs text-muted">
                              {format.dateTime(new Date(v.createdAt), DATE_TIME_FORMAT)}
                            </span>
                            {v.prompt && (
                              <span className="max-w-xs truncate text-xs italic text-muted">
                                {v.prompt}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <code className="rounded bg-canvas px-1.5 py-0.5 text-xs">
                              {v.schedule}
                            </code>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => restore(c.id, v.id)}
                            >
                              {t("restore")}
                            </Button>
                          </div>
                        </div>
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs text-muted">
                            {t("viewCode")}
                          </summary>
                          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-canvas p-2 font-mono text-xs">
                            {v.code}
                          </pre>
                        </details>
                      </li>
                    ))}
                  </ol>
                </TabPanel>
              )}

              {panelTab === "runs" && (
                <TabPanel id="runs">
                  <h4 className="mb-2 text-sm font-semibold text-brand-dark">{t("runsTitle")}</h4>
                  {(runs[c.id]?.length ?? 0) === 0 && (
                    <p className="text-sm text-muted">{t("noRuns")}</p>
                  )}
                  <div className="max-h-80 space-y-2 overflow-y-auto">
                    {runs[c.id]?.map((r) => (
                    <RunRow
                      key={r.id}
                      scriptId={c.id}
                      run={r}
                      runDetails={runDetails}
                      detailLoading={detailLoading}
                      onToggleDetail={toggleRunDetail}
                    />
                  ))}
                  </div>
                </TabPanel>
              )}

              {panelTab === "storage" && (
                <TabPanel id="storage">
                  <StorageExplorer scriptId={panelId} showScope="local" />
                </TabPanel>
              )}

              {panelTab === "code" && editing && (
                <TabPanel id="code">
                  <form onSubmit={saveEdit} className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label={tCommon("name")}>
                        <Input
                          value={editing.name}
                          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                        />
                      </Field>
                      <Field label={t("triggerLabel")}>
                        <Select
                          value={editing.triggerKind}
                          onChange={(e) =>
                            setEditing({
                              ...editing,
                              triggerKind: e.target.value as TriggerKind,
                              schedule: e.target.value === "schedule" ? editing.schedule : "",
                            })
                          }
                        >
                          <option value="schedule">{t("triggerSchedule")}</option>
                          <option value="manual">{t("triggerManual")}</option>
                          <option value="webhook">{t("triggerWebhook")}</option>
                        </Select>
                      </Field>
                    </div>

                    {editing.triggerKind === "schedule" && (
                      <div>
                        <Field label={t("scheduleLabel")}>
                          <Input
                            value={editing.schedule}
                            onChange={(e) =>
                              setEditing({ ...editing, schedule: e.target.value })
                            }
                            placeholder={t("schedulePlaceholder")}
                          />
                        </Field>
                        <SchedulePreview schedule={editing.schedule} />
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {SCRIPT_PRESETS.map((p) => (
                            <Button
                              key={p.schedule}
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="rounded-full px-2.5 py-1 text-xs"
                              onClick={() => setEditing({ ...editing, schedule: p.schedule })}
                            >
                              {t(p.labelKey)}
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}

                    {editing.triggerKind === "webhook" && (
                      <div className="space-y-2 rounded-lg border border-line bg-white p-3">
                        <p className="text-sm font-semibold text-brand-dark">{t("webhookTitle")}</p>
                        <p className="text-xs text-muted">{t("webhookHint")}</p>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 truncate rounded bg-canvas px-2 py-1 text-xs">
                            POST /api/hooks/{editing.webhookSlug ?? "…"}
                          </code>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={!editing.webhookSlug}
                            onClick={() =>
                              void copyText(
                                `/api/hooks/${editing.webhookSlug}`,
                                t("webhookUrlCopied"),
                              )
                            }
                          >
                            {t("webhookCopyUrl")}
                          </Button>
                        </div>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 truncate rounded bg-canvas px-2 py-1 text-xs font-mono">
                            {editing.webhookSecret ?? "—"}
                          </code>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={!editing.webhookSecret}
                            onClick={() =>
                              void copyText(editing.webhookSecret ?? "", t("webhookSecretCopied"))
                            }
                          >
                            {t("webhookCopySecret")}
                          </Button>
                        </div>
                        <p className="text-xs text-muted">{t("webhookPayloadHint")}</p>
                      </div>
                    )}

                    <Field label={t("codeLabel")}>
                      <Textarea
                        value={editing.code}
                        onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                        rows={14}
                        spellCheck={false}
                        className="font-mono text-xs"
                      />
                    </Field>
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        disabled={
                          saving ||
                          (editing.triggerKind === "schedule" && !previewSchedule(editing.schedule).valid)
                        }
                      >
                        {saving ? "…" : tCommon("save")}
                      </Button>
                    </div>
                  </form>
                </TabPanel>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        count={!loading && scripts.length > 0 ? scripts.length : undefined}
        description={t("description")}
        actions={
          <Button
            variant={creating ? "secondary" : "primary"}
            onClick={() => {
              if (creating) {
                closeCreate();
                return;
              }
              setCreating(true);
            }}
          >
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

      {creating && <Card>{createForm}</Card>}

      {error && <Alert>{error}</Alert>}

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      )}

      {!loading && scripts.length === 0 && !creating && (
        <EmptyState
          icon={<History className="size-6" />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={<Button onClick={() => setCreating(true)}>{t("emptyAction")}</Button>}
        />
      )}

      {!loading && scripts.length > 0 && rows}
    </div>
  );
}
