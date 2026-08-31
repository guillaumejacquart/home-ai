"use client";

import { useRef, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Plus,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge, Button, Input, Textarea, Toggle } from "@/components/ui";
import {
  appendColumn,
  deleteColumn,
  inferColumnType,
  moveColumn,
  newRowId,
  renameColumn,
  type StorageColumnType,
} from "@/lib/storage-table";

/**
 * CRUD grid for a "table" key: pagination, in-view sorting, multi-select,
 * addable / renamable / movable / deletable columns, typed cell editors
 * (declared schema if provided, otherwise inferred from the data).
 * Editing model: text/number cells are uncontrolled — they only commit on
 * blur/Enter, so no keystroke re-renders the grid.
 * Everything stays a draft: nothing is written until the parent panel's
 * "Save" button.
 */

export interface TableDraft {
  columns: string[];
  rows: Record<string, unknown>[];
}

interface TableEditorProps {
  draft: TableDraft;
  schema?: unknown;
  onChange: (next: TableDraft) => void;
}

/** Editorial type of a column: declared schema, otherwise inferred from the rows. */
function resolveColumnType(
  col: string,
  rows: Record<string, unknown>[],
  schema?: unknown,
): StorageColumnType {
  const props =
    schema && typeof schema === "object"
      ? ((schema as { properties?: Record<string, { type?: string }> }).properties ?? undefined)
      : undefined;
  const declared = props?.[col]?.type;
  if (declared === "boolean") return "boolean";
  if (declared === "number" || declared === "integer") return "number";
  return inferColumnType(rows, col);
}

function formatCellValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  return typeof v === "string" ? v : JSON.stringify(v);
}

/* --- cell editors ------------------------------------------------------------ */

function JsonCellEditor({
  value,
  onCommit,
}: {
  value: unknown;
  onCommit: (v: unknown) => void;
}) {
  const pretty = (x: unknown) => (typeof x === "string" ? x : JSON.stringify(x, null, 2) ?? "");
  const [text, setText] = useState(() =>
    value === null || value === undefined ? "" : pretty(value),
  );
  return (
    <Textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        try {
          const parsed = text.trim() === "" ? "" : JSON.parse(text);
          onCommit(parsed);
          setText(pretty(parsed));
        } catch {
          // Invalid JSON: revert to the original value (no data loss).
          setText(pretty(value));
        }
      }}
      className="font-mono"
      rows={Math.min(4, Math.max(1, text.split("\n").length))}
    />
  );
}

/**
 * **Uncontrolled** cell input: typing triggers NO React state at all.
 * The value only commits to the draft on blur (or Enter). Since the grid
 * never re-renders while typing, focus physically cannot jump — no matter
 * what the parents do. Escape restores the original value; the next blur
 * then commits that same value (no-op).
 */
function CellInput({
  initial,
  type,
  ariaLabel,
  onCommit,
}: {
  initial: string;
  /** "text": commits raw; "number": parses on blur ("" is accepted). */
  type: "text" | "number";
  ariaLabel?: string;
  onCommit: (v: unknown) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  const commit = () => {
    const el = ref.current;
    if (!el) return;
    const raw = el.value;
    if (type === "number") {
      const v = raw.trim() === "" ? "" : Number(raw);
      // Normalize the display ("5." → "5") without clobbering ongoing input.
      if (document.activeElement !== el) el.value = typeof v === "number" ? String(v) : String(v);
      onCommit(v);
      return;
    }
    onCommit(raw);
  };

  return (
    <Input
      ref={ref}
      type={type}
      step={type === "number" ? "any" : undefined}
      defaultValue={initial}
      className="border-transparent bg-transparent px-1 py-0.5 hover:border-line"
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = initial;
          e.currentTarget.blur();
        }
      }}
      aria-label={ariaLabel}
    />
  );
}

function TableCellInput({
  value,
  type,
  colName,
  onCommit,
}: {
  value: unknown;
  type: StorageColumnType;
  colName: string;
  onCommit: (v: unknown) => void;
}) {
  const isComplex = value !== null && value !== undefined && typeof value === "object";
  if (isComplex || type === "json") {
    return <JsonCellEditor value={value} onCommit={onCommit} />;
  }
  if (type === "boolean") {
    return (
      <Toggle
        checked={Boolean(value)}
        label={colName}
        onChange={() => onCommit(!Boolean(value))}
      />
    );
  }
  return (
    <CellInput
      initial={formatCellValue(value)}
      type={type === "number" ? "number" : "text"}
      ariaLabel={colName}
      onCommit={onCommit}
    />
  );
}

/* --- main component ----------------------------------------------------------- */

// Row-model factories hoisted outside render: recreating a generator on
// every keystroke would invalidate the table's internal models.
const CORE_ROW_MODEL = getCoreRowModel();
const SORTED_ROW_MODEL = getSortedRowModel();
const PAGINATED_ROW_MODEL = getPaginationRowModel();

export function TableEditor({ draft, schema, onChange }: TableEditorProps) {
  const t = useTranslations("storageExplorer");
  const { columns, rows } = draft;

  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [newColName, setNewColName] = useState("");
  const [renamingCol, setRenamingCol] = useState<string | null>(null);

  /* --- mutations (draft only) ------------------------------------------------ */
  const emit = (next: Partial<TableDraft>) =>
    onChange({ columns: next.columns ?? columns, rows: next.rows ?? rows });

  const updateCell = (ri: number, col: string, v: unknown) =>
    emit({ rows: rows.map((r, i) => (i === ri ? { ...r, [col]: v } : r)) });

  const addRow = () => {
    const next = Object.fromEntries(columns.map((c) => [c, ""])) as Record<string, unknown>;
    next.id = newRowId();
    emit({ rows: [...rows, next] });
  };

  // Operations target the original objects (by identity), not keys:
  // reliable even without an id field and with in-view sorting enabled.
  const duplicateRows = (targets: Record<string, unknown>[]) => {
    const set = new Set(targets);
    emit({ rows: rows.flatMap((r) => (set.has(r) ? [r, { ...r, id: newRowId() }] : [r])) });
  };
  const deleteRows = (targets: Record<string, unknown>[]) => {
    const set = new Set(targets);
    emit({ rows: rows.filter((r) => !set.has(r)) });
    setRowSelection({});
  };

  const handleAppendColumn = () => {
    const res = appendColumn(rows, columns, newColName);
    if (!res) return;
    setNewColName("");
    onChange(res);
  };
  const handleRenameColumn = (from: string, to: string) => {
    setRenamingCol(null);
    const res = renameColumn(rows, columns, from, to);
    if (res) onChange(res);
  };

  /* --- model columns ---------------------------------------------------------
     Definitions rebuilt on every render: closures are always fresh. */
  const selectDef: ColumnDef<Record<string, unknown>, unknown> = {
    id: "__select",
    header: ({ table }) => (
      <input
        type="checkbox"
        aria-label={t("selectedCount", { count: 0 })}
        checked={table.getIsAllPageRowsSelected()}
        onChange={table.getToggleAllPageRowsSelectedHandler()}
        className="size-3.5 accent-brand"
      />
    ),
    cell: ({ row }) => (
      <input
        type="checkbox"
        aria-label={`#${row.index + 1}`}
        checked={row.getIsSelected()}
        onChange={row.getToggleSelectedHandler()}
        className="size-3.5 accent-brand"
      />
    ),
    enableSorting: false,
  };

  const dataDefs: ColumnDef<Record<string, unknown>, unknown>[] = columns.map((col) => ({
    accessorKey: col,
    enableSorting: false,
    header: () =>
      renamingCol === col ? (
        <InlineRename key={col} current={col} onDone={(to) => handleRenameColumn(col, to)} />
      ) : (
        <div className="group flex items-center gap-1">
          <button
            type="button"
            className="flex items-center gap-1 whitespace-nowrap font-semibold text-brand-dark hover:text-brand"
            onClick={() =>
              setSorting((s) =>
                s[0]?.id === col && s[0].desc
                  ? []
                  : [{ id: col, desc: s[0]?.id !== col || !s[0].desc }],
              )
            }
          >
            {col}
            {sorting.find((s) => s.id === col)?.desc ? (
              <ChevronDown className="size-3" />
            ) : sorting.find((s) => s.id === col) ? (
              <ChevronUp className="size-3" />
            ) : null}
          </button>
          <span className="hidden shrink-0 items-center gap-0.5 text-[11px] text-muted group-hover:flex">
            <button type="button" className="hover:text-ink" title={t("colRename")} onClick={() => setRenamingCol(col)}>
              ✎
            </button>
            <button
              type="button"
              className="hover:text-ink"
              title={t("colMoveLeft")}
              onClick={() => emit({ columns: moveColumn(columns, columns.indexOf(col), -1) })}
            >
              ◀
            </button>
            <button
              type="button"
              className="hover:text-ink"
              title={t("colMoveRight")}
              onClick={() => emit({ columns: moveColumn(columns, columns.indexOf(col), +1) })}
            >
              ▶
            </button>
            <button
              type="button"
              className="hover:text-danger"
              title={t("colDelete")}
              onClick={() => onChange(deleteColumn(rows, columns, col))}
            >
              ✕
            </button>
          </span>
        </div>
      ),
    cell: ({ getValue, row }) => (
      <TableCellInput
        value={getValue()}
        type={resolveColumnType(col, rows, schema)}
        colName={col}
        onCommit={(v) => updateCell(row.index, col, v)}
      />
    ),
  }));

  const actionsDef: ColumnDef<Record<string, unknown>, unknown> = {
    id: "__actions",
    enableSorting: false,
    header: () => <span />,
    cell: ({ row }) => (
      <span className="flex gap-0.5">
        <Button size="sm" variant="ghost" className="px-1" title={t("rowDuplicate")} onClick={() => duplicateRows([row.original])}>
          <Copy className="size-3.5" />
        </Button>
        <Button size="sm" variant="ghost" className="px-1" title={t("rowDelete")} onClick={() => deleteRows([row.original])}>
          <Trash2 className="size-3.5" />
        </Button>
      </span>
    ),
  };

  const tableColumns: ColumnDef<Record<string, unknown>, unknown>[] = [
    selectDef,
    ...dataDefs,
    actionsDef,
  ];

  const table = useReactTable({
    data: rows,
    columns: tableColumns,
    getCoreRowModel: CORE_ROW_MODEL,
    getSortedRowModel: SORTED_ROW_MODEL,
    getPaginationRowModel: PAGINATED_ROW_MODEL,
    getRowId: (_row: Record<string, unknown>, index: number) => String(index),
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    initialState: { pagination: { pageSize: 50 } },
    autoResetPageIndex: true,
  });

  const selectedRows = table.getSelectedRowModel().rows.map((r) => r.original);
  const pageCount = Math.max(1, table.getPageCount());
  const { pageIndex } = table.getState().pagination;

  return (
    <div className="space-y-2">
      {/* Toolbar: selection / add column */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-h-8 items-center gap-2">
          {selectedRows.length > 0 && (
            <>
              <Badge variant="neutral">{t("selectedCount", { count: selectedRows.length })}</Badge>
              <Button size="sm" variant="secondary" onClick={() => duplicateRows(selectedRows)}>
                <Copy className="size-3.5" />
                {t("duplicateSelected")}
              </Button>
              <Button size="sm" variant="danger" onClick={() => deleteRows(selectedRows)}>
                <Trash2 className="size-3.5" />
                {t("deleteSelected")}
              </Button>
            </>
          )}
        </div>
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            handleAppendColumn();
          }}
        >
          <Input
            value={newColName}
            onChange={(e) => setNewColName(e.target.value)}
            placeholder={t("builderColName")}
            aria-label={t("colAdd")}
            className="h-8 max-w-[10rem]"
          />
          <Button size="sm" variant="secondary" type="submit" disabled={!newColName.trim()}>
            <Plus className="size-3.5" />
            {t("colAdd")}
          </Button>
        </form>
      </div>

      {/* Grid */}
      <div className="overflow-auto rounded-lg border border-line">
        <table className="w-full text-left text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-line bg-canvas">
                {hg.headers.map((h) => (
                  <th key={h.id} className="px-2 py-1.5">
                    {h.isPlaceholder
                      ? null
                      : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-b border-line/50 last:border-b-0">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-2 py-1 align-top">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 2} className="px-3 py-6 text-center text-sm text-muted">
                  {t("tableEditHint")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <p>{t("pageInfo", { page: pageIndex + 1, totalPages: pageCount, total: rows.length })}</p>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>
            <ChevronLeft className="size-4" />
            {t("pagePrev")}
          </Button>
          <Button size="sm" variant="ghost" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>
            {t("pageNext")}
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {/* Add row */}
      <Button size="sm" variant="secondary" type="button" onClick={addRow}>
        <Plus className="size-3.5" />
        {t("rowAdd")}
      </Button>
    </div>
  );
}

/* --- inline rename ------------------------------------------------------------ */

function InlineRename({ current, onDone }: { current: string; onDone: (to: string) => void }) {
  const [name, setName] = useState(current);
  const commit = () => {
    const n = name.trim();
    if (!n || n === current) onDone(current);
    else onDone(n);
  };
  return (
    <Input
      autoFocus
      value={name}
      onChange={(e) => setName(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") onDone(current);
      }}
      className="h-7 px-1 text-sm"
    />
  );
}
