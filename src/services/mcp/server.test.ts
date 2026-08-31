import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { eq } from "drizzle-orm";

let dir: string;
let dbPath: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "homeai-mcp-"));
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

  await import("@/db/client");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.SQLITE_PATH;
});

/** Extracts the text of a tool result's first content block. */
function textOf(result: unknown): string {
  const content = (result as { content?: { type?: string; text?: string }[] }).content;
  return typeof content?.[0]?.text === "string" ? content[0].text : "";
}

describe("MCP server", () => {
  it("exposes the expected tools and runs them through the SDK", async () => {
    const { buildMcpServer } = await import("@/services/mcp/server");
    const { db, tables } = await import("@/db/client");
    const { createApp } = await import("@/services/apps/apps");

    const userId = "user-mcp-1";
    await db.insert(tables.user).values({
      id: userId,
      name: "Test",
      email: "mcp@example.com",
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { id: appId } = await createApp(userId, { name: "Notebook", hasUi: true });

    const server = await buildMcpServer(userId);
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientTransport);

    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    // MCP now exposes the whole shared registry (see services/tools/registry.ts).
    // Exact list on purpose: it flags any exposure added or lost.
    expect(names).toEqual([
      "add_dashboard_widget",
      "app_storage_get",
      "app_storage_list",
      "app_storage_remove",
      "app_storage_set",
      "call_connection_method",
      "call_rpc",
      "create_app",
      "create_dashboard",
      "create_script",
      "delete_app",
      "delete_dashboard",
      "delete_script",
      "generate_app",
      "generate_brief",
      "generate_script",
      "get_app",
      "get_app_html",
      "get_dashboard",
      "get_script",
      "global_storage_get",
      "global_storage_list",
      "global_storage_remove",
      "global_storage_set",
      "install_template",
      "list_apps",
      "list_connections",
      "list_dashboards",
      "list_script_runs",
      "list_scripts",
      "list_templates",
      "memory_delete",
      "memory_list",
      "memory_save",
      "plan_app",
      "plan_script",
      "platform_overview",
      "remove_dashboard_widget",
      "run_script",
      "update_app",
      "update_dashboard",
      "update_script",
      "user_state_graph",
    ]);

    // list_apps returns the owner's app.
    const listed = await client.callTool({ name: "list_apps", arguments: {} });
    const listedContent = JSON.parse(textOf(listed));
    expect(listedContent[0].id).toBe(appId);

    // app_storage_set/get: real write and read through the services.
    await client.callTool({
      name: "app_storage_set",
      arguments: { appId, key: "todos", value: [{ id: "a", done: false }] },
    });
    const read = await client.callTool({
      name: "app_storage_get",
      arguments: { appId, key: "todos" },
    });
    expect(JSON.parse(textOf(read)).value).toEqual([{ id: "a", done: false }]);

    // call_rpc → storage.set/get (real dispatch to the services).
    await client.callTool({
      name: "call_rpc",
      arguments: { appId, method: "storage.set", args: ["color", "blue"] },
    });
    const readRpc = await client.callTool({
      name: "call_rpc",
      arguments: { appId, method: "storage.get", args: ["color"] },
    });
    expect(JSON.parse(textOf(readRpc)).value).toBe("blue");

    await server.close();
    await client.close();
  });

  it("refuses to call call_rpc on another user's app", async () => {
    const { buildMcpServer } = await import("@/services/mcp/server");
    const { db, tables } = await import("@/db/client");
    const { createApp } = await import("@/services/apps/apps");

    const ownerId = "user-mcp-owner";
    const otherId = "user-mcp-other";
    await db.insert(tables.user).values({
      id: ownerId,
      name: "Owner",
      email: "owner@example.com",
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(tables.user).values({
      id: otherId,
      name: "Other",
      email: "other@example.com",
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { id: appId } = await createApp(ownerId, { name: "Private" });

    const server = await buildMcpServer(otherId);
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientTransport);

    const res = await client.callTool({
      name: "call_rpc",
      arguments: { appId, method: "storage.get", args: ["x"] },
    });
    expect(JSON.parse(textOf(res))).toEqual({ error: "App not found." });

    const res2 = await client.callTool({
      name: "app_storage_list",
      arguments: { appId },
    });
    expect(JSON.parse(textOf(res2))).toEqual({ error: "App not found." });

    await server.close();
    await client.close();
  });

  it("registers and runs the tools declared by an app's manifest", async () => {
    const { buildMcpServer } = await import("@/services/mcp/server");
    const { db, tables } = await import("@/db/client");
    const { createApp } = await import("@/services/apps/apps");

    const userId = "user-mcp-manifest";
    await db.insert(tables.user).values({
      id: userId,
      name: "Test",
      email: "manifest-mcp@example.com",
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { id: appId, slug } = await createApp(userId, { name: "List", hasUi: true });

    await db
      .update(tables.apps)
      .set({
        manifest: JSON.stringify({
          tools: [
            {
              name: "add",
              description: "Adds an item",
              parameters: {
                type: "object",
                properties: { text: { type: "string" } },
                required: ["text"],
              },
              storage: { op: "append", key: "items" },
            },
          ],
        }),
      })
      .where(eq(tables.apps.id, appId));

    const server = await buildMcpServer(userId);
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientTransport);

    const toolName = `app_${slug}__add`;
    const tools = await client.listTools();
    expect(tools.tools.some((t) => t.name === toolName)).toBe(true);

    const res = await client.callTool({
      name: toolName,
      arguments: { text: "buy milk" },
    });
    const parsed = JSON.parse(textOf(res));
    expect(parsed.id).toBeTruthy();
    expect(parsed.text).toBe("buy milk");

    await server.close();
    await client.close();
  });
});
