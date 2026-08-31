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
  it("découpe les virgules simples", () => {
    expect(splitCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });
  it("gère les guillemets et les virgules échappées", () => {
    expect(splitCsvLine('"a, b","c""d"')).toEqual(["a, b", 'c"d']);
  });
});

describe("storage-table.parseCsv", () => {
  it("parse en-tête + lignes", () => {
    const rows = parseCsv("id,text\n1,hello\n2,world\n");
    expect(rows).toEqual([
      { id: 1, text: "hello" },
      { id: 2, text: "world" },
    ]);
  });
  it("jette si moins de deux lignes", () => {
    expect(() => parseCsv("a,b")).toThrow("invalidCsv");
  });
  it("jette si l'en-tête contient une case vide", () => {
    expect(() => parseCsv("a,\n1,x")).toThrow("invalidCsv");
  });
});

describe("storage-table.toCsv", () => {
  it("sérialise les lignes avec en-tête", () => {
    const csv = toCsv([
      { id: 1, text: "hello" },
      { id: 2, text: "wo,rld" },
    ]);
    expect(csv).toBe('id,text\n1,hello\n2,"wo,rld"');
  });
  it("round-trip avec parseCsv", () => {
    const rows = [
      { id: 1, done: true, note: "a,b" },
      { id: 2, done: false, note: "c" },
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe("storage-table.inferKind", () => {
  it("détecte un tableau d'objets homogènes en table", () => {
    expect(inferKind([{ a: 1 }, { a: 2 }])).toBe("table");
  });
  it("retombe sur kv pour les autres valeurs", () => {
    expect(inferKind([1, 2])).toBe("kv");
    expect(inferKind("x")).toBe("kv");
    expect(inferKind({ a: 1 })).toBe("kv");
    expect(inferKind([])).toBe("kv");
  });
});

describe("storage-table.toTable", () => {
  it("extrait colonnes + lignes d'un tableau d'objets", () => {
    const table = toTable([{ id: "a", done: true }, { id: "b", done: false }]);
    expect(table?.columns).toEqual(["id", "done"]);
    expect(table?.rows).toHaveLength(2);
  });
  it("renvoie null pour les non-tableaux", () => {
    expect(toTable({})).toBeNull();
    expect(toTable("x")).toBeNull();
  });
  it("ne tronque plus les colonnes au-delà de 8", () => {
    const row = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`c${i}`, i]));
    expect(toTable([row])?.columns).toHaveLength(10);
  });
});

describe("storage-table.tableColumns / isTableValue", () => {
  it("déduplique les colonnes en préservant l'ordre", () => {
    expect(tableColumns([{ a: 1, b: 2 }, { b: 3, c: 4 }])).toEqual(["a", "b", "c"]);
  });
  it("isTableValue accepte les tableaux d'objets (même vides), refuse le reste", () => {
    expect(isTableValue([{ a: 1 }])).toBe(true);
    expect(isTableValue([])).toBe(true);
    expect(isTableValue([{ a: 1 }, "x"])).toBe(false);
    expect(isTableValue([{ a: 1 }, null])).toBe(false);
    expect(isTableValue([[1]])).toBe(false);
  });
});

describe("storage-table.inferColumnType", () => {
  it("détecte boolean / number / string", () => {
    const rows = [
      { name: "a", done: true, n: 1 },
      { name: "b", done: false, n: 2 },
    ];
    expect(inferColumnType(rows, "name")).toBe("string");
    expect(inferColumnType(rows, "done")).toBe("boolean");
    expect(inferColumnType(rows, "n")).toBe("number");
  });
  it("ignore les cellules vides et retombe bien", () => {
    const rows = [{ n: null }, { n: 3 }];
    expect(inferColumnType(rows, "n")).toBe("number");
    expect(inferColumnType([{ x: "" }, { x: undefined }], "x")).toBe("string");
  });
  it("retourne json pour les objets ; string pour les mélanges de primitifs", () => {
    expect(inferColumnType([{ o: { a: 1 } }], "o")).toBe("json");
    // Mélange number + string : éditable en texte (parseCell fait le round-trip).
    expect(inferColumnType([{ v: 1 }, { v: "x" }], "v")).toBe("string");
    expect(inferColumnType([{ v: true }, { v: 1 }], "v")).toBe("string");
  });
});

describe("storage-table.inferJsonSchema", () => {
  it("déduit les types et les colonnes requises", () => {
    const schema = inferJsonSchema([
      { id: "a", done: true, note: "" },
      { id: "b", done: false },
    ]);
    expect(schema.properties).toEqual({ id: { type: "string" }, done: { type: "boolean" } });
    expect(schema.required).toEqual(["id", "done"]);
  });
  it("exclut les colonnes json du schéma typé", () => {
    const schema = inferJsonSchema([{ meta: { a: 1 } }]);
    expect(schema.properties).toEqual({});
    expect(schema.required).toBeUndefined();
  });
});

describe("storage-table.applyRowOp", () => {
  const rows = [
    { id: "a", label: "Lait", done: false },
    { id: "b", label: "Pain", done: true },
  ];

  it("add ajoute une ligne avec id généré", () => {
    const res = applyRowOp(rows, { kind: "add", row: { label: "Café" } });
    expect(res.rows).toHaveLength(3);
    expect(res.rows[2].label).toBe("Café");
    expect(typeof res.rows[2].id).toBe("string");
    expect(res.changed).toEqual(res.rows[2]);
  });
  it("add respecte un id fourni par l'appelant", () => {
    const res = applyRowOp(rows, { kind: "add", row: { id: "z", label: "Thé" } });
    expect(res.rows[2].id).toBe("z");
  });
  it("update fusionne le patch et renvoie la ligne modifiée", () => {
    const res = applyRowOp(rows, { kind: "update", id: "a", patch: { done: true } });
    expect(res.rows[0]).toEqual({ id: "a", label: "Lait", done: true });
    expect(res.changed).toEqual(res.rows[0]);
    expect(rows[0].done).toBe(false); // immuable
  });
  it("update jette rowNotFound si la ligne manque", () => {
    expect(() => applyRowOp(rows, { kind: "update", id: "zz", patch: {} })).toThrow("rowNotFound");
  });
  it("remove compte les lignes supprimées", () => {
    const res = applyRowOp(rows, { kind: "remove", id: "b" });
    expect(res.removed).toBe(1);
    expect(res.rows.map((r) => r.id)).toEqual(["a"]);
  });
  it("removeMany supprime plusieurs lignes", () => {
    const res = applyRowOp(rows, { kind: "removeMany", ids: ["a", "b", "x"] });
    expect(res.removed).toBe(2);
    expect(res.rows).toHaveLength(0);
  });
  it("toggle inverse le champ (done par défaut)", () => {
    const res = applyRowOp(rows, { kind: "toggle", id: "a" });
    expect(res.changed).toEqual({ id: "a", label: "Lait", done: true });
    const custom = applyRowOp(rows, { kind: "toggle", id: "b", field: "archived" });
    expect(custom.changed).toEqual({ ...rows[1], archived: true });
  });
  it("toggle jette rowNotFound si la ligne manque", () => {
    expect(() => applyRowOp(rows, { kind: "toggle", id: "nope" })).toThrow("rowNotFound");
  });
  it("jette notATable si la valeur n'est pas une table", () => {
    expect(() => applyRowOp({ a: 1 }, { kind: "add", row: {} })).toThrow("notATable");
    expect(() => applyRowOp(null, { kind: "removeMany", ids: [] })).toThrow("notATable");
    // Un tableau vide est une table valide : removeMany ne jette pas.
    expect(() => applyRowOp([], { kind: "removeMany", ids: ["a"] })).not.toThrow();
  });
  it("newRowId produit des ids courts uniques", () => {
    const a = newRowId();
    const b = newRowId();
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(14);
  });
});

describe("storage-table.colonnes (add/rename/delete/move)", () => {
  const rows = [{ id: "a", nom: "Lait" }, { id: "b", autre: 1 }];

  it("appendColumn ajoute une colonne vide ; refuse collision ou vide", () => {
    const ok = appendColumn(rows, ["id", "nom"], "done");
    expect(ok?.columns).toEqual(["id", "nom", "done"]);
    expect(ok?.rows[0]).toEqual({ id: "a", nom: "Lait", done: "" });
    expect(appendColumn(rows, ["id"], "id")).toBeNull();
    expect(appendColumn(rows, ["id"], "  ")).toBeNull();
  });

  it("renameColumn déplace la valeur dans toutes les lignes ; refuse collision", () => {
    const ok = renameColumn(rows, ["id", "nom", "autre"], "nom", "titre");
    expect(ok?.columns).toEqual(["id", "titre", "autre"]);
    expect(ok?.rows[0].titre).toBe("Lait");
    expect(ok?.rows[0].nom).toBeUndefined();
    expect(renameColumn(rows, ["id"], "id", "autre")).toBeNull();
  });

  it("deleteColumn retire la colonne et les valeurs associées", () => {
    const res = deleteColumn(rows, ["id", "nom", "autre"], "nom");
    expect(res.columns).toEqual(["id", "autre"]);
    expect(res.rows[0]).toEqual({ id: "a" });
  });

  it("moveColumn déplace et reste borné", () => {
    expect(moveColumn(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveColumn(["a", "b"], 5, 1)).toEqual(["a", "b"]);
    expect(moveColumn(["a", "b"], 0, -3)).toEqual(["a", "b"]);
  });
});

describe("storage-table.isRowOpInput", () => {
  it("valide les formes d'opérations", () => {
    expect(isRowOpInput({ kind: "add", row: {} })).toBe(true);
    expect(isRowOpInput({ kind: "update", id: "x", patch: { a: 1 } })).toBe(true);
    expect(isRowOpInput({ kind: "remove", id: "x" })).toBe(true);
    expect(isRowOpInput({ kind: "removeMany", ids: [] })).toBe(true);
    expect(isRowOpInput({ kind: "toggle", id: "x" })).toBe(true);
    expect(isRowOpInput({ kind: "toggle", id: "x", field: "archived" })).toBe(true);
  });
  it("rejette les opérations malformées", () => {
    expect(isRowOpInput(null)).toBe(false);
    expect(isRowOpInput({ kind: "boom" })).toBe(false);
    expect(isRowOpInput({ kind: "add" })).toBe(false); // row manquant
    expect(isRowOpInput({ kind: "add", row: [1] })).toBe(false);
    expect(isRowOpInput({ kind: "update", patch: {} })).toBe(false);
    expect(isRowOpInput({ kind: "removeMany", ids: "x" })).toBe(false);
    expect(isRowOpInput({ kind: "toggle", id: "x", field: 3 })).toBe(false);
  });
});