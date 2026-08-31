import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { describeSchedule, formatRoutine } from "@/services/user-state/schedule";
import { matchMemoryToApps, matchMemoryToStorages } from "@/services/user-state/match";
import { formatGraphBlock } from "@/services/user-state/context";
import type { UserStateGraph } from "@/services/user-state/types";

describe("describeSchedule", () => {
  it("describes a daily schedule at a fixed hour", () => {
    expect(describeSchedule("0 8 * * *")).toEqual({ key: "daily", hour: 8 });
    expect(formatRoutine(describeSchedule("0 8 * * *")!)).toBe("Every day at 08:00");
  });

  it("describes a weekday at a fixed hour", () => {
    expect(describeSchedule("0 9 * * 1")).toEqual({ key: "weekly", weekday: 1, hour: 9 });
    expect(formatRoutine(describeSchedule("0 9 * * 1")!)).toBe("Every Monday at 09:00");
    expect(formatRoutine(describeSchedule("0 19 * * 0")!)).toBe("Every Sunday at 19:00");
  });

  it("describes the first day of the month", () => {
    expect(describeSchedule("0 8 1 * *")).toEqual({ key: "monthly", day: 1, hour: 8 });
    expect(formatRoutine(describeSchedule("0 8 1 * *")!)).toBe("Day 1 of the month at 08:00");
  });

  it("returns null for patterns it can't describe", () => {
    expect(describeSchedule("*/30 * * * *")).toBeNull();
    expect(describeSchedule("0 8 * 6 *")).toBeNull();
    expect(describeSchedule("not a schedule")).toBeNull();
  });
});

describe("matchMemoryToApps", () => {
  const apps = [
    { id: "app:1", name: "Cooking recipes", slug: "recipes", tags: [] },
    { id: "app:2", name: "Family budget", slug: "budget", tags: ["money"] },
    { id: "app:3", name: "Weekly planning", slug: "planning", tags: [] },
  ];

  it("links a project memory to the matching app", () => {
    const res = matchMemoryToApps("project: redo the italian recipes", apps);
    expect(res?.id).toBe("app:1");
    expect(res && res.score >= 0.25).toBe(true);
  });

  it("links a budget memory", () => {
    const res = matchMemoryToApps("I want to track my monthly budget", apps);
    expect(res?.id).toBe("app:2");
  });

  it("links nothing when there's no common word", () => {
    const res = matchMemoryToApps("prefers short answers", apps);
    expect(res).toBeNull();
  });
});

describe("matchMemoryToStorages", () => {
  const storages = [
    { id: "storage:app:1:recipes", text: "Cooking recipes recipes" },
    { id: "storage:global:u:shopping-list", text: "shopping-list" },
  ];

  it("links a memory to a storage key", () => {
    const res = matchMemoryToStorages("remember to add groceries to the list", storages);
    expect(res?.id).toBe("storage:global:u:shopping-list");
  });

  it("links nothing without a strong match", () => {
    const res = matchMemoryToStorages("I love the mountains", storages);
    expect(res).toBeNull();
  });
});

describe("formatGraphBlock", () => {
  function makeGraph(over: Partial<UserStateGraph> = {}): UserStateGraph {
    return {
      userId: "u1",
      generatedAt: new Date().toISOString(),
      nodes: [
        { id: "user:u1", kind: "user", label: "User", updatedAt: null },
        { id: "app:a1", kind: "app", label: "Recipes", updatedAt: null },
        { id: "memory:m1", kind: "memory", label: "italian recipes project", data: { kind: "project" }, updatedAt: null, weight: 1 },
        { id: "script:c1", kind: "script", label: "Groceries", updatedAt: null },
        { id: "signal:routine:c1", kind: "signal", label: "Every Saturday at 09:00", data: { signalKind: "routine" }, updatedAt: null },
        { id: "conn:c2", kind: "connection", label: "Google", data: { status: "active" }, updatedAt: null },
      ],
      edges: [
        { from: "memory:m1", to: "app:a1", kind: "RELATES_TO", weight: 0.5 },
        { from: "script:c1", to: "signal:routine:c1", kind: "ROUTINE", weight: 1 },
      ],
      ...over,
    };
  }

  it("produces a block with memories, routines and capabilities", () => {
    const block = formatGraphBlock(makeGraph());
    expect(block.text).toContain("User state");
    expect(block.text).toContain("[project] italian recipes project → Recipes");
    expect(block.text).toContain("Routines");
    expect(block.text).toContain("Groceries: Every Saturday at 09:00");
    expect(block.text).toContain("Capabilities: Google (active)");
    expect(block.memoryIds).toContain("memory:m1");
  });

  it("returns an empty block for an empty graph", () => {
    const block = formatGraphBlock({ userId: "u1", generatedAt: "", nodes: [], edges: [] });
    expect(block.text).toBe("");
    expect(block.memoryIds).toEqual([]);
  });

  it("respects the character budget", () => {
    const manyMemories: UserStateGraph["nodes"] = [];
    for (let i = 0; i < 40; i++) {
      manyMemories.push({
        id: `memory:mm${i}`,
        kind: "memory",
        label: `test memory number ${i} with some text to take up the space available in the block`,
        data: { kind: "fact" },
        updatedAt: null,
        weight: 0.6,
      });
    }
    const block = formatGraphBlock(makeGraph({ nodes: [...makeGraph().nodes, ...manyMemories] }));
    expect(block.text.length).toBeLessThanOrEqual(2200);
  });
});

describe("getUserStateGraph (integration)", () => {
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

  it("builds the graph: apps, routines, linked memory, health", async () => {
    const { createApp } = await import("@/services/apps/apps");
    const { createScript } = await import("@/services/scripts/scripts");
    const { runScript } = await import("@/services/scripts/runner");
    const { addMemory } = await import("@/services/agent/memory");
    const { appScope, storageSet } = await import("@/services/storage/storage");
    const { getUserStateGraph } = await import("@/services/user-state/graph");

    const app = (await createApp(userId, { name: "Cooking recipes" })).id;
    await storageSet(appScope(app), "recipes", [{ title: "Pizza" }], { kind: "table" });
    await addMemory(userId, {
      kind: "project",
      content: "project: my favorite italian recipes",
      source: "auto",
    });
    const failScript = await createScript({
      ownerId: userId,
      name: "Broken script",
      schedule: "0 9 * * 1",
      code: `async function main(home) { throw new Error("boom"); }`,
    });
    await runScript(failScript);

    const graph = await getUserStateGraph(userId);

    const appNode = graph.nodes.find((n) => n.kind === "app");
    expect(appNode?.label).toBe("Cooking recipes");

    const storageNode = graph.nodes.find((n) => n.kind === "storage");
    expect(storageNode?.id).toBe(`storage:app:${app}:recipes`);
    expect(graph.edges.some((e) => e.kind === "STORES" && e.to === storageNode?.id)).toBe(true);

    const memNode = graph.nodes.find((n) => n.kind === "memory");
    expect(memNode).toBeTruthy();
    expect(
      graph.edges.some(
        (e) => e.kind === "RELATES_TO" && e.from === memNode?.id && e.to === `app:${app}`,
      ),
    ).toBe(true);

    const routine = graph.nodes.find((n) => n.kind === "signal" && n.data?.signalKind === "routine");
    expect(routine?.label).toBe("Every Monday at 09:00");

    const health = graph.nodes.find((n) => n.kind === "signal" && n.data?.signalKind === "health");
    expect(health?.data?.status).toBe("error");

    // The injectable block should surface both the routine and the memory.
    const block = formatGraphBlock(graph);
    expect(block.text).toContain("Every Monday at 09:00");
    expect(block.text).toContain("italian recipes");
  });

  it("scopes strictly by userId: another user's data is absent", async () => {
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
    const app = (await createApp(otherId, { name: "Secret App" })).id;

    const graph = await getUserStateGraph(userId);
    expect(graph.nodes.some((n) => n.kind === "app" && n.label === "Secret App")).toBe(false);
    expect(graph.nodes.some((n) => n.id === `app:${app}`)).toBe(false);
  });
});