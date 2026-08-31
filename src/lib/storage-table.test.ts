import { describe, expect, it } from "vitest";

import {
  applyRowOp,
  appendColumn,
  deleteColumn,
  inferColumnType,
  inferJsonSchema,
  inferKind,
  isRowOpInput,
  isTableValue,
  moveColumn,
  newRowId,
  parseCsv,
  renameColumn,
  splitCsvLine,
  toCsv,
  toTable,
  tableColumns,
} from "@/lib/storage-table";

describe("storage-table.splitCsvLine", () => {
  it("splits simple commas", () => {
    expect(splitCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });
  it("handles quotes and escaped commas", () => {
    expect(splitCsvLine('"a, b","c""d"')).toEqual(["a, b", 'c"d']);
  });
});

describe("storage-table.parseCsv", () => {
  it("parses header + rows", () => {
    const rows = parseCsv("id,text\n1,hello\n2,world\n");
    expect(rows).toEqual([
      { id: 1, text: "hello" },
      { id: 2, text: "world" },
    ]);
  });
  it("throws if there are fewer than two lines", () => {
    expect(() => parseCsv("a,b")).toThrow("invalidCsv");
  });
  it("throws if the header has an empty cell", () => {
    expect(() => parseCsv("a,\n1,x")).toThrow("invalidCsv");
  });
});

describe("storage-table.toCsv", () => {
  it("serializes rows with a header", () => {
    const csv = toCsv([
      { id: 1, text: "hello" },
      { id: 2, text: "wo,rld" },
    ]);
    expect(csv).toBe('id,text\n1,hello\n2,"wo,rld"');
  });
  it("round-trips with parseCsv", () => {
    const rows = [
      { id: 1, done: true, note: "a,b" },
      { id: 2, done: false, note: "c" },
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe("storage-table.inferKind", () => {
  it("detects an array of homogeneous objects as a table", () => {
    expect(inferKind([{ a: 1 }, { a: 2 }])).toBe("table");
  });
  it("falls back to kv for other values", () => {
    expect(inferKind([1, 2])).toBe("kv");
    expect(inferKind("x")).toBe("kv");
    expect(inferKind({ a: 1 })).toBe("kv");
    expect(inferKind([])).toBe("kv");
  });
});

describe("storage-table.toTable", () => {
  it("extracts columns + rows from an array of objects", () => {
    const table = toTable([{ id: "a", done: true }, { id: "b", done: false }]);
    expect(table?.columns).toEqual(["id", "done"]);
    expect(table?.rows).toHaveLength(2);
  });
  it("returns null for non-arrays", () => {
    expect(toTable({})).toBeNull();
    expect(toTable("x")).toBeNull();
  });
  it("no longer truncates columns past 8", () => {
    const row = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`c${i}`, i]));
    expect(toTable([row])?.columns).toHaveLength(10);
  });
});

describe("storage-table.tableColumns / isTableValue", () => {
  it("dedupes columns while preserving order", () => {
    expect(tableColumns([{ a: 1, b: 2 }, { b: 3, c: 4 }])).toEqual(["a", "b", "c"]);
  });
  it("isTableValue accepts arrays of objects (even empty), rejects everything else", () => {
    expect(isTableValue([{ a: 1 }])).toBe(true);
    expect(isTableValue([])).toBe(true);
    expect(isTableValue([{ a: 1 }, "x"])).toBe(false);
    expect(isTableValue([{ a: 1 }, null])).toBe(false);
    expect(isTableValue([[1]])).toBe(false);
  });
});

describe("storage-table.inferColumnType", () => {
  it("detects boolean / number / string", () => {
    const rows = [
      { name: "a", done: true, n: 1 },
      { name: "b", done: false, n: 2 },
    ];
    expect(inferColumnType(rows, "name")).toBe("string");
    expect(inferColumnType(rows, "done")).toBe("boolean");
    expect(inferColumnType(rows, "n")).toBe("number");
  });
  it("ignores empty cells and falls back correctly", () => {
    const rows = [{ n: null }, { n: 3 }];
    expect(inferColumnType(rows, "n")).toBe("number");
    expect(inferColumnType([{ x: "" }, { x: undefined }], "x")).toBe("string");
  });
  it("returns json for objects; string for mixed primitives", () => {
    expect(inferColumnType([{ o: { a: 1 } }], "o")).toBe("json");
    // Mixing number + string: editable as text (parseCell round-trips it).
    expect(inferColumnType([{ v: 1 }, { v: "x" }], "v")).toBe("string");
    expect(inferColumnType([{ v: true }, { v: 1 }], "v")).toBe("string");
  });
});

describe("storage-table.inferJsonSchema", () => {
  it("infers types and required columns", () => {
    const schema = inferJsonSchema([
      { id: "a", done: true, note: "" },
      { id: "b", done: false },
    ]);
    expect(schema.properties).toEqual({ id: { type: "string" }, done: { type: "boolean" } });
    expect(schema.required).toEqual(["id", "done"]);
  });
  it("excludes json columns from the typed schema", () => {
    const schema = inferJsonSchema([{ meta: { a: 1 } }]);
    expect(schema.properties).toEqual({});
    expect(schema.required).toBeUndefined();
  });
});

describe("storage-table.applyRowOp", () => {
  const rows = [
    { id: "a", label: "Milk", done: false },
    { id: "b", label: "Bread", done: true },
  ];

  it("add appends a row with a generated id", () => {
    const res = applyRowOp(rows, { kind: "add", row: { label: "Coffee" } });
    expect(res.rows).toHaveLength(3);
    expect(res.rows[2].label).toBe("Coffee");
    expect(typeof res.rows[2].id).toBe("string");
    expect(res.changed).toEqual(res.rows[2]);
  });
  it("add respects an id provided by the caller", () => {
    const res = applyRowOp(rows, { kind: "add", row: { id: "z", label: "Tea" } });
    expect(res.rows[2].id).toBe("z");
  });
  it("update merges the patch and returns the modified row", () => {
    const res = applyRowOp(rows, { kind: "update", id: "a", patch: { done: true } });
    expect(res.rows[0]).toEqual({ id: "a", label: "Milk", done: true });
    expect(res.changed).toEqual(res.rows[0]);
    expect(rows[0].done).toBe(false); // immutable
  });
  it("update throws rowNotFound when the row is missing", () => {
    expect(() => applyRowOp(rows, { kind: "update", id: "zz", patch: {} })).toThrow("rowNotFound");
  });
  it("remove counts the deleted rows", () => {
    const res = applyRowOp(rows, { kind: "remove", id: "b" });
    expect(res.removed).toBe(1);
    expect(res.rows.map((r) => r.id)).toEqual(["a"]);
  });
  it("removeMany deletes multiple rows", () => {
    const res = applyRowOp(rows, { kind: "removeMany", ids: ["a", "b", "x"] });
    expect(res.removed).toBe(2);
    expect(res.rows).toHaveLength(0);
  });
  it("toggle flips the field (done by default)", () => {
    const res = applyRowOp(rows, { kind: "toggle", id: "a" });
    expect(res.changed).toEqual({ id: "a", label: "Milk", done: true });
    const custom = applyRowOp(rows, { kind: "toggle", id: "b", field: "archived" });
    expect(custom.changed).toEqual({ ...rows[1], archived: true });
  });
  it("toggle throws rowNotFound when the row is missing", () => {
    expect(() => applyRowOp(rows, { kind: "toggle", id: "nope" })).toThrow("rowNotFound");
  });
  it("throws notATable when the value isn't a table", () => {
    expect(() => applyRowOp({ a: 1 }, { kind: "add", row: {} })).toThrow("notATable");
    expect(() => applyRowOp(null, { kind: "removeMany", ids: [] })).toThrow("notATable");
    // An empty array is a valid table: removeMany does not throw.
    expect(() => applyRowOp([], { kind: "removeMany", ids: ["a"] })).not.toThrow();
  });
  it("newRowId produces unique short ids", () => {
    const a = newRowId();
    const b = newRowId();
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(14);
  });
});

describe("storage-table.columns (add/rename/delete/move)", () => {
  const rows = [{ id: "a", name: "Milk" }, { id: "b", other: 1 }];

  it("appendColumn adds an empty column; rejects collision or blank name", () => {
    const ok = appendColumn(rows, ["id", "name"], "done");
    expect(ok?.columns).toEqual(["id", "name", "done"]);
    expect(ok?.rows[0]).toEqual({ id: "a", name: "Milk", done: "" });
    expect(appendColumn(rows, ["id"], "id")).toBeNull();
    expect(appendColumn(rows, ["id"], "  ")).toBeNull();
  });

  it("renameColumn moves the value across all rows; rejects collision", () => {
    const ok = renameColumn(rows, ["id", "name", "other"], "name", "title");
    expect(ok?.columns).toEqual(["id", "title", "other"]);
    expect(ok?.rows[0].title).toBe("Milk");
    expect(ok?.rows[0].name).toBeUndefined();
    expect(renameColumn(rows, ["id"], "id", "other")).toBeNull();
  });

  it("deleteColumn removes the column and its values", () => {
    const res = deleteColumn(rows, ["id", "name", "other"], "name");
    expect(res.columns).toEqual(["id", "other"]);
    expect(res.rows[0]).toEqual({ id: "a" });
  });

  it("moveColumn moves and stays within bounds", () => {
    expect(moveColumn(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveColumn(["a", "b"], 5, 1)).toEqual(["a", "b"]);
    expect(moveColumn(["a", "b"], 0, -3)).toEqual(["a", "b"]);
  });
});

describe("storage-table.isRowOpInput", () => {
  it("validates operation shapes", () => {
    expect(isRowOpInput({ kind: "add", row: {} })).toBe(true);
    expect(isRowOpInput({ kind: "update", id: "x", patch: { a: 1 } })).toBe(true);
    expect(isRowOpInput({ kind: "remove", id: "x" })).toBe(true);
    expect(isRowOpInput({ kind: "removeMany", ids: [] })).toBe(true);
    expect(isRowOpInput({ kind: "toggle", id: "x" })).toBe(true);
    expect(isRowOpInput({ kind: "toggle", id: "x", field: "archived" })).toBe(true);
  });
  it("rejects malformed operations", () => {
    expect(isRowOpInput(null)).toBe(false);
    expect(isRowOpInput({ kind: "boom" })).toBe(false);
    expect(isRowOpInput({ kind: "add" })).toBe(false); // missing row
    expect(isRowOpInput({ kind: "add", row: [1] })).toBe(false);
    expect(isRowOpInput({ kind: "update", patch: {} })).toBe(false);
    expect(isRowOpInput({ kind: "removeMany", ids: "x" })).toBe(false);
    expect(isRowOpInput({ kind: "toggle", id: "x", field: 3 })).toBe(false);
  });
});