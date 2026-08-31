"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Copy,
  Database,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import { TableEditor, type TableDraft } from "@/components/storage/TableEditor";
import { useAssistant } from "@/components/agent/AgentContext";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Select,
  Textarea,
  useConfirm,
  useToast,
} from "@/components/ui";
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
  // En mode agrégé (page /storage "Tous"), on garde l'origine pour le tag
  appId?: string;
  appName?: string;
  appSlug?: string;
  scriptId?: string;
  scriptName?: string;
};

type ScopeFilter = "all" | Scope;

type AllApp = { id: string; name: string; slug: string };
type AllScript = { id: string; name: string };

/** Colonne du constructeur de table (nouvelle clé de type table). */
type BuilderColumn = { name: string; type: "string" | "number" | "boolean" };

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Extrait les clés déclarées dans le commentaire `<!-- storage: ... -->` du HTML (côté client). */
function extractStorageKeysClient(html: string): string[] {
  const m = html.match(/<!--\s*storage:\s*([\s\S]*?)-->/i);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/-+\s*$/, ""))
    .filter(Boolean);
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

function copyText(text: string): Promise<void> {
  return navigator.clipboard?.writeText(text) ?? Promise.resolve();
}

/** Parse côté client un manifeste (ne pas importer le service serveur). */
function parseManifestClient(raw: string | null | undefined): {
  storages?: { key: string; kind: string; description?: string }[];
  tools?: { name: string; description?: string; storage?: { op?: string; key?: string } }[];
} | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      storages: Array.isArray(parsed.storages) ? parsed.storages : undefined,
      tools: Array.isArray(parsed.tools) ? parsed.tools : undefined,
    };
  } catch {
    return null;
  }
}

/** Brouillon d'édition d'une valeur « table » : colonnes dérivées des lignes. */
function tableDraftOf(value: unknown): TableDraft {
  const table = toTable(value);
  return { columns: table?.columns ?? [], rows: table?.rows ?? [] };
}

const BUILDER_TYPES: BuilderColumn["type"][] = ["string", "number", "boolean"];

export function StorageExplorer({
  appId = null,
  scriptId = null,
  allApps,
  allScripts,
  manifest,
  showScope = "all",
  minimal = false,
  toolbar,
  createOpen,
  onCreateOpenChange,
  hideScopeFilter = false,
  defaultScopeFilter,
}: {
  appId?: string | null;
  scriptId?: string | null;
  allApps?: AllApp[];
  allScripts?: AllScript[];
  manifest?: string | null;
  /** Périmètre affiché. "all" = tous les scopes disponibles (app+script+global).
   * "local" = les scopes propres (app+script), sans le global. */
  showScope?: "all" | "app" | "global" | "script" | "local";
  /** Mode épuré (page /storage dédiée) : sans en-tête interne, jeu d'essai,
   * vidages de périmètre, bandeaux orphelines ni carte manifeste. */
  minimal?: boolean;
  /** Filtres supplémentaires rendus dans la barre de recherche (mode minimal). */
  toolbar?: ReactNode;
  /** Création contrôlée : le bouton « Nouvelle clé » est déporté dans l'en-tête de page. */
  createOpen?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
  hideScopeFilter?: boolean;
  defaultScopeFilter?: ScopeFilter;
}) {
  const t = useTranslations("storageExplorer");
  const tCommon = useTranslations("common");
  const toast = useToast();
  const confirm = useConfirm();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { openAssistant } = useAssistant();

  const isAllMode = allApps !== undefined || allScripts !== undefined;

  const [entries, setEntries] = useState<StorageEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [internalScopeFilter, setInternalScopeFilter] = useState<ScopeFilter>(defaultScopeFilter ?? "all");
  const scopeFilter = hideScopeFilter && defaultScopeFilter !== undefined ? defaultScopeFilter : internalScopeFilter;
  const setScopeFilter = setInternalScopeFilter;
  const [selected, setSelected] = useState<StorageEntry | null>(null);

  // Édition kv : JSON brut. Édition table : brouillon grille + schéma éditable.
  const [editValue, setEditValue] = useState("");
  const [draft, setDraft] = useState<TableDraft | null>(null);
  // Miroir synchrone du brouillon : le blur d'une cellule et le clic sur
  // « Enregistrer » arrivent dans le même tick — saveEdit doit lire la valeur
  // à jour, pas celle de l'état React (batché après coup).
  const draftRef = useRef<TableDraft | null>(null);
  // Nonce de remontage de la grille : les cellules étant non contrôlées, un
  // remplacement externe du brouillon (Réinitialiser, import CSV) doit les
  // remonter pour re-seeder leurs defaultValue.
  const [gridEpoch, setGridEpoch] = useState(0);
  const [isDirty, setIsDirty] = useState(false);
  const [showSchema, setShowSchema] = useState(false);
  const [schemaValue, setSchemaValue] = useState("");
  const [conflict, setConflict] = useState(false);
  const [csvPreview, setCsvPreview] = useState<Record<string, unknown>[] | null>(null);

  const [creating, setCreating] = useState(false);
  const isCreating = createOpen ?? creating;

  function toggleCreating() {
    if (onCreateOpenChange) onCreateOpenChange(!isCreating);
    else setCreating((v) => !v);
  }

  function closeCreating() {
    if (onCreateOpenChange) onCreateOpenChange(false);
    else setCreating(false);
  }
  // En mode agrégé le select porte "global" | "app:<id>" | "script:<id>"
  // En mode simple il reste "global" | "app" | "script"
  const createOptions = useMemo(() => {
    if (isAllMode) {
      const opts: { value: string; label: string }[] = [{ value: "global", label: t("scopeGlobal") }];
      (allApps ?? []).forEach((a) => opts.push({ value: `app:${a.id}`, label: `${a.name} · /a/${a.slug}` }));
      (allScripts ?? []).forEach((s) => opts.push({ value: `script:${s.id}`, label: s.name }));
      return opts;
    }
    // mode simple : scopes calculés plus bas
    return [] as { value: string; label: string }[];
  }, [isAllMode, allApps, allScripts, t]);

  const [createScope, setCreateScope] = useState<string>("global");
  const [createKey, setCreateKey] = useState("");
  const [createKind, setCreateKind] = useState<"kv" | "table">("kv");
  const [createVisibility, setCreateVisibility] = useState<"private" | "family">("private");
  const [createValue, setCreateValue] = useState("");
  const [createCols, setCreateCols] = useState<BuilderColumn[]>([]);
  const [saving, setSaving] = useState(false);
  const [manifestOpen, setManifestOpen] = useState(false);
  const [manifestValue, setManifestValue] = useState("");
  // Jeu d'essai (génération LLM).
  const [seeding, setSeeding] = useState(false);
  const [seedOpen, setSeedOpen] = useState(false);
  const [seedKey, setSeedKey] = useState("");
  const [seedKind, setSeedKind] = useState<"kv" | "table">("table");
  const [seedPrompt, setSeedPrompt] = useState("");
  // Garde-fou : clés déclarées dans le HTML de l'app.
  const [declaredKeys, setDeclaredKeys] = useState<string[]>([]);

  const manifestData = parseManifestClient(manifest);

  // Scopes réellement affichables selon les props.
  const scopes = useMemo<Scope[]>(() => {
    if (isAllMode) {
      const out: Scope[] = [];
      out.push("global");
      if ((allApps ?? []).length > 0) out.push("app");
      if ((allScripts ?? []).length > 0) out.push("script");
      // Si aucune app ni script, on garde au moins global pour le filtre
      if (out.length === 0) out.push("global");
      return out;
    }
    const out: Scope[] = [];
    if (appId != null && showScope !== "global" && showScope !== "script") out.push("app");
    if (scriptId != null && showScope !== "app" && showScope !== "global") out.push("script");
    if (showScope === "all" || showScope === "global") out.push("global");
    return out;
  }, [appId, scriptId, showScope, isAllMode, allApps, allScripts]);

  // Le scope par défaut des formulaires suit le premier scope disponible.
  useEffect(() => {
    if (isAllMode) {
      if (createOptions.length > 0 && !createOptions.some((o) => o.value === createScope)) {
        const tt = setTimeout(() => setCreateScope(createOptions[0].value), 0);
        return () => clearTimeout(tt);
      }
      return;
    }
    if (scopes.length > 0 && !scopes.includes(createScope as Scope)) {
      const t = setTimeout(() => setCreateScope(scopes[0]), 0);
      return () => clearTimeout(t);
    }
  }, [scopes, createScope, isAllMode, createOptions]);

  const scopeUrl = useCallback(
    (scope: Scope) => {
      if (scope === "app") return `/api/apps/${appId}/storage`;
      if (scope === "script") return `/api/scripts/${scriptId}/storage`;
      return "/api/global-storage";
    },
    [appId, scriptId],
  );

  function targetUrl(target: string): string {
    if (target === "global") return "/api/global-storage";
    if (target.startsWith("app:")) return `/api/apps/${target.slice(4)}/storage`;
    if (target.startsWith("script:")) return `/api/scripts/${target.slice(7)}/storage`;
    // legacy values in simple mode
    if (target === "app") return `/api/apps/${appId}/storage`;
    if (target === "script") return `/api/scripts/${scriptId}/storage`;
    return "/api/global-storage";
  }

  function entryUrl(entry: StorageEntry): string {
    if (entry.scope === "app") {
      const aid = entry.appId ?? appId;
      if (aid) return `/api/apps/${aid}/storage`;
    }
    if (entry.scope === "script") {
      const sid = entry.scriptId ?? scriptId;
      if (sid) return `/api/scripts/${sid}/storage`;
    }
    return "/api/global-storage";
  }

  const editHref = useCallback(
    (entry: StorageEntry) => {
      const params = new URLSearchParams();
      params.set("scope", entry.scope);
      params.set("key", entry.key);
      const aid = entry.appId ?? appId;
      const sid = entry.scriptId ?? scriptId;
      if (entry.scope === "app" && aid) params.set("appId", aid);
      if (entry.scope === "script" && sid) params.set("scriptId", sid);
      const returnTo = pathname + (searchParams.toString() ? `?${searchParams.toString()}` : "");
      params.set("returnTo", returnTo);
      return `/storage/edit?${params.toString()}`;
    },
    [appId, scriptId, pathname, searchParams],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (isAllMode) {
        // Mode agrégé : global + chaque app + chaque script
        const globalFetch = fetch("/api/global-storage").then(async (res) => {
          if (!res.ok) return [] as StorageEntry[];
          const data = (await res.json()) as {
            key: string;
            value: unknown;
            kind?: "kv" | "table";
            schema?: unknown;
            updatedAt?: string;
            visibility?: "private" | "family";
          }[];
          return data.map((e) => ({
            scope: "global" as const,
            key: e.key,
            value: e.value,
            kind: e.kind ?? inferKind(e.value),
            schema: e.schema,
            updatedAt: e.updatedAt,
            visibility: e.visibility ?? "private",
          }));
        });

        const appFetches = (allApps ?? []).map(async (app) => {
          const res = await fetch(`/api/apps/${app.id}/storage`);
          if (!res.ok) return [] as StorageEntry[];
          const data = (await res.json()) as {
            key: string;
            value: unknown;
            kind?: "kv" | "table";
            schema?: unknown;
            updatedAt?: string;
          }[];
          return data.map((e) => ({
            scope: "app" as const,
            key: e.key,
            value: e.value,
            kind: e.kind ?? inferKind(e.value),
            schema: e.schema,
            updatedAt: e.updatedAt,
            appId: app.id,
            appName: app.name,
            appSlug: app.slug,
          }));
        });

        const scriptFetches = (allScripts ?? []).map(async (s) => {
          const res = await fetch(`/api/scripts/${s.id}/storage`);
          if (!res.ok) return [] as StorageEntry[];
          const data = (await res.json()) as {
            key: string;
            value: unknown;
            kind?: "kv" | "table";
            schema?: unknown;
            updatedAt?: string;
          }[];
          return data.map((e) => ({
            scope: "script" as const,
            key: e.key,
            value: e.value,
            kind: e.kind ?? inferKind(e.value),
            schema: e.schema,
            updatedAt: e.updatedAt,
            scriptId: s.id,
            scriptName: s.name,
          }));
        });

        const all = await Promise.all([globalFetch, ...appFetches, ...scriptFetches]);
        setEntries(all.flat());
        return;
      }

      const results = await Promise.all(
        scopes.map(async (scope) => {
          const res = await fetch(scopeUrl(scope));
          if (!res.ok) return [];
          const data = (await res.json()) as {
            key: string;
            value: unknown;
            kind?: "kv" | "table";
            schema?: unknown;
            updatedAt?: string;
          }[];
          return data.map((e) => ({
            scope,
            key: e.key,
            value: e.value,
            // Le serveur renvoie le kind persisté (sinon inférence locale).
            kind: e.kind ?? inferKind(e.value),
            schema: e.schema,
            updatedAt: e.updatedAt,
          }));
        }),
      );
      const merged: StorageEntry[] = results.flat();
      // Injecte visibility pour le scope global.
      if (scopes.includes("global")) {
        const gres = await fetch("/api/global-storage");
        if (gres.ok) {
          const gdata = (await gres.json()) as {
            key: string;
            visibility?: "private" | "family";
          }[];
          const visMap = new Map(gdata.map((g) => [g.key, g.visibility ?? "private"]));
          merged.forEach((e) => {
            if (e.scope === "global") e.visibility = visMap.get(e.key) ?? "private";
          });
        }
      }
      setEntries(merged);
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon("unknownError"));
    } finally {
      setLoading(false);
    }
  }, [scopes, scopeUrl, tCommon, isAllMode, allApps, allScripts]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  // Clés déclarées par l'app (garde-fou) : on les extrait du HTML servi.
  useEffect(() => {
    if (isAllMode || appId == null) return;
    let active = true;
    fetch(`/api/apps/${appId}/html`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!active) return;
        const html = data?.document;
        setDeclaredKeys(html ? extractStorageKeysClient(html) : []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [appId, isAllMode]);

  const storedKeys = useMemo(() => entries.filter((e) => e.scope === "app").map((e) => e.key), [entries]);
  const missingKeys = useMemo(
    () => declaredKeys.filter((k) => !storedKeys.includes(k)),
    [declaredKeys, storedKeys],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries
      .filter((e) => {
        if (scopeFilter === "all") return scopes.includes(e.scope);
        return e.scope === scopeFilter;
      })
      .filter((e) => (q ? e.key.toLowerCase().includes(q) : true))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [entries, query, scopeFilter, scopes]);

  /* ------------------------------------------------------------------ */
  /* Détail : ouverture, édition, sauvegarde                             */
  /* ------------------------------------------------------------------ */

  /** Ferme le panneau en gardant le garde-fou « modifications non enregistrées ». */
  async function closeDetail(force = false) {
    if (force || !isDirty) return resetDetail();
    const ok = await confirm({
      title: t("unsavedTitle"),
      description: t("unsavedDescription", { key: selected?.key ?? "" }),
      confirmLabel: t("unsavedConfirm"),
    });
    if (ok) resetDetail();
  }

  function resetDetail() {
    setSelected(null);
    setDraft(null);
    draftRef.current = null;
    setIsDirty(false);
    setShowSchema(false);
    setSchemaValue("");
    setConflict(false);
    setCsvPreview(null);
  }

  /** Remplace le brouillon depuis l'extérieur de la grille (reset, import CSV) :
   * ref synchronisée + remontage des cellules non contrôlées. */
  function applyExternalDraft(next: TableDraft) {
    draftRef.current = next;
    setDraft(next);
    setGridEpoch((e) => e + 1);
  }

  /** Ouvre la clé directement en édition (grille pour une table, JSON sinon). */
  function openEdit(entry: StorageEntry) {
    resetDetail();
    setSelected(entry);
    setEditValue(prettyJson(entry.value));
    if (entry.kind === "table" && isTableValue(entry.value)) {
      const d = tableDraftOf(entry.value);
      draftRef.current = d;
      setDraft(d);
      const s = prettyJson(entry.schema ?? null);
      setSchemaValue(s === "null" ? "" : s);
    }
  }

  /** Commit venant de la grille (blur de cellule, op colonne/ligne). */
  function updateDraft(next: TableDraft) {
    draftRef.current = next;
    setIsDirty(true);
    setDraft(next);
  }

  function markDirty() {
    setIsDirty(true);
  }

  /** Enregistre selon le type (kv JSON ou table brouillon), avec anti-conflit. */
  async function saveEdit() {
    if (!selected || saving) return;
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { key: selected.key };
      // Lecture via le ref : le blur de la dernière cellule éditée (même
      // déclenché par ce clic) a déjà committé dedans, sans attendre React.
      const liveDraft = draftRef.current ?? draft;
      if (selected.kind === "table" && liveDraft) {
        body.value = liveDraft.rows;
        body.kind = "table";
        const schemaParsed = parseSchemaText(schemaValue);
        if (schemaParsed.invalid) throw new SyntaxError(t("invalidJson"));
        if (schemaParsed.value !== undefined) body.schema = schemaParsed.value;
      } else {
        body.value = JSON.parse(editValue);
        body.kind = selected.kind;
      }
      if (selected.updatedAt) body.baseUpdatedAt = selected.updatedAt;
      if (selected.scope === "global") body.visibility = selected.visibility ?? "private";
      const url = isAllMode ? entryUrl(selected) : scopeUrl(selected.scope);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw Object.assign(new Error(data?.error ?? t("saveError")), { code: data?.code });
      toast(t("saved"));
      resetDetail();
      await load();
    } catch (err) {
      if ((err as { code?: string }).code === "storageConflict") {
        setConflict(true);
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

  /* ------------------------------------------------------------------ */
  /* Suppression / vidage                                                */
  /* ------------------------------------------------------------------ */

  async function removeEntry(entry: StorageEntry) {
    const ok = await confirm({
      title: t("deleteTitle", { key: entry.key }),
      description: t("deleteDescription"),
    });
    if (!ok) return;
    const url = isAllMode ? entryUrl(entry) : scopeUrl(entry.scope);
    const res = await fetch(`${url}?key=${encodeURIComponent(entry.key)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      toast(t("deleted"));
      setSelected(null);
      await load();
    } else {
      toast(t("deleteError"), "danger");
    }
  }

  async function clearScope(scope: Scope) {
    const ok = await confirm({
      title: t("clearTitle", { scope: scopeLabel(scope) }),
      description: t("clearDescription"),
      confirmLabel: t("clearConfirm"),
    });
    if (!ok) return;
    const res = await fetch(scopeUrl(scope), { method: "DELETE" });
    if (res.ok) {
      toast(t("cleared"));
      setSelected(null);
      await load();
    } else {
      toast(t("clearError"), "danger");
    }
  }

  function scopeLabel(scope: Scope): string {
    if (scope === "app") return t("scopeApp");
    if (scope === "script") return t("scopeScript");
    return t("scopeGlobal");
  }

  /* ------------------------------------------------------------------ */
  /* Création                                                            */
  /* ------------------------------------------------------------------ */

  async function createEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!createKey.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const isGlobalTarget = createScope === "global";
      const body: Record<string, unknown> = { key: createKey.trim(), kind: createKind };
      if (isGlobalTarget) body.visibility = createVisibility;
      if (createKind === "table") {
        if (createCols.some((c) => !c.name.trim())) throw new SyntaxError("builderEmpty");
        body.value = [];
        body.schema = {
          type: "object",
          properties: Object.fromEntries(
            createCols.map((c) => [c.name.trim(), { type: c.type }]),
          ),
        };
      } else {
        body.value = createValue.trim() === "" ? null : JSON.parse(createValue);
      }
      const url = targetUrl(createScope);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(t("saveError"));
      toast(t("created"));
      setCreating(false);
      setCreateKey("");
      setCreateValue("");
      setCreateCols([]);
      await load();
    } catch (err) {
      const message = err instanceof SyntaxError ? t("invalidJson") : err instanceof Error ? err.message : t("saveError");
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Jeu d'essai                                                         */
  /* ------------------------------------------------------------------ */

  async function seed(e: React.FormEvent) {
    e.preventDefault();
    if (!seedKey.trim() || !seedPrompt.trim() || seeding) return;
    setSeeding(true);
    setError(null);
    try {
      const isGlobal = createScope === "global";
      const isApp = createScope.startsWith("app:");
      const isScript = createScope.startsWith("script:");
      // For simple mode, also handle legacy "app"/"script"
      const legacyApp = !isAllMode && createScope === "app";
      const legacyScript = !isAllMode && createScope === "script";
      let scope: Scope = "global";
      let id: string | null = null;
      if (isApp || legacyApp) {
        scope = "app";
        id = isApp ? createScope.slice(4) : appId;
      } else if (isScript || legacyScript) {
        scope = "script";
        id = isScript ? createScope.slice(7) : scriptId;
      }
      const body: Record<string, unknown> = {
        scope,
        key: seedKey.trim(),
        kind: seedKind,
        prompt: seedPrompt.trim(),
      };
      if (scope === "app" && id) body.id = id;
      if (scope === "script" && id) body.id = id;
      // Simple mode fallback already covered, but keep old logic for non-all
      if (!isAllMode) {
        if (createScope === "app" && appId) body.id = appId;
        if (createScope === "script" && scriptId) body.id = scriptId;
        // override scope to createScope when legacy
        if (!isGlobal && !isApp && !isScript) {
          body.scope = createScope;
        }
      }
      if (isGlobal) body.scope = "global";
      const res = await fetch("/api/storage/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? t("seedError"));
      toast(t("seeded"));
      setSeedOpen(false);
      setSeedKey("");
      setSeedPrompt("");
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : t("seedError");
      setError(message);
      toast(message, "danger");
    } finally {
      setSeeding(false);
    }
  }

  /* ------------------------------------------------------------------ */
  /* CSV                                                                 */
  /* ------------------------------------------------------------------ */

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

  async function importCsv() {
    if (!selected) return;
    const text = await pickCsvFile();
    if (!text) return;
    try {
      setCsvPreview(parseCsv(text));
    } catch {
      setError(t("invalidCsv"));
      toast(t("invalidCsv"), "danger");
    }
  }

  /** Applique l'aperçu CSV au brouillon (remplacement ou ajout en fin). */
  function applyCsv(mode: "replace" | "append") {
    const live = draftRef.current ?? draft;
    if (!live || !csvPreview) return;
    const incoming = csvPreview.map((r) =>
      "id" in r ? r : { ...r, id: undefined },
    );
    const mergedRows =
      mode === "replace"
        ? incoming.map(assignRowIds)
        : [...live.rows, ...incoming.map(assignRowIds)];
    const next: TableDraft = { columns: tableColumnsOf(mergedRows), rows: mergedRows };
    // Remplacement externe : ref + remontage (les inputs non contrôlés doivent
    // re-seeder leur defaultValue avec les lignes importées).
    applyExternalDraft(next);
    setIsDirty(true);
    setCsvPreview(null);
  }

  function exportCsv() {
    if (!selected) return;
    const table = toTable(selected.value);
    if (!table) return;
    downloadCsv(`${selected.key}.csv`, toCsv(table.rows));
  }

  /* ------------------------------------------------------------------ */
  /* Rendu                                                               */
  /* ------------------------------------------------------------------ */

  const hasAny = entries.length > 0;

  async function saveManifest() {
    if (!appId || saving) return;
    setSaving(true);
    setError(null);
    try {
      const parsed = JSON.parse(manifestValue);
      const res = await fetch(`/api/apps/${appId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manifest: parsed }),
      });
      if (!res.ok) throw new Error(t("saveError"));
      toast(t("manifestSaved"));
      setManifestOpen(false);
    } catch (err) {
      const message =
        err instanceof SyntaxError ? t("invalidJson") : err instanceof Error ? err.message : t("saveError");
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  const createForm = isCreating && (
    <form onSubmit={createEntry} className="mt-4 space-y-3 rounded-xl border border-line bg-canvas p-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("fieldScope")}>
          {isAllMode ? (
            <Select value={createScope} onChange={(e) => setCreateScope(e.target.value)}>
              {createOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          ) : (
            <Select value={createScope} onChange={(e) => setCreateScope(e.target.value as Scope)}>
              {scopes.map((s) => (
                <option key={s} value={s}>
                  {scopeLabel(s)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("fieldKey")}>
          <Input value={createKey} onChange={(e) => setCreateKey(e.target.value)} placeholder="todos" />
        </Field>
        <Field label={t("fieldKind")}>
          <Select value={createKind} onChange={(e) => setCreateKind(e.target.value as "kv" | "table")}>
            <option value="kv">kv</option>
            <option value="table">table</option>
          </Select>
        </Field>
        {createScope === "global" && (
          <Field label={t("fieldVisibility")}>
            <Select
              value={createVisibility}
              onChange={(e) => setCreateVisibility(e.target.value as "private" | "family")}
            >
              <option value="private">{t("visibilityPrivate")}</option>
              <option value="family">{t("visibilityFamily")}</option>
            </Select>
          </Field>
        )}
      </div>

      {createKind === "table" ? (
        <ColumnBuilder
          cols={createCols}
          onColsChange={setCreateCols}
          nameLabel={t("builderColName")}
          hint={t("builderHint")}
          addLabel={t("colAdd")}
        />
      ) : (
        <Field label={t("fieldValue")}>
          <Textarea
            value={createValue}
            onChange={(e) => setCreateValue(e.target.value)}
            rows={4}
            placeholder={'{"theme": "clair"}'}
          />
        </Field>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving || !createKey.trim()}>
          {saving ? tCommon("saving") : t("createSubmit")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={closeCreating}>
          {tCommon("cancel")}
        </Button>
      </div>
    </form>
  );

  return (
    <div className="space-y-4">
      {minimal ? (
        <>
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("searchPlaceholder")}
                aria-label={t("searchLabel")}
                className="pl-9"
              />
            </div>
            {!hideScopeFilter && scopes.length > 1 && (
              <Select
                value={scopeFilter}
                onChange={(e) => setScopeFilter(e.target.value as ScopeFilter)}
                aria-label={t("scopeFilterLabel")}
                className="w-auto shrink-0"
              >
                <option value="all">{t("scopeAll")}</option>
                {scopes.map((s) => (
                  <option key={s} value={s}>
                    {scopeLabel(s)}
                  </option>
                ))}
              </Select>
            )}
            <div className="shrink-0">{toolbar}</div>
          </div>

          {(isCreating || error) && (
            <Card>
              {createForm}
              {error && <p className="mt-3 text-sm text-danger">{error}</p>}
            </Card>
          )}
        </>
      ) : (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-brand-dark">{t("title")}</h2>
              <p className="text-sm text-muted">{t("description")}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => setSeedOpen((v) => !v)} disabled={seeding}>
                {seeding ? tCommon("saving") : <Sparkles className="size-4" />}
                {t("seedTitle")}
              </Button>
              <Button size="sm" onClick={toggleCreating}>
                <Plus className="size-4" />
                {t("newKey")}
              </Button>
            </div>
          </div>

          {seedOpen && (
            <form onSubmit={seed} className="mt-4 space-y-3 rounded-xl border border-line bg-canvas p-4">
              <div className="flex flex-wrap items-end gap-3">
                <Field label={t("fieldScope")}>
                  {isAllMode ? (
                    <Select value={createScope} onChange={(e) => setCreateScope(e.target.value)}>
                      {createOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Select value={createScope} onChange={(e) => setCreateScope(e.target.value as Scope)}>
                      {scopes.map((s) => (
                        <option key={s} value={s}>
                          {scopeLabel(s)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label={t("fieldKey")}>
                  <Input value={seedKey} onChange={(e) => setSeedKey(e.target.value)} placeholder="todos" />
                </Field>
                <Field label={t("fieldKind")}>
                  <Select value={seedKind} onChange={(e) => setSeedKind(e.target.value as "kv" | "table")}>
                    <option value="table">table</option>
                    <option value="kv">kv</option>
                  </Select>
                </Field>
              </div>
              <Field label={t("seedPromptLabel")}>
                <Textarea
                  value={seedPrompt}
                  onChange={(e) => setSeedPrompt(e.target.value)}
                  rows={2}
                  placeholder={t("seedPromptPlaceholder")}
                />
              </Field>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={seeding || !seedKey.trim() || !seedPrompt.trim()}>
                  {seeding ? tCommon("saving") : t("seedGenerate")}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setSeedOpen(false)}>
                  {tCommon("cancel")}
                </Button>
              </div>
            </form>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchLabel")}
              className="max-w-xs"
            />
            {!hideScopeFilter && scopes.length > 1 && (
              <Select
                value={scopeFilter}
                onChange={(e) => setScopeFilter(e.target.value as ScopeFilter)}
                aria-label={t("scopeFilterLabel")}
                className="w-auto shrink-0"
              >
                <option value="all">{t("scopeAll")}</option>
                {scopes.map((s) => (
                  <option key={s} value={s}>
                    {scopeLabel(s)}
                  </option>
                ))}
              </Select>
            )}
          </div>

          {createForm}

          {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        </Card>
      )}

      {!minimal && missingKeys.length > 0 && (
        <Card>
          <p className="text-sm text-muted">
            {t("missingHint", { keys: missingKeys.join(", ") })}
          </p>
        </Card>
      )}

      {!hasAny && !loading && (
        <Card>
          <p className="text-sm text-muted">{t("empty")}</p>
        </Card>
      )}

      {hasAny && (
        <div className="space-y-2">
          {!minimal && !isAllMode && (
            <div className="flex flex-wrap gap-2">
              {scopes.map((s) => (
                <Button key={s} size="sm" variant="secondary" onClick={() => clearScope(s)}>
                  {t("clearScopeAction", { scope: scopeLabel(s) })}
                </Button>
              ))}
            </div>
          )}

          <div className="space-y-2">
            {filtered.map((entry) => {
              const isOrphan = !isAllMode && entry.scope === "app" && declaredKeys.length > 0 && !declaredKeys.includes(entry.key);
              const rowCount = entry.kind === "table" && Array.isArray(entry.value) ? entry.value.length : null;
              // Clé unique : doit distinguer les mêmes clés sur différentes apps/scripts
              const rowKey =
                entry.scope === "app" && entry.appId
                  ? `app:${entry.appId}:${entry.key}`
                  : entry.scope === "script" && entry.scriptId
                    ? `script:${entry.scriptId}:${entry.key}`
                    : `${entry.scope}:${entry.key}`;
              return (
                <div
                  key={rowKey}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line bg-card p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="text-sm font-semibold">{entry.key}</code>
                      <Badge variant={entry.scope === "global" ? "default" : "neutral"}>
                        {scopeLabel(entry.scope)}
                      </Badge>
                      <Badge>{entry.kind}</Badge>
                      {rowCount !== null && <span className="text-xs text-muted">{t("rowsCount", { count: rowCount })}</span>}
                      {entry.scope === "global" && entry.visibility === "family" && (
                        <Badge variant="success">{t("visibilityFamily")}</Badge>
                      )}
                      {isAllMode && entry.scope === "app" && entry.appName && (
                        <Badge variant="neutral">
                          {entry.appName} · /a/{entry.appSlug}
                        </Badge>
                      )}
                      {isAllMode && entry.scope === "script" && entry.scriptName && (
                        <Badge variant="neutral">{entry.scriptName}</Badge>
                      )}
                      {!minimal && isOrphan && <Badge variant="danger">{t("orphan")}</Badge>}
                    </div>
                    <pre className="mt-1 truncate text-xs text-muted">{prettyJson(entry.value)}</pre>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {minimal ? (
                      <Link
                        href={editHref(entry)}
                        title={t("edit")}
                        className="inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-semibold text-muted hover:bg-brand-light hover:text-ink"
                      >
                        <Pencil className="size-4" />
                      </Link>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => openEdit(entry)} title={t("edit")}>
                        <Pencil className="size-4" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        openAssistant(
                          {
                            appId: entry.scope === "app" ? (entry.appId ?? appId) : null,
                            scriptId: entry.scope === "script" ? (entry.scriptId ?? scriptId) : null,
                            storage: {
                              scope: entry.scope,
                              key: entry.key,
                              appId: entry.scope === "app" ? (entry.appId ?? appId) : null,
                              scriptId: entry.scope === "script" ? (entry.scriptId ?? scriptId) : null,
                            },
                          },
                          `Aide-moi avec la clé storage "${entry.key}" (${entry.scope})`,
                        )
                      }
                      title="Assistant"
                    >
                      <Sparkles className="size-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => removeEntry(entry)} title={tCommon("delete")}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && <p className="text-sm text-muted">{t("noResults")}</p>}
          </div>
        </div>
      )}

      {selected && !minimal && (
        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <Database className="size-4 text-muted" />
              <code className="text-sm font-semibold">{selected.key}</code>
              <Badge>{selected.kind}</Badge>
              {selected.kind === "table" && Array.isArray(selected.value) && (
                <span className="text-xs text-muted">{t("rowsCount", { count: selected.value.length })}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void copyText(prettyJson(selected.value)).then(() => toast(t("copied")))}
                title={t("copy")}
              >
                <Copy className="size-4" />
              </Button>
              {selected.kind === "table" && draft && draft.rows.length > 0 && (
                <Button size="sm" variant="ghost" onClick={exportCsv} title={t("exportCsv")}>
                  {t("exportCsv")}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={!isDirty || saving}
                onClick={() => {
                  if (!selected) return;
                  applyExternalDraft(tableDraftOf(selected.value));
                  const s = prettyJson(selected.schema ?? null);
                  setSchemaValue(s === "null" ? "" : s);
                  setIsDirty(false);
                  setConflict(false);
                  setCsvPreview(null);
                }}
                title={t("revert")}
              >
                <RotateCcw className="size-4" />
                {t("revert")}
              </Button>
              <Button size="sm" variant="primary" onClick={() => void saveEdit()} disabled={saving}>
                {saving ? tCommon("saving") : t("save")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void closeDetail()}>
                <X className="size-4" />
              </Button>
            </div>
          </div>

          {conflict && (
            <div className="border-b border-line px-4 py-2">
              <Alert variant="danger">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  {error}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      resetDetail();
                      await load();
                    }}
                  >
                    {tCommon("reload")}
                  </Button>
                </span>
              </Alert>
            </div>
          )}

          <div className="max-h-[55vh] overflow-auto p-4">
            {selected.kind === "table" && draft ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span>{t("tableSize", { rows: draft.rows.length, cols: draft.columns.length })}</span>
                    <Button size="sm" variant="ghost" onClick={importCsv}>
                      {t("importCsv")}
                    </Button>
                  </div>

                  {csvPreview && (
                    <div className="border border-line bg-canvas rounded-lg p-3">
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
                            <X className="size-4" />
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
                    draft={draft!}
                    schema={parseSchemaText(schemaValue).value}
                    onChange={updateDraft}
                  />

                  {/* Schéma */}
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
                <Textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} rows={12} className="font-mono" />
              )}
          </div>
        </Card>
      )}

      {appId != null && !minimal && (manifestData || manifestOpen) && (
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-brand-dark">{t("manifestTitle")}</h3>
              <p className="text-sm text-muted">{t("manifestDescription")}</p>
            </div>
            {!manifestOpen ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  try {
                    setManifestValue(manifest ? prettyJson(JSON.parse(manifest)) : "{}");
                  } catch {
                    setManifestValue("{}");
                  }
                  setManifestOpen(true);
                }}
              >
                {t("manifestEdit")}
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void saveManifest()} disabled={saving}>
                  {saving ? tCommon("saving") : t("save")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setManifestOpen(false)}>
                  {tCommon("cancel")}
                </Button>
              </div>
            )}
          </div>

          {manifestOpen ? (
            <Textarea
              value={manifestValue}
              onChange={(e) => setManifestValue(e.target.value)}
              rows={8}
              className="mt-3 font-mono"
            />
          ) : (
            <div className="mt-3 space-y-1.5">
              {manifestData?.tools?.map((tool) => (
                <div key={tool.name} className="flex flex-wrap items-center gap-2 text-sm">
                  <code className="font-semibold">{tool.name}</code>
                  <Badge>{tool.storage?.op ?? "?"}</Badge>
                  <code className="text-xs text-muted">→ {tool.storage?.key ?? "?"}</code>
                  {tool.description && (
                    <span className="truncate text-muted">{tool.description}</span>
                  )}
                </div>
              ))}
              {(!manifestData?.tools || manifestData.tools.length === 0) && (
                <p className="text-sm text-muted">{t("manifestEmpty")}</p>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

/* --- sous-composants ------------------------------------------------------- */

function assignRowIds(row: Record<string, unknown>): Record<string, unknown> {
  if (typeof row.id === "string" && row.id) return row;
  return { id: crypto.randomUUID().replace(/-/g, "").slice(0, 14), ...row };
}

function tableColumnsOf(rows: Record<string, unknown>[]): string[] {
  return [...new Set(rows.flatMap((r) => Object.keys(r)))];
}

/** Parse pragmatique du texte de schéma : renvoie la valeur ou un marqueur d'erreur. */
function parseSchemaText(text: string): { value?: unknown; invalid: boolean } {
  if (text.trim() === "") return { value: undefined, invalid: false };
  try {
    return { value: JSON.parse(text), invalid: false };
  } catch {
    return { value: undefined, invalid: true };
  }
}

/**
 * Constructeur de colonnes pour la création d'une clé « table » :
 * liste nom + type, remplaçant l'ancien champ JSON libre.
 */
function ColumnBuilder({
  cols,
  onColsChange,
  nameLabel,
  hint,
  addLabel,
}: {
  cols: BuilderColumn[];
  onColsChange: (cols: BuilderColumn[]) => void;
  nameLabel: string;
  hint: string;
  addLabel: string;
}) {
  const t = useTranslations("storageExplorer");
  const typeLabels: Record<BuilderColumn["type"], string> = {
    string: t("typeText"),
    number: t("typeNumber"),
    boolean: t("typeToggle"),
  };
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">{hint}</p>
      {cols.map((col, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={col.name}
            onChange={(e) =>
              onColsChange(cols.map((c, j) => (j === i ? { ...c, name: e.target.value } : c)))
            }
            placeholder={`${nameLabel.toLowerCase()}${i + 1}`}
            className="max-w-[12rem]"
            aria-label={`${nameLabel} ${i + 1}`}
          />
          <Select
            value={col.type}
            aria-label={`type ${i + 1}`}
            onChange={(e) =>
              onColsChange(
                cols.map((c, j) => (j === i ? { ...c, type: e.target.value as BuilderColumn["type"] } : c)),
              )
            }
            className="max-w-[10rem]"
          >
            {BUILDER_TYPES.map((tp) => (
              <option key={tp} value={tp}>
                {typeLabels[tp]}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onColsChange(cols.filter((_, j) => j !== i))}
            title="✕"
          >
            ✕
          </Button>
        </div>
      ))}
      <Button size="sm" variant="secondary" type="button" onClick={() => onColsChange([...cols, { name: "", type: "string" }])}>
        <Plus className="size-3.5" />
        {addLabel}
      </Button>
    </div>
  );
}
