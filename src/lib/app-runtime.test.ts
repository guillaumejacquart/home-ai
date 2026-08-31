import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/llm/llm", () => ({
  LlmError: class LlmError extends Error {},
  sanitizeChatMessages: vi.fn((raw: unknown) => raw as never),
  chatCompletion: vi.fn(async () => "réponse IA"),
  chatCompletionStream: vi.fn(async () => ({ text: "réponse IA", finishReason: "stop" })),
}));

vi.mock("@/services/llm/settings", () => ({
  getEffectiveDefaults: vi.fn(async () => ({
    provider: "opencode-go",
    plannerModel: "planner-x",
    coderModel: "coder-y",
  })),
}));

vi.mock("@/services/connections/connections", () => ({
  ConnectionError: class ConnectionError extends Error {},
  getConnectionConfigByType: vi.fn(async () => ({
    type: "google",
    data: { accessToken: "tok-google" },
  })),
}));

vi.mock("@/services/connections/google", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown> & {
    googleProvider?: { sdk: { methods: Record<string, unknown> } };
  };
  const mockedSheets = vi.fn(async () => ({ id: "spread-1", name: "toto", sheet: "Sheet1" }));
  const mockedDrive = vi.fn(async () => []);
  const actualProvider = actual.googleProvider as
    | { sdk: { methods: Record<string, unknown> } }
    | undefined;
  return {
    ...(actual as object),
    sheetsCreate: mockedSheets,
    driveList: mockedDrive,
    googleProvider: actualProvider
      ? {
          ...actualProvider,
          sdk: {
            ...(actualProvider.sdk as object),
            methods: {
              ...(actualProvider.sdk.methods as object),
              "sheets.create": mockedSheets,
              "drive.list": mockedDrive,
            },
          },
        }
      : undefined,
  };
});

const scriptsService = {
  listOwnedScripts: vi.fn(async () => [{ id: "s1", name: "Arrosage", triggerKind: "manual" }]),
  findOwnedScript: vi.fn(async (ownerId: string, needle: string) =>
    ownerId === "o1" && (needle === "s1" || needle === "Arrosage")
      ? { id: "s1", ownerId: "o1", name: "Arrosage" }
      : undefined,
  ),
  getScript: vi.fn(async () => ({ id: "s1", ownerId: "o1" })),
};

const scriptsRunner = {
  startScriptRun: vi.fn(async () => ({ runId: "r1", done: Promise.resolve({ status: "success" }) })),
  getScriptRun: vi.fn(async () => ({
    id: "r1",
    scriptId: "s1",
    status: "success",
    output: "ok",
    error: null,
    startedAt: new Date(0),
    finishedAt: new Date(1000),
    durationMs: 1000,
  })),
  lastScriptRun: vi.fn(async () => undefined),
};

vi.mock("@/services/scripts/scripts", () => scriptsService);
vi.mock("@/services/scripts/runner", () => scriptsRunner);

import { bridgeRpc } from "@/lib/app-runtime";
import { chatCompletionStream } from "@/services/llm/llm";
import { sheetsCreate, driveList } from "@/services/connections/google";

const mockedChat = vi.mocked(chatCompletionStream);
const mockedSheetsCreate = vi.mocked(sheetsCreate);
const mockedDriveList = vi.mocked(driveList);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("bridgeRpc ai", () => {
  it("ai.chat envoie system + user avec le modèle build et les options", async () => {
    const value = await bridgeRpc.handle(
      "ai.chat",
      ["Résume ça", { system: "Sois bref", temperature: 0.7, maxTokens: 500 }],
      { appId: "a1", ownerId: "o1" },
    );

    expect(value).toBe("réponse IA");
    expect(mockedChat).toHaveBeenCalledWith(
      [
        { role: "system", content: "Sois bref" },
        { role: "user", content: "Résume ça" },
      ],
      expect.objectContaining({
        provider: "opencode-go",
        model: "coder-y",
        temperature: 0.7,
        maxTokens: 500,
        userId: "o1",
        appId: "a1",
        feature: "ai_sdk_app",
      }),
    );
  });

  it("ai.chat sans options envoie un seul message user avec les défauts", async () => {
    await bridgeRpc.handle("ai.chat", ["Bonjour"], { appId: "a1", ownerId: "o1" });

    expect(mockedChat).toHaveBeenCalledWith(
      [{ role: "user", content: "Bonjour" }],
      expect.objectContaining({
        provider: "opencode-go",
        model: "coder-y",
        temperature: undefined,
        maxTokens: undefined,
        userId: "o1",
        appId: "a1",
      }),
    );
  });

  it("ai.chat rejette un prompt vide", async () => {
    await expect(
      bridgeRpc.handle("ai.chat", ["   "], { appId: "a1", ownerId: "o1" }),
    ).rejects.toThrow("Prompt IA vide.");
    expect(mockedChat).not.toHaveBeenCalled();
  });

  it("ai.messages transmet les messages et les options", async () => {
    const messages = [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ];
    const value = await bridgeRpc.handle(
      "ai.messages",
      [messages, { maxTokens: 100 }],
      { appId: "a1", ownerId: "o1" },
    );

    expect(value).toBe("réponse IA");
    expect(mockedChat).toHaveBeenCalledWith(messages, expect.objectContaining({
      provider: "opencode-go",
      model: "coder-y",
      temperature: undefined,
      maxTokens: 100,
      userId: "o1",
      appId: "a1",
    }));
  });

  it("méthode SDK inconnue rejetée", async () => {
    await expect(
      bridgeRpc.handle("ai.foo", [], { appId: "a1", ownerId: "o1" }),
    ).rejects.toThrow("Méthode SDK inconnue");
  });
});

describe("bridgeRpc google", () => {
  it("google.sheets.create crée un spreadsheet avec la connexion Google", async () => {
    const value = await bridgeRpc.handle(
      "google.sheets.create",
      [{ title: "toto", values: [["ID", "Name"]] }],
      { appId: "a1", ownerId: "o1" },
    );

    expect(value).toEqual({ id: "spread-1", name: "toto", sheet: "Sheet1" });
    expect(mockedSheetsCreate).toHaveBeenCalledWith(
      { accessToken: "tok-google" },
      { title: "toto", values: [["ID", "Name"]] },
    );
  });

  it("google.drive.list normalise { query } en chaîne (forme générée par le LLM)", async () => {
    await bridgeRpc.handle(
      "google.drive.list",
      [{ query: "name='toto' and 'root' in parents" }],
      { appId: "a1", ownerId: "o1" },
    );

    expect(mockedDriveList).toHaveBeenCalledWith(
      { accessToken: "tok-google" },
      { query: "name='toto' and 'root' in parents" },
    );
  });
});

describe("bridgeRpc scripts", () => {
  it("scripts.run lance le script du propriétaire sans attendre la fin", async () => {
    const value = await bridgeRpc.handle("scripts.run", ["Arrosage", { from: "app" }], {
      appId: "a1",
      ownerId: "o1",
    });

    expect(value).toEqual({ runId: "r1", status: "running" });
    expect(scriptsRunner.startScriptRun).toHaveBeenCalledWith("s1", {
      payload: { from: "app" },
    });
  });

  it("scripts.run refuse un script qui n'appartient pas au propriétaire de l'app", async () => {
    await expect(
      bridgeRpc.handle("scripts.run", ["s1"], { appId: "a1", ownerId: "autre" }),
    ).rejects.toThrow("Script introuvable");
    expect(scriptsRunner.startScriptRun).not.toHaveBeenCalled();
  });

  it("scripts.runStatus renvoie le run avec des dates sérialisables", async () => {
    const value = await bridgeRpc.handle("scripts.runStatus", ["r1"], {
      appId: "a1",
      ownerId: "o1",
    });

    expect(value).toEqual({
      runId: "r1",
      status: "success",
      output: "ok",
      error: null,
      startedAt: 0,
      finishedAt: 1000,
      durationMs: 1000,
    });
  });

  it("scripts.lastRun renvoie null si le script n'a jamais tourné", async () => {
    expect(
      await bridgeRpc.handle("scripts.lastRun", ["Arrosage"], { appId: "a1", ownerId: "o1" }),
    ).toBeNull();
  });

  it("rejette une méthode scripts inconnue", async () => {
    await expect(
      bridgeRpc.handle("scripts.nope", ["Arrosage"], { appId: "a1", ownerId: "o1" }),
    ).rejects.toThrow("Méthode SDK inconnue");
  });
});
