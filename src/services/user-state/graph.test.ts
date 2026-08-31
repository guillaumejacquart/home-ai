import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { describeSchedule } from "@/services/user-state/schedule";
import { matchMemoryToApps, matchMemoryToStorages } from "@/services/user-state/match";
import { formatGraphBlock } from "@/services/user-state/context";
import type { UserStateGraph } from "@/services/user-state/types";

describe("describeSchedule", () => {
  it("décrit un quotidien à heure fixe", () => {
    expect(describeSchedule("0 8 * * *")).toBe("Tous les jours à 08h00");
  });

  it("décrit un jour de la semaine à heure fixe", () => {
    expect(describeSchedule("0 9 * * 1")).toBe("Chaque lundi à 09h00");
    expect(describeSchedule("0 19 * * 0")).toBe("Chaque dimanche à 19h00");
  });

  it("décrit le premier du mois", () => {
    expect(describeSchedule("0 8 1 * *")).toBe("Le 1 du mois à 08h00");
  });

  it("retourne null pour les patterns non décrits", () => {
    expect(describeSchedule("*/30 * * * *")).toBeNull();
    expect(describeSchedule("0 8 * 6 *")).toBeNull();
    expect(describeSchedule("pas une script")).toBeNull();
  });
});

describe("matchMemoryToApps", () => {
  const apps = [
    { id: "app:1", name: "Recettes de cuisine", slug: "recettes", tags: [] },
    { id: "app:2", name: "Budget familial", slug: "budget", tags: ["argent"] },
    { id: "app:3", name: "Planning semaine", slug: "planning", tags: [] },
  ];

  it("relie une mémoire projet à l'app correspondante", () => {
    const res = matchMemoryToApps("projet : refaire les recettes italiennes", apps);
    expect(res?.id).toBe("app:1");
    expect(res && res.score >= 0.25).toBe(true);
  });

  it("relie une mémoire budget", () => {
    const res = matchMemoryToApps("je veux suivre mon budget mensuel", apps);
    expect(res?.id).toBe("app:2");
  });

  it("ne relie rien sans mot commun", () => {
    const res = matchMemoryToApps("préfère les réponses courtes", apps);
    expect(res).toBeNull();
  });
});

describe("matchMemoryToStorages", () => {
  const storages = [
    { id: "storage:app:1:recettes", text: "Recettes de cuisine recettes" },
    { id: "storage:global:u:liste-courses", text: "liste-courses" },
  ];

  it("relie une mémoire à une clé de stockage", () => {
    const res = matchMemoryToStorages("pense à ajouter des courses à la liste", storages);
    expect(res?.id).toBe("storage:global:u:liste-courses");
  });

  it("ne relie rien sans correspondance forte", () => {
    const res = matchMemoryToStorages("j'aime la montagne", storages);
    expect(res).toBeNull();
  });
});

describe("formatGraphBlock", () => {
  function makeGraph(over: Partial<UserStateGraph> = {}): UserStateGraph {
    return {
      userId: "u1",
      generatedAt: new Date().toISOString(),
      nodes: [
        { id: "user:u1", kind: "user", label: "Utilisateur", updatedAt: null },
        { id: "app:a1", kind: "app", label: "Recettes", updatedAt: null },
        { id: "memory:m1", kind: "memory", label: "projet recettes italiennes", data: { kind: "project" }, updatedAt: null, weight: 1 },
        { id: "script:c1", kind: "script", label: "Courses", updatedAt: null },
        { id: "signal:routine:c1", kind: "signal", label: "Chaque samedi à 09h00", data: { signalKind: "routine" }, updatedAt: null },
        { id: "conn:c2", kind: "connection", label: "Google", data: { status: "active" }, updatedAt: null },
      ],
      edges: [
        { from: "memory:m1", to: "app:a1", kind: "RELATES_TO", weight: 0.5 },
        { from: "script:c1", to: "signal:routine:c1", kind: "ROUTINE", weight: 1 },
      ],
      ...over,
    };
  }

  it("produit un bloc avec souvenirs, routines et capacités", () => {
    const block = formatGraphBlock(makeGraph());
    expect(block.text).toContain("État utilisateur");
    expect(block.text).toContain("[project] projet recettes italiennes → Recettes");
    expect(block.text).toContain("Routines");
    expect(block.text).toContain("Courses : Chaque samedi à 09h00");
    expect(block.text).toContain("Capacités : Google (active)");
    expect(block.memoryIds).toContain("memory:m1");
  });

  it("retourne un bloc vide pour un graphe vide", () => {
    const block = formatGraphBlock({ userId: "u1", generatedAt: "", nodes: [], edges: [] });
    expect(block.text).toBe("");
    expect(block.memoryIds).toEqual([]);
  });

  it("respecte le budget de caractères", () => {
    const manyMemories: UserStateGraph["nodes"] = [];
    for (let i = 0; i < 40; i++) {
      manyMemories.push({
        id: `memory:mm${i}`,
        kind: "memory",
        label: `souvenir de test numéro ${i} avec du texte pour occuper l'espace disponible dans le bloc`,
        data: { kind: "fact" },
        updatedAt: null,
        weight: 0.6,
      });
    }
    const block = formatGraphBlock(makeGraph({ nodes: [...makeGraph().nodes, ...manyMemories] }));
    expect(block.text.length).toBeLessThanOrEqual(2200);
  });
});

describe("getUserStateGraph (intégration)", () => {
  let dir: string;
  let dbPath: string;
  let userId: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "homeai-userstate-"));
    dbPath = join(dir, "test.db");
    process.env.SQLITE_PATH = dbPath;
    process.env.ENCRYPTION_KEY = "test-encryption-key-12345678901234567890";

    const { createRequire } = await import("node:module");
    const { drizzle } = await import("drizzle-orm/better-sqlite3");
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const Database = createRequire(import.meta.url)("better-sqlite3");
    const sqlite = new Database(dbPath);
    migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
    sqlite.close();

    const { db, tables } = await import("@/db/client");
    userId = "user-state-1";
    await db.insert(tables.user).values({
      id: userId,
      name: "Test",
      email: "userstate@test.com",
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.SQLITE_PATH;
  });

  it("construit le graphe : apps, routines, mémoire liée, santé", async () => {
    const { createApp } = await import("@/services/apps/apps");
    const { createScript } = await import("@/services/scripts/scripts");
    const { runScript } = await import("@/services/scripts/runner");
    const { addMemory } = await import("@/services/agent/memory");
    const { appScope, storageSet } = await import("@/services/storage/storage");
    const { getUserStateGraph } = await import("@/services/user-state/graph");

    const app = (await createApp(userId, { name: "Recettes de cuisine" })).id;
    await storageSet(appScope(app), "recettes", [{ titre: "Pizza" }], { kind: "table" });
    await addMemory(userId, {
      kind: "project",
      content: "projet : mes recettes italiennes préférées",
      source: "auto",
    });
    const failScript = await createScript({
      ownerId: userId,
      name: "Script en panne",
      schedule: "0 9 * * 1",
      code: `async function main(home) { throw new Error("boom"); }`,
    });
    await runScript(failScript);

    const graph = await getUserStateGraph(userId);

    const appNode = graph.nodes.find((n) => n.kind === "app");
    expect(appNode?.label).toBe("Recettes de cuisine");

    const storageNode = graph.nodes.find((n) => n.kind === "storage");
    expect(storageNode?.id).toBe(`storage:app:${app}:recettes`);
    expect(graph.edges.some((e) => e.kind === "STORES" && e.to === storageNode?.id)).toBe(true);

    const memNode = graph.nodes.find((n) => n.kind === "memory");
    expect(memNode).toBeTruthy();
    expect(
      graph.edges.some(
        (e) => e.kind === "RELATES_TO" && e.from === memNode?.id && e.to === `app:${app}`,
      ),
    ).toBe(true);

    const routine = graph.nodes.find((n) => n.kind === "signal" && n.data?.signalKind === "routine");
    expect(routine?.label).toBe("Chaque lundi à 09h00");

    const health = graph.nodes.find((n) => n.kind === "signal" && n.data?.signalKind === "health");
    expect(health?.data?.status).toBe("error");

    // Vérifie que le bloc injectable contient la routine et la mémoire.
    const block = formatGraphBlock(graph);
    expect(block.text).toContain("Chaque lundi à 09h00");
    expect(block.text).toContain("recettes italiennes");
  });

  it("scope strictement par userId : les données d'un autre utilisateur sont absentes", async () => {
    const { db, tables } = await import("@/db/client");
    const { createApp } = await import("@/services/apps/apps");
    const { getUserStateGraph } = await import("@/services/user-state/graph");

    const otherId = "user-state-other";
    await db.insert(tables.user).values({
      id: otherId,
      name: "Other",
      email: "other@test.com",
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const app = (await createApp(otherId, { name: "App Secrète" })).id;

    const graph = await getUserStateGraph(userId);
    expect(graph.nodes.some((n) => n.kind === "app" && n.label === "App Secrète")).toBe(false);
    expect(graph.nodes.some((n) => n.id === `app:${app}`)).toBe(false);
  });
});