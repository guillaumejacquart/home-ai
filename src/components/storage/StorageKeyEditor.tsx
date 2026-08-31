"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, Copy, Database, RotateCcw } from "lucide-react";

import { TableEditor, type TableDraft } from "@/components/storage/TableEditor";
import { Alert, Badge, Button, Card, Textarea, useToast } from "@/components/ui";
import {
  inferJsonSchema,
  inferKind,
  isTableValue,
  parseCsv,
  toCsv,
  toTable,
} from "@/lib/storage-table";

type Scope = "app" | "global" | "script";

type StorageEntry = {
  scope: Scope;
  key: string;
  value: unknown;
  kind: "kv" | "table";
  schema?: unknown;
  updatedAt?: string;
  visibility?: "private" | "family";
};

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function tableDraftOf(value: unknown): TableDraft {
  const table = toTable(value);
  return { columns: table?.columns ?? [], rows: table?.rows ?? [] };
}

function copyText(text: string): Promise<void> {
  return navigator.clipboard?.writeText(text) ?? Promise.resolve();
}

function downloadCsv(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function parseSchemaText(text: string): { value?: unknown; invalid: boolean } {
  if (text.trim() === "") return { value: undefined, invalid: false };
  try {
    return { value: JSON.parse(text), invalid: false };
  } catch {
    return { value: undefined, invalid: true };
  }
}

function assignRowIds(row: Record<string, unknown>): Record<string, unknown> {
  if (typeof row.id === "string" && row.id) return row;
  return { id: crypto.randomUUID().replace(/-/g, "").slice(0, 14), ...row };
}

function tableColumnsOf(rows: Record<string, unknown>[]): string[] {
  return [...new Set(rows.flatMap((r) => Object.keys(r)))];
}

export function StorageKeyEditor({
  scope,
  storageKey,
  appId,
  scriptId,
  backHref,
  backLabel,
}: {
  scope: Scope;
  storageKey: string;
  appId?: string | null;
  scriptId?: string | null;
  backHref: string;
  backLabel?: string;
}) {
  const t = useTranslations("storageExplorer");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const toast = useToast();

  const [entry, setEntry] = useState<StorageEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);

  // Edition state
  const [editValue, setEditValue] = useState("");
  const [draft, setDraft] = useState<TableDraft | null>(null);
  const draftRef = useRef<TableDraft | null>(null);
  const [gridEpoch, setGridEpoch] = useState(0);
  const [isDirty, setIsDirty] = useState(false);
  const [showSchema, setShowSchema] = useState(false);
  const [schemaValue, setSchemaValue] = useState("");
  const [csvPreview, setCsvPreview] = useState<Record<string, unknown>[] | null>(null);

  const scopeUrl = useCallback(() => {
    if (scope === "app") return `/api/apps/${appId}/storage`;
    if (scope === "script") return `/api/scripts/${scriptId}/storage`;
    return "/api/global-storage";
  }, [scope, appId, scriptId]);

  const scopeLabel = useCallback(
    (s: Scope) => {
      if (s === "app") return t("scopeApp");
      if (s === "script") return t("scopeScript");
      return t("scopeGlobal");
    },
    [t],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(scopeUrl());
      if (!res.ok) throw new Error(t("saveError"));
      const data = (await res.json()) as {
        key: string;
        value: unknown;
        kind?: "kv" | "table";
        schema?: unknown;
        updatedAt?: string;
        visibility?: "private" | "family";
      }[];
      // API returns array for list; find the key
      const found = Array.isArray(data) ? data.find((e) => e.key === storageKey) : null;
      if (!found) {
        // Fallback: try single key endpoint which returns {key, value, ...}
        const singleRes = await fetch(`${scopeUrl()}?key=${encodeURIComponent(storageKey)}`);
        if (singleRes.ok) {
          const single = (await singleRes.json()) as {
            key: string;
            value: unknown;
            kind?: "kv" | "table";
            schema?: unknown;
            updatedAt?: string;
            visibility?: "private" | "family";
          };
          // For app/script single endpoint only returns value; treat missing as not found if value is null
          if (single.value !== null && single.value !== undefined) {
            const kind = single.kind ?? inferKind(single.value);
            const e: StorageEntry = {
              scope,
              key: single.key,
              value: single.value,
              kind,
              schema: single.schema,
              updatedAt: single.updatedAt,
              visibility: single.visibility,
            };
            setEntry(e);
            initEdit(e);
            return;
          }
        }
        setEntry(null);
        setError(t("noResults"));
        return;
      }
      // For global, fetch visibility if missing (global list already has it, but keep parity)
      let visibility = found.visibility;
      if (scope === "global" && !visibility) {
        const gres = await fetch("/api/global-storage");
        if (gres.ok) {
          const gdata = (await gres.json()) as { key: string; visibility?: "private" | "family" }[];
          const visMap = new Map(gdata.map((g) => [g.key, g.visibility ?? "private"]));
          visibility = visMap.get(storageKey) ?? "private";
        }
      }
      const e: StorageEntry = {
        scope,
        key: found.key,
        value: found.value,
        kind: found.kind ?? inferKind(found.value),
        schema: found.schema,
        updatedAt: found.updatedAt,
        visibility: visibility as "private" | "family" | undefined,
      };
      setEntry(e);
      initEdit(e);
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon("unknownError"));
    } finally {
      setLoading(false);
    }
  }, [scope, storageKey, scopeUrl, t, tCommon]);

  function initEdit(e: StorageEntry) {
    setEditValue(prettyJson(e.value));
    if (e.kind === "table" && isTableValue(e.value)) {
      const d = tableDraftOf(e.value);
      draftRef.current = d;
      setDraft(d);
      const s = prettyJson(e.schema ?? null);
      setSchemaValue(s === "null" ? "" : s);
    } else {
      draftRef.current = null;
      setDraft(null);
      setSchemaValue("");
    }
    setIsDirty(false);
    setShowSchema(false);
    setConflict(false);
    setCsvPreview(null);
  }

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  function applyExternalDraft(next: TableDraft) {
    draftRef.current = next;
    setDraft(next);
    setGridEpoch((e) => e + 1);
  }

  function updateDraft(next: TableDraft) {
    draftRef.current = next;
    setIsDirty(true);
    setDraft(next);
  }

  function markDirty() {
    setIsDirty(true);
  }

  async function saveEdit() {
    if (!entry || saving) return;
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { key: entry.key };
      const liveDraft = draftRef.current ?? draft;
      if (entry.kind === "table" && liveDraft) {
        body.value = liveDraft.rows;
        body.kind = "table";
        const schemaParsed = parseSchemaText(schemaValue);
        if (schemaParsed.invalid) throw new SyntaxError(t("invalidJson"));
        if (schemaParsed.value !== undefined) body.schema = schemaParsed.value;
      } else {
        body.value = JSON.parse(editValue);
        body.kind = entry.kind;
      }
      if (entry.updatedAt) body.baseUpdatedAt = entry.updatedAt;
      if (entry.scope === "global") body.visibility = entry.visibility ?? "private";
      const res = await fetch(scopeUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw Object.assign(new Error(data?.error ?? t("saveError")), { code: data?.code });
      toast(t("saved"));
      setIsDirty(false);
      setConflict(false);
      await load();
    } catch (err) {
      if ((err as { code?: string }).code === "storageConflict") {
        setConflict(true);
        setError(tCommon("unknownError"));
      } else if (err instanceof SyntaxError) {
        setError(err.message || t("invalidJson"));
      } else {
        setError(err instanceof Error ? err.message : t("saveError"));
      }
    } finally {
      setSaving(false);
    }
  }

  function applyInferredSchema() {
    if (!draftRef.current) return;
    setSchemaValue(prettyJson(inferJsonSchema(draftRef.current.rows)));
    markDirty();
    toast(t("schemaApplied"));
  }

  async function importCsv() {
    const text = await pickCsvFile();
    if (!text) return;
    try {
      setCsvPreview(parseCsv(text));
    } catch {
      setError(t("invalidCsv"));
      toast(t("invalidCsv"), "danger");
    }
  }

  function pickCsvFile(): Promise<string | null> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".csv,text/csv";
      input.onchange = async () => {
        const file = input.files?.[0];
        resolve(file ? await file.text() : null);
      };
      input.click();
    });
  }

  function applyCsv(mode: "replace" | "append") {
    const live = draftRef.current ?? draft;
    if (!live || !csvPreview) return;
    const incoming = csvPreview.map((r) => ("id" in r ? r : { ...r, id: undefined }));
    const mergedRows =
      mode === "replace"
        ? incoming.map(assignRowIds)
        : [...live.rows, ...incoming.map(assignRowIds)];
    const next: TableDraft = { columns: tableColumnsOf(mergedRows), rows: mergedRows };
    applyExternalDraft(next);
    setIsDirty(true);
    setCsvPreview(null);
  }

  function exportCsv() {
    if (!entry) return;
    const table = toTable(entry.value);
    if (!table) return;
    downloadCsv(`${entry.key}.csv`, toCsv(table.rows));
  }

  if (loading) {
    return <p className="text-sm text-muted">{tCommon("loading")}</p>;
  }

  if (!entry) {
    return (
      <div className="space-y-4">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:text-brand-dark"
        >
          <ArrowLeft className="size-4" />
          {backLabel ?? tCommon("back")}
        </Link>
        <Alert variant="danger">{error ?? t("noResults")}</Alert>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:text-brand-dark"
      >
        <ArrowLeft className="size-4" />
        {backLabel ?? tCommon("back")}
      </Link>

      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <Database className="size-4 text-muted" />
            <code className="text-sm font-semibold">{entry.key}</code>
            <Badge>{entry.kind}</Badge>
            <Badge variant={entry.scope === "global" ? "default" : "neutral"}>{scopeLabel(entry.scope)}</Badge>
            {entry.scope === "global" && entry.visibility === "family" && (
              <Badge variant="success">{t("visibilityFamily")}</Badge>
            )}
            {entry.kind === "table" && Array.isArray(entry.value) && (
              <span className="text-xs text-muted">{t("rowsCount", { count: entry.value.length })}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void copyText(prettyJson(entry.value)).then(() => toast(t("copied")))}
              title={t("copy")}
            >
              <Copy className="size-4" />
            </Button>
            {entry.kind === "table" && draft && draft.rows.length > 0 && (
              <Button size="sm" variant="ghost" onClick={exportCsv} title={t("exportCsv")}>
                {t("exportCsv")}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={!isDirty || saving}
              onClick={() => {
                initEdit(entry);
              }}
              title={t("revert")}
            >
              <RotateCcw className="size-4" />
              {t("revert")}
            </Button>
            <Button size="sm" variant="primary" onClick={() => void saveEdit()} disabled={saving}>
              {saving ? tCommon("saving") : t("save")}
            </Button>
          </div>
        </div>

        {conflict && (
          <div className="border-b border-line px-4 py-2">
            <Alert variant="danger">
              <span className="flex flex-wrap items-center justify-between gap-2">
                {tErrors("storageConflict")}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    setConflict(false);
                    await load();
                  }}
                >
                  {tCommon("reload")}
                </Button>
              </span>
            </Alert>
          </div>
        )}

        {error && !conflict && (
          <div className="border-b border-line px-4 py-2">
            <p className="text-sm text-danger">{error}</p>
          </div>
        )}

        <div className="p-4">
          {entry.kind === "table" && draft ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>{t("tableSize", { rows: draft.rows.length, cols: draft.columns.length })}</span>
                <Button size="sm" variant="ghost" onClick={importCsv}>
                  {t("importCsv")}
                </Button>
              </div>

              {csvPreview && (
                <div className="rounded-lg border border-line bg-canvas p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">{t("csvPreviewTitle", { count: csvPreview.length })}</p>
                    <span className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => applyCsv("replace")}>
                        {t("csvReplace")}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => applyCsv("append")}>
                        {t("csvAppend")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setCsvPreview(null)}>
                        ✕
                      </Button>
                    </span>
                  </div>
                  <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-xs text-muted">
                    {prettyJson(csvPreview.slice(0, 5))}
                  </pre>
                </div>
              )}

              <TableEditor
                key={`grid-${gridEpoch}`}
                draft={draft}
                schema={parseSchemaText(schemaValue).value}
                onChange={updateDraft}
              />

              <div className="rounded-lg border border-line bg-canvas p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-muted">{t("schemaEditLabel")}</p>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="secondary" onClick={applyInferredSchema}>
                      {t("schemaInfer")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t("edit")}
                      onClick={() => setShowSchema((v) => !v)}
                    >
                      {showSchema ? "▴" : "▾"}
                    </Button>
                  </div>
                </div>
                {(showSchema || schemaValue === "") && (
                  <Textarea
                    value={schemaValue}
                    onChange={(e) => {
                      setSchemaValue(e.target.value);
                      markDirty();
                    }}
                    rows={6}
                    className="mt-2 font-mono text-xs"
                  />
                )}
              </div>
            </div>
          ) : (
            <Textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} rows={20} className="font-mono" />
          )}
        </div>
      </Card>
    </div>
  );
}
