/**
 * Helpers pour le « Data Studio » : conversions CSV ↔ lignes, et inférence du
 * type d'une valeur de stockage (kv vs table). Framework-agnostic, testable.
 */

/** Interprète une cellule : JSON si possible, sinon chaîne brute. */
export function parseCell(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

/** Découpe une ligne CSV en cellules (gère les guillemets et les virgules échappées). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** Parse un CSV (en-tête + lignes) en tableau d'objets. Jette si l'en-tête est vide. */
export function parseCsv(text: string): Record<string, unknown>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error("invalidCsv");
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  if (header.some((h) => !h)) throw new Error("invalidCsv");
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, unknown> = {};
    header.forEach((h, i) => {
      row[h] = parseCell(cells[i] ?? "");
    });
    return row;
  });
}

/** Sérialise un tableau de lignes en CSV (avec en-tête dérivé des clés). */
export function toCsv(rows: Record<string, unknown>[]): string {
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown): string => {
    const s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    columns.join(","),
    ...rows.map((r) => columns.map((c) => esc(r[c])).join(",")),
  ].join("\n");
}

/** Infère le type de stockage d'une valeur : `table` si tableau d'objets homogènes, sinon `kv`. */
export function inferKind(value: unknown): "kv" | "table" {
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => v && typeof v === "object" && !Array.isArray(v))
  ) {
    return "table";
  }
  return "kv";
}

/** Si la valeur est un tableau d'objets homogènes, renvoie colonnes + lignes. */
export function toTable(value: unknown): { columns: string[]; rows: Record<string, unknown>[] } | null {
  if (!isTableValue(value)) return null;
  return { columns: tableColumns(value), rows: value };
}

/** Cellule vide traitée comme absente pour l'inférence. */
function isEmptyCell(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

/** Colonnes dédupliquées d'un tableau d'objets, ordre de première apparition préservé. */
export function tableColumns(rows: Record<string, unknown>[]): string[] {
  return [...new Set(rows.flatMap((r) => Object.keys(r)))];
}

/** Garde : la valeur est un tableau d'objets homogènes (une « table »).
 * Un tableau vide reste une table valide — c'est ce qui permet d'ajouter
 * des lignes à une clé créée vide. */
export function isTableValue(value: unknown): value is Record<string, unknown>[] {
  return (
    Array.isArray(value) &&
    value.every((v) => v !== null && typeof v === "object" && !Array.isArray(v))
  );
}

export type StorageColumnType = "boolean" | "number" | "string" | "json";

/**
 * Type dominant d'une colonne en scannant les cellules non vides :
 * boolean / number si toutes les cellules le sont, sinon json si au moins un
 * objet/tableau, sinon string (cas fourre-tout lisible).
 */
export function inferColumnType(
  rows: Record<string, unknown>[],
  col: string,
): StorageColumnType {
  const primitives = new Set<string>();
  let hasComplex = false;
  for (const row of rows) {
    const v = row[col];
    if (isEmptyCell(v)) continue;
    if ((v !== null && typeof v === "object") || typeof v === "function" || Number.isNaN(v as never)) {
      hasComplex = true;
    } else {
      primitives.add(typeof v);
    }
  }
  if (hasComplex) return "json";
  // Mélange de primitifs : éditable en texte (parseCell assure le round-trip).
  if (primitives.size !== 1) return "string";
  return primitives.has("boolean") ? "boolean" : primitives.has("number") ? "number" : "string";
}

/** Schéma JSON minimal dérivé des données (bouton « Déduire le schéma »).
 * Colonnes toutes vides ou complexes (json) : exclues — type non déductible. */
export function inferJsonSchema(
  rows: Record<string, unknown>[],
): { type: "object"; properties: Record<string, { type: string }>; required?: string[] } {
  const cols = tableColumns(rows);
  const properties: Record<string, { type: string }> = {};
  const typed: string[] = [];
  for (const col of cols) {
    // Colonne entièrement vide : rien à inférer.
    if (rows.every((r) => isEmptyCell(r[col]))) continue;
    const type = inferColumnType(rows, col);
    if (type === "json") continue;
    properties[col] = { type };
    typed.push(col);
  }
  const required = typed.filter((c) => rows.every((r) => !isEmptyCell(r[c])));
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

// ---------------------------------------------------------------------------
// Row ops : primitives CRUD sur une valeur « table ». Une seule implémentation,
// partagée par les routes REST, les tools de manifeste et les SDK home.*
// ---------------------------------------------------------------------------

export type TableRowOp =
  | { kind: "add"; row: Record<string, unknown>; id?: string }
  | { kind: "update"; id: string; patch: Record<string, unknown> }
  | { kind: "remove"; id: string }
  | { kind: "removeMany"; ids: string[] }
  | { kind: "toggle"; id: string; field?: string };

export interface RowOpResult {
  rows: Record<string, unknown>[];
  /** Ligne ajoutée ou modifiée (add/update). */
  changed?: Record<string, unknown>;
  /** Nombre de lignes supprimées (remove/removeMany). */
  removed?: number;
}

/** Id court lisible côté ligne (14 chars), crypto quand disponible. */
export function newRowId(): string {
  try {
    return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 14);
  } catch {
    return `r${Math.random().toString(36).slice(2, 12)}`;
  }
}

const ROW_OP_KINDS = new Set<string>(["add", "update", "remove", "removeMany", "toggle"]);

/** Garde d'entrée pour une opération ligne reçue du réseau (REST / RPC). */
export function isRowOpInput(value: unknown): value is TableRowOp {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  if (typeof o.kind !== "string" || !ROW_OP_KINDS.has(o.kind)) return false;
  const isPlainObject = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
  switch (o.kind) {
    case "add":
      return isPlainObject(o.row);
    case "update":
      return typeof o.id === "string" && isPlainObject(o.patch);
    case "remove":
      return typeof o.id === "string";
    case "removeMany":
      return Array.isArray(o.ids);
    case "toggle":
      return typeof o.id === "string" && (o.field === undefined || typeof o.field === "string");
  }
  // Inatteignable si ROW_OP_KINDS couvre tous les cas ; requis par TS.
  return false;
}

// ---------------------------------------------------------------------------
// Opérations colonnes (éditeur de grille + constructeur de table)
// ---------------------------------------------------------------------------

export interface ColumnsAndRows {
  columns: string[];
  rows: Record<string, unknown>[];
}

/** Ajoute une colonne vide en fin de liste (no-op si nom déjà pris). */
export function appendColumn(rows: Record<string, unknown>[], columns: string[], name: string): ColumnsAndRows | null {
  const n = name.trim();
  if (!n || columns.includes(n)) return null;
  return {
    columns: [...columns, n],
    rows: rows.map((r) => ({ ...r, [n]: "" })),
  };
}

/** Renomme une colonne (retourne null si vide ou collision). */
export function renameColumn(
  rows: Record<string, unknown>[],
  columns: string[],
  from: string,
  to: string,
): ColumnsAndRows | null {
  const n = to.trim();
  if (!from || !n || from === n) return null;
  // Collision : colonne existante OU clé déjà présente dans une ligne.
  if (columns.includes(n) || rows.some((r) => n in r)) return null;
  const map = (v: Record<string, unknown>) => {
    if (!(from in v)) return v;
    const copy: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) copy[k === from ? n : k] = val;
    return copy;
  };
  return {
    columns: columns.map((c) => (c === from ? n : c)),
    rows: rows.map(map),
  };
}

/** Supprime une colonne et sa valeur dans chaque ligne. */
export function deleteColumn(
  rows: Record<string, unknown>[],
  columns: string[],
  col: string,
): ColumnsAndRows {
  return {
    columns: columns.filter((c) => c !== col),
    rows: rows.map((r) => {
      if (!(col in r)) return r;
      const copy = { ...r };
      delete copy[col];
      return copy;
    }),
  };
}

/** Déplace une colonne de `delta` positions (-1 gauche / +1 droite). */
export function moveColumn(columns: string[], index: number, delta: number): string[] {
  const target = index + delta;
  if (index < 0 || index >= columns.length || target < 0 || target >= columns.length) return columns;
  const next = [...columns];
  next.splice(target, 0, ...next.splice(index, 1));
  return next;
}

/**
 * Opère une opération ligne à une valeur de stockage. Pure et immuable :
 * renvoie un nouveau tableau. Jette `notATable` si la valeur n'est pas une
 * table et `rowNotFound` si un update/toggle ne trouve pas sa ligne.
 */
export function applyRowOp(value: unknown, op: TableRowOp): RowOpResult {
  if (!isTableValue(value)) throw new Error("notATable");
  const rows = value;

  switch (op.kind) {
    case "add": {
      const created = { id: op.id ?? newRowId(), ...op.row };
      return { rows: [...rows, created], changed: created };
    }

    case "update": {
      const next: Record<string, unknown>[] = [];
      let changed: Record<string, unknown> | null = null;
      for (const r of rows) {
        if (r.id === op.id) {
          changed = { ...r, ...op.patch };
          next.push(changed);
        } else {
          next.push(r);
        }
      }
      if (!changed) throw new Error("rowNotFound");
      return { rows: next, changed };
    }

    case "remove":
      return { rows: rows.filter((r) => r.id !== op.id), removed: rows.filter((r) => r.id === op.id).length };

    case "removeMany": {
      const ids = new Set(op.ids);
      const next = rows.filter((r) => !ids.has(String(r.id)));
      return { rows: next, removed: rows.length - next.length };
    }

    case "toggle": {
      const field = typeof op.field === "string" && op.field ? op.field : "done";
      const next: Record<string, unknown>[] = [];
      let toggled: Record<string, unknown> | null = null;
      for (const r of rows) {
        if (r.id === op.id) {
          toggled = { ...r, [field]: !Boolean(r[field]) };
          next.push(toggled);
        } else {
          next.push(r);
        }
      }
      if (!toggled) throw new Error("rowNotFound");
      return { rows: next, changed: toggled };
    }
  }
}