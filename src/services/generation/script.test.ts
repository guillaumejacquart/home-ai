import { afterEach, describe, expect, it, vi } from "vitest";

import { chatCompletion, chatCompletionStream } from "@/services/llm/llm";
import { codeScript, codeScriptStream, planScript, planScriptStream } from "@/services/generation/script";
import { truncateCode } from "@/services/generation/shared";

vi.mock("@/services/llm/llm", () => ({
  chatCompletion: vi.fn(),
  chatCompletionDetailed: vi.fn(),
  chatCompletionStream: vi.fn(),
  defaultModels: { planner: "planner-test", coder: "coder-test" },
  LlmError: class LlmError extends Error {},
}));

const mockedCompletion = vi.mocked(chatCompletion);
const mockedStream = vi.mocked(chatCompletionStream);

afterEach(() => {
  mockedCompletion.mockReset();
  mockedStream.mockReset();
});

describe("generation.script.planScript", () => {
  it("calls the planner and returns the plan", async () => {
    mockedCompletion.mockResolvedValueOnce('{"summary":"Summary"}');
    const r = await planScript("Summarise my mail every Monday");
    expect(r.plan).toBe('{"summary":"Summary"}');
    expect(r.model).toBe("planner-test");
    expect(mockedCompletion).toHaveBeenCalledTimes(1);
    expect(mockedCompletion.mock.calls[0][0][0].role).toBe("system");
  });

  it("detects iteration when a current script is provided", async () => {
    mockedCompletion.mockResolvedValueOnce("plan");
    await planScript("Change the schedule", {
      current: { name: "N", schedule: "0 8 * * *", code: "async function main(home){}" },
    });
    const system = mockedCompletion.mock.calls[0][0][0].content as string;
    expect(system).toContain("fix a script already in use");
  });
});

describe("generation.script.planScriptStream", () => {
  it("pushes the plan through the stream", async () => {
    mockedStream.mockResolvedValueOnce({ text: "streamed plan", finishReason: "stop" });
    const r = await planScriptStream("request", { onToken: vi.fn() });
    expect(r.plan).toBe("streamed plan");
  });
});

describe("generation.script.codeScript", () => {
  it("parses the coder's JSON (name, schedule, code)", async () => {
    const text = '{"name":"Weekly summary","schedule":"0 8 * * 1","code":"async function main(home){}"}';
    mockedStream.mockResolvedValueOnce({ text, finishReason: "stop" });
    const r = await codeScript("request", "validated plan");
    expect(r.name).toBe("Weekly summary");
    expect(r.schedule).toBe("0 8 * * 1");
    expect(r.code).toBe("async function main(home){}");
    expect(r.coderModel).toBe("coder-test");
    // The validated plan does reach the coder.
    const userContent = mockedStream.mock.calls[0][0][1].content as string;
    expect(userContent).toContain("validated plan");
  });

  it("falls back to the current script's values when the JSON is unreadable", async () => {
    mockedStream.mockResolvedValueOnce({ text: "response without JSON", finishReason: "stop" });
    const current = { name: "Previous", schedule: "0 9 * * *", code: "old code" };
    const r = await codeScript("request", "plan", { current });
    expect(r.name).toBe("Previous");
    expect(r.schedule).toBe("0 9 * * *");
    expect(r.code).toBe("old code");
  });

  it("keeps the defaults when nothing is usable", async () => {
    mockedStream.mockResolvedValueOnce({ text: "nothing", finishReason: "stop" });
    const r = await codeScript("request", "plan");
    expect(r.name).toBe("Script");
    expect(r.schedule).toBe("0 8 * * *");
  });
});

describe("generation.script.codeScriptStream", () => {
  it("streamed: parses the coder's JSON", async () => {
    const text = '{"name":"N","schedule":"0 * * * *","code":"code"}';
    mockedStream.mockResolvedValueOnce({ text, finishReason: "stop" });
    const r = await codeScriptStream("request", "plan");
    expect(r.name).toBe("N");
    expect(r.schedule).toBe("0 * * * *");
  });
});

describe("generation.script.truncateCode", () => {
  it("truncates past the limit while keeping the start", () => {
    const code = "a".repeat(100);
    const t = truncateCode(code, 50);
    expect(t.length).toBeLessThan(code.length);
    expect(t).toContain("code truncated");
  });
  it("leaves short code intact", () => {
    expect(truncateCode("short", 50)).toBe("short");
  });
});
