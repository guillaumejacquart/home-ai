import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { chatCompletion, chatCompletionDetailed } from "@/services/llm/llm";

vi.mock("@/services/llm/llm", () => ({
  chatCompletion: vi.fn(),
  chatCompletionDetailed: vi.fn(),
  defaultModels: { planner: "planner-test", coder: "coder-test" },
  LlmError: class LlmError extends Error {},
}));

const mockedChatCompletion = vi.mocked(chatCompletion);
const mockedDetailed = vi.mocked(chatCompletionDetailed);

let dir: string;
let ownerId: string;
let appId: string;

const FULL_HTML =
  '<html><head><title>My list</title></head><body><div x-data="app()">ok</div>' +
  '<!-- storage: todos, settings --><script>function app(){return {}}</script></body></html>';

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "homeai-gen-"));
  process.env.SQLITE_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "test-encryption-key-12345678901234567890";

  const { createRequire } = await import("node:module");
  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const Database = createRequire(import.meta.url)("better-sqlite3");
  const sqlite = new Database(process.env.SQLITE_PATH);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  sqlite.close();

  const { db, tables } = await import("@/db/client");
  ownerId = "user-gen-1";
  await db.insert(tables.user).values({
    id: ownerId,
    name: "Test",
    email: "gen@test.com",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const { createApp } = await import("@/services/apps/apps");
  appId = (await createApp(ownerId, { name: "List" })).id;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.SQLITE_PATH;
  delete process.env.ENCRYPTION_KEY;
});

beforeEach(() => {
  mockedChatCompletion.mockReset();
  mockedDetailed.mockReset();
});

const input = { name: "List", description: "A list", slug: "list" };

describe("app generation — creation mode", () => {
  it("planApp uses the creation planner when no HTML exists", async () => {
    mockedChatCompletion.mockResolvedValue('{"summary":"A list","sections":[],"data":[],"notes":[]}');
    const { planApp } = await import("@/services/generation/app");
    await planApp(appId, input, "Create a list");
    const [messages] = mockedChatCompletion.mock.calls[0];
    const system = messages[0].content;
    const user = messages[1].content;
    expect(system).toContain("You are a technical project manager");
    expect(user).toContain("Create a list");
    expect(user).not.toContain("History of previous exchanges");
  });

  it("codeApp asks for a whole app when there is no current HTML", async () => {
    mockedDetailed.mockResolvedValue({ text: FULL_HTML, finishReason: "stop" });
    const { codeApp } = await import("@/services/generation/app");
    const result = await codeApp(appId, input, "Create a list", "plan", {});
    const [messages] = mockedDetailed.mock.calls[0];
    expect(messages[0].content).not.toContain("TARGETED PATCH");
    expect(messages[1].content).toContain("This is a new app");
    expect(result.html).toBe(FULL_HTML);
  });
});

describe("app generation — iteration mode", () => {
  // Every test restarts from the same HTML: codeApp creates a version, otherwise
  // the next test would no longer find the text it looks for.
  beforeEach(async () => {
    mockedDetailed.mockReset();
    mockedChatCompletion.mockReset();
    const { createVersion } = await import("@/services/apps/versions");
    await createVersion(appId, { html: FULL_HTML, prompt: "initial state" });
  });

  it("planApp switches to modification mode and injects history + storage keys", async () => {
    const { addGenerationMessage } = await import("@/services/messages/chat");
    await addGenerationMessage({ ownerId, appId, role: "user", content: "Create a list" });
    await addGenerationMessage({ ownerId, appId, role: "plan", content: '{"summary":"List"}' });
    const { createVersion } = await import("@/services/apps/versions");
    await createVersion(appId, { html: FULL_HTML, prompt: "Create a list" });

    mockedChatCompletion.mockResolvedValue('{"summary":"Fix","changes":[],"keep":[],"risks":[]}');
    const { planApp } = await import("@/services/generation/app");
    await planApp(appId, input, "Fix the button", {});
    const [messages] = mockedChatCompletion.mock.calls[0];
    const system = messages[0].content;
    const user = messages[1].content;
    expect(system).toContain("You are modifying an existing household web app");
    expect(user).toContain("todos, settings");
    expect(user).toContain("History of previous exchanges");
    expect(user).toContain("Create a list");
  });

  it("codeApp asks for edit blocks and receives the whole current HTML", async () => {
    mockedDetailed.mockResolvedValue({ text: FULL_HTML, finishReason: "stop" });
    const { codeApp } = await import("@/services/generation/app");
    const result = await codeApp(appId, input, "Fix the button", "plan", {});
    const [messages] = mockedDetailed.mock.calls[0];
    const system = messages[0].content;
    const user = messages[1].content;
    expect(system).toContain("EDIT BLOCKS");
    expect(system).toContain("<<<<<<< SEARCH");
    expect(user).toContain("Here is the app's current code");
    // The whole file, no more 10k truncation hiding the middle.
    expect(user).toContain(FULL_HTML);
    expect(user).toContain("History of previous exchanges");
    expect(user).toContain("Create a list");
    // Response without a block: falls back to a full rewrite, usable result.
    expect(result.html).toBe(FULL_HTML);
  });

  /**
   * Without retries, a badly quoted SEARCH cost a full rewrite of the whole
   * file. We hand the coder its output and the reason it failed instead.
   */
  it("hands the error back to the coder and applies its fix", async () => {
    const bad = [
      "<<<<<<< SEARCH",
      "<title>Title that does not exist</title>",
      "=======",
      "<title>My tasks</title>",
      ">>>>>>> REPLACE",
    ].join("\n");
    const good = [
      "<<<<<<< SEARCH",
      "<title>My list</title>",
      "=======",
      "<title>My tasks</title>",
      ">>>>>>> REPLACE",
    ].join("\n");
    mockedDetailed
      .mockResolvedValueOnce({ text: bad, finishReason: "stop" })
      .mockResolvedValueOnce({ text: good, finishReason: "stop" });

    const { codeApp } = await import("@/services/generation/app");
    const result = await codeApp(appId, input, "Rename the title", "plan", {});

    expect(result.html).toContain("<title>My tasks</title>");
    // Only two calls: the fix, not a rewrite of the file.
    expect(mockedDetailed).toHaveBeenCalledTimes(2);

    const [retryMessages] = mockedDetailed.mock.calls[1];
    const roles = retryMessages.map((m: { role: string }) => m.role);
    expect(roles).toEqual(["system", "user", "assistant", "user"]);
    // The faulty output goes back to the model, with the precise reason.
    expect(retryMessages[2].content).toContain("Title that does not exist");
    expect(retryMessages[3].content).toContain("not found");
    expect(retryMessages[3].content).toContain("EXACTLY ONCE");
  });

  it("falls back to a full rewrite once the retries are exhausted", async () => {
    const bad = [
      "<<<<<<< SEARCH",
      "<title>Absent</title>",
      "=======",
      "<title>X</title>",
      ">>>>>>> REPLACE",
    ].join("\n");
    mockedDetailed
      .mockResolvedValueOnce({ text: bad, finishReason: "stop" })
      .mockResolvedValueOnce({ text: bad, finishReason: "stop" })
      .mockResolvedValueOnce({ text: bad, finishReason: "stop" })
      .mockResolvedValueOnce({ text: FULL_HTML, finishReason: "stop" });

    const { codeApp } = await import("@/services/generation/app");
    const result = await codeApp(appId, input, "Rename the title", "plan", {});

    // 3 block attempts, then the rewrite.
    expect(mockedDetailed).toHaveBeenCalledTimes(4);
    expect(result.html).toBe(FULL_HTML);
    // The rewrite does ask for a whole file, not blocks.
    const [rewriteMessages] = mockedDetailed.mock.calls[3];
    expect(rewriteMessages[0].content).not.toContain("EDIT BLOCKS");
  });

  it("does not apply blocks coming from a cut response", async () => {
    const partial = [
      "<<<<<<< SEARCH",
      "<title>My list</title>",
      "=======",
      "<title>My tasks</title>",
      ">>>>>>> REPLACE",
    ].join("\n");
    // finishReason=length: other blocks may have been lost.
    mockedDetailed
      .mockResolvedValueOnce({ text: partial, finishReason: "length" })
      .mockResolvedValueOnce({ text: partial, finishReason: "stop" });

    const { codeApp } = await import("@/services/generation/app");
    const result = await codeApp(appId, input, "Rename the title", "plan", {});

    expect(mockedDetailed.mock.calls.length).toBeGreaterThan(1);
    expect(result.html).toContain("<title>My tasks</title>");
  });

  it("codeApp applies the edit blocks without rewriting the file", async () => {
    const edit = [
      "<<<<<<< SEARCH",
      "<title>My list</title>",
      "=======",
      "<title>My tasks</title>",
      ">>>>>>> REPLACE",
    ].join("\n");
    mockedDetailed.mockResolvedValue({ text: edit, finishReason: "stop" });
    const { codeApp } = await import("@/services/generation/app");
    const result = await codeApp(appId, input, "Rename the title", "plan", {});

    expect(result.html).toContain("<title>My tasks</title>");
    expect(result.html).not.toContain("<title>My list</title>");
    // The rest of the file is intact: a single model call, no fallback.
    expect(result.html).toContain("function app()");
    expect(mockedDetailed).toHaveBeenCalledTimes(1);
  });
});