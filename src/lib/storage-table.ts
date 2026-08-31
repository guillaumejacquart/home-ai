/**
 * Helpers for the "Data Studio": CSV ↔ rows conversions, and inference of the
 * kind of a storage value (kv vs table). Framework-agnostic and testable.
 */

/** Parses a cell: JSON when possible, raw string otherwise. */
export function parseCell(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

/** Splits a CSV line into cells (handles quotes and escaped commas). */
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

/** Parses a CSV (header + rows) into an array of objects. Throws if the header is empty. */
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

/** Serialises an array of rows to CSV (header derived from the keys). */
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

/** Infers a value's storage kind: `table` for an array of homogeneous objects, `kv` otherwise. */
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

/** If the value is an array of homogeneous objects, returns columns + rows. */
export function toTable(value: unknown): { columns: string[]; rows: Record<string, unknown>[] } | null {
  if (!isTableValue(value)) return null;
  return { columns: tableColumns(value), rows: value };
}

/** An empty cell counts as missing for inference purposes. */
function isEmptyCell(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

/** Deduplicated columns of an array of objects, first-seen order preserved. */
export function tableColumns(rows: Record<string, unknown>[]): string[] {
  return [...new Set(rows.flatMap((r) => Object.keys(r)))];
}

/** Guard: the value is an array of homogeneous objects (a "table").
 * An empty array is still a valid table — that is what allows appending
 * rows to a key created empty. */
export function isTableValue(value: unknown): value is Record<string, unknown>[] {
  return (
    Array.isArray(value) &&
    value.every((v) => v !== null && typeof v === "object" && !Array.isArray(v))
  );
}

export type StorageColumnType = "boolean" | "number" | "string" | "json";

/**
 * Dominant type of a column, found by scanning non-empty cells: boolean /
 * number when every cell is one, json when at least one is an object/array,
 * string otherwise (the readable catch-all).
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
  // Mixed primitives: editable as text (parseCell guarantees the round-trip).
  if (primitives.size !== 1) return "string";
  return primitives.has("boolean") ? "boolean" : primitives.has("number") ? "number" : "string";
}

/** Minimal JSON schema derived from the data (the "Infer schema" button).
 * Columns that are entirely empty or complex (json) are excluded — type not inferable. */
export function inferJsonSchema(
  rows: Record<string, unknown>[],
): { type: "object"; properties: Record<string, { type: string }>; required?: string[] } {
  const cols = tableColumns(rows);
  const properties: Record<string, { type: string }> = {};
  const typed: string[] = [];
  for (const col of cols) {
    // Fully empty column: nothing to infer.
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
// Row ops: CRUD primitives on a "table" value. A single implementation, shared
// by the REST routes, the manifest tools and the home.* SDKs
// ---------------------------------------------------------------------------

export type TableRowOp =
  | { kind: "add"; row: Record<string, unknown>; id?: string }
  | { kind: "update"; id: string; patch: Record<string, unknown> }
  | { kind: "remove"; id: string }
  | { kind: "removeMany"; ids: string[] }
  | { kind: "toggle"; id: string; field?: string };

export interface RowOpResult {
  rows: Record<string, unknown>[];
  /** Row added or modified (add/update). */
  changed?: Record<string, unknown>;
  /** Number of rows deleted (remove/removeMany). */
  removed?: number;
}

/** Short readable per-row id (14 chars), using crypto when available. */
export function newRowId(): string {
  try {
    return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 14);
  } catch {
    return `r${Math.random().toString(36).slice(2, 12)}`;
  }
}

const ROW_OP_KINDS = new Set<string>(["add", "update", "remove", "removeMany", "toggle"]);

/** Input guard for a row operation coming off the network (REST / RPC). */
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
  // Unreachable as long as ROW_OP_KINDS covers every case; required by TS.
  return false;
}

// ---------------------------------------------------------------------------
// Column operations (grid editor + table builder)
// ---------------------------------------------------------------------------

export interface ColumnsAndRows {
  columns: string[];
  rows: Record<string, unknown>[];
}

/** Appends an empty column (no-op if the name is already taken). */
export function appendColumn(rows: Record<string, unknown>[], columns: string[], name: string): ColumnsAndRows | null {
  const n = name.trim();
  if (!n || columns.includes(n)) return null;
  return {
    columns: [...columns, n],
    rows: rows.map((r) => ({ ...r, [n]: "" })),
  };
}

/** Renames a column (returns null when empty or on a collision). */
export function renameColumn(
  rows: Record<string, unknown>[],
  columns: string[],
  from: string,
  to: string,
): ColumnsAndRows | null {
  const n = to.trim();
  if (!from || !n || from === n) return null;
  // Collision: existing column OR key already present in a row.
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

/** Removes a column and its value from every row. */
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

/** Moves a column by `delta` positions (-1 left / +1 right). */
export function moveColumn(columns: string[], index: number, delta: number): string[] {
  const target = index + delta;
  if (index < 0 || index >= columns.length || target < 0 || target >= columns.length) return columns;
  const next = [...columns];
  next.splice(target, 0, ...next.splice(index, 1));
  return next;
}

/**
 * Applies a row operation to a storage value. Pure and immutable:
 * returns a new array. Throws `notATable` when the value is not a table, and
 * `rowNotFound` when an update/toggle cannot find its row.
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