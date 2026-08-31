import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/llm/llm", () => ({
  LlmError: class LlmError extends Error {},
  sanitizeChatMessages: vi.fn((raw: unknown) => raw as never),
  chatCompletion: vi.fn(async () => "AI response"),
  chatCompletionStream: vi.fn(async () => ({ text: "AI response", finishReason: "stop" })),
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
  const mockedSheets = vi.fn(async () => ({ id: "spread-1", name: "foo", sheet: "Sheet1" }));
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
  listOwnedScripts: vi.fn(async () => [{ id: "s1", name: "Watering", triggerKind: "manual" }]),
  findOwnedScript: vi.fn(async (ownerId: string, needle: string) =>
    ownerId === "o1" && (needle === "s1" || needle === "Watering")
      ? { id: "s1", ownerId: "o1", name: "Watering" }
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
  it("ai.chat sends system + user with the build model and options", async () => {
    const value = await bridgeRpc.handle(
      "ai.chat",
      ["Summarize this", { system: "Be brief", temperature: 0.7, maxTokens: 500 }],
      { appId: "a1", ownerId: "o1" },
    );

    expect(value).toBe("AI response");
    expect(mockedChat).toHaveBeenCalledWith(
      [
        { role: "system", content: "Be brief" },
        { role: "user", content: "Summarize this" },
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

  it("ai.chat without options sends a single user message with the defaults", async () => {
    await bridgeRpc.handle("ai.chat", ["Hello"], { appId: "a1", ownerId: "o1" });

    expect(mockedChat).toHaveBeenCalledWith(
      [{ role: "user", content: "Hello" }],
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

  it("ai.chat rejects an empty prompt", async () => {
    await expect(
      bridgeRpc.handle("ai.chat", ["   "], { appId: "a1", ownerId: "o1" }),
    ).rejects.toThrow("Empty AI prompt.");
    expect(mockedChat).not.toHaveBeenCalled();
  });

  it("ai.messages forwards the messages and options", async () => {
    const messages = [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ];
    const value = await bridgeRpc.handle(
      "ai.messages",
      [messages, { maxTokens: 100 }],
      { appId: "a1", ownerId: "o1" },
    );

    expect(value).toBe("AI response");
    expect(mockedChat).toHaveBeenCalledWith(messages, expect.objectContaining({
      provider: "opencode-go",
      model: "coder-y",
      temperature: undefined,
      maxTokens: 100,
      userId: "o1",
      appId: "a1",
    }));
  });

  it("unknown SDK method is rejected", async () => {
    await expect(
      bridgeRpc.handle("ai.foo", [], { appId: "a1", ownerId: "o1" }),
    ).rejects.toThrow("Unknown SDK method");
  });
});

describe("bridgeRpc google", () => {
  it("google.sheets.create creates a spreadsheet with the Google connection", async () => {
    const value = await bridgeRpc.handle(
      "google.sheets.create",
      [{ title: "foo", values: [["ID", "Name"]] }],
      { appId: "a1", ownerId: "o1" },
    );

    expect(value).toEqual({ id: "spread-1", name: "foo", sheet: "Sheet1" });
    expect(mockedSheetsCreate).toHaveBeenCalledWith(
      { accessToken: "tok-google" },
      { title: "foo", values: [["ID", "Name"]] },
    );
  });

  it("google.drive.list normalizes { query } to a string (form generated by the LLM)", async () => {
    await bridgeRpc.handle(
      "google.drive.list",
      [{ query: "name='foo' and 'root' in parents" }],
      { appId: "a1", ownerId: "o1" },
    );

    expect(mockedDriveList).toHaveBeenCalledWith(
      { accessToken: "tok-google" },
      { query: "name='foo' and 'root' in parents" },
    );
  });
});

describe("bridgeRpc scripts", () => {
  it("scripts.run launches the owner's script without waiting for completion", async () => {
    const value = await bridgeRpc.handle("scripts.run", ["Watering", { from: "app" }], {
      appId: "a1",
      ownerId: "o1",
    });

    expect(value).toEqual({ runId: "r1", status: "running" });
    expect(scriptsRunner.startScriptRun).toHaveBeenCalledWith("s1", {
      payload: { from: "app" },
    });
  });

  it("scripts.run refuses a script that doesn't belong to the app owner", async () => {
    await expect(
      bridgeRpc.handle("scripts.run", ["s1"], { appId: "a1", ownerId: "other" }),
    ).rejects.toThrow("Script not found");
    expect(scriptsRunner.startScriptRun).not.toHaveBeenCalled();
  });

  it("scripts.runStatus returns the run with serializable dates", async () => {
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

  it("scripts.lastRun returns null if the script has never run", async () => {
    expect(
      await bridgeRpc.handle("scripts.lastRun", ["Watering"], { appId: "a1", ownerId: "o1" }),
    ).toBeNull();
  });

  it("rejects an unknown scripts method", async () => {
    await expect(
      bridgeRpc.handle("scripts.nope", ["Watering"], { appId: "a1", ownerId: "o1" }),
    ).rejects.toThrow("Unknown SDK method");
  });
});
