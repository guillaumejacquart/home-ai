import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "homeai-agent-"));
  const dbPath = join(dir, "test.db");
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

async function makeUser(id: string) {
  const { db, tables } = await import("@/db/client");
  await db.insert(tables.user).values({
    id,
    name: "Test",
    email: `${id}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe("agent/threads (db)", () => {
  it("relit un tour complet à l'identique, parts d'outil incluses", async () => {
    const { createThread, loadMessages, saveMessages } = await import("./threads");
    await makeUser("u-roundtrip");
    const threadId = await createThread("u-roundtrip", "Test");

    const messages: UIMessage[] = [
      { id: "m1", role: "user", parts: [{ type: "text", text: "liste mes runs" }] },
      {
        id: "m2",
        role: "assistant",
        parts: [
          { type: "reasoning", text: "il faut appeler l'outil" },
          { type: "text", text: "Je regarde." },
          {
            type: "tool-list_script_runs",
            toolCallId: "call-1",
            state: "output-available",
            input: { scriptId: "s1" },
            // Une sortie qui contient la chaîne "error" : c'est une réussite.
            output: JSON.stringify([{ status: "success", error: null }]),
          },
        ],
      } as unknown as UIMessage,
    ];

    await saveMessages(threadId, messages);
    const reloaded = await loadMessages(threadId);

    expect(reloaded).toHaveLength(2);
    expect(reloaded[0]).toEqual(messages[0]);
    expect(reloaded[1]).toEqual(messages[1]);
  });

  it("réécrire le même tour ne duplique pas les messages", async () => {
    const { createThread, loadMessages, saveMessages } = await import("./threads");
    await makeUser("u-idempotent");
    const threadId = await createThread("u-idempotent", "Test");

    const messages: UIMessage[] = [
      { id: "d1", role: "user", parts: [{ type: "text", text: "salut" }] },
      { id: "d2", role: "assistant", parts: [{ type: "text", text: "bonjour" }] },
    ];

    await saveMessages(threadId, messages);
    await saveMessages(threadId, [
      ...messages,
      { id: "d3", role: "assistant", parts: [{ type: "text", text: "et ensuite" }] },
    ]);

    const reloaded = await loadMessages(threadId);
    expect(reloaded.map((m) => m.id)).toEqual(["d1", "d2", "d3"]);
  });

  it("conserve l'ordre d'envoi, pas l'ordre d'horloge", async () => {
    const { appendMessage, createThread, loadMessages } = await import("./threads");
    await makeUser("u-order");
    const threadId = await createThread("u-order", "Test");

    for (const text of ["un", "deux", "trois"]) {
      await appendMessage(threadId, { role: "assistant", parts: [{ type: "text", text }] });
    }

    const { messageText } = await import("./threads");
    expect((await loadMessages(threadId)).map(messageText)).toEqual(["un", "deux", "trois"]);
  });

  it("crée le fil sous l'id fourni par le client, une seule fois", async () => {
    const { ensureThread } = await import("./threads");
    await makeUser("u-ensure");
    const id = "client-chosen-id";

    const first = await ensureThread("u-ensure", id, "Premier message");
    expect(first.created).toBe(true);
    expect(first.thread.id).toBe(id);

    const second = await ensureThread("u-ensure", id, "Autre titre");
    expect(second.created).toBe(false);
    expect(second.thread.title).toBe("Premier message");
  });

  it("refuse de réutiliser l'id d'un fil d'un autre utilisateur", async () => {
    const { ensureThread } = await import("./threads");
    await makeUser("u-owner");
    await makeUser("u-intruder");
    await ensureThread("u-owner", "shared-id", "Privé");

    await expect(ensureThread("u-intruder", "shared-id", "Vol")).rejects.toThrow();
  });

  it("ne rend pas le fil d'un autre utilisateur", async () => {
    const { createThread, getThread } = await import("./threads");
    await makeUser("u-a");
    await makeUser("u-b");
    const threadId = await createThread("u-a", "Privé");

    expect(await getThread("u-a", threadId)).not.toBeNull();
    expect(await getThread("u-b", threadId)).toBeNull();
  });
});
