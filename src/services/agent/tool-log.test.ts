import { describe, expect, it } from "vitest";
import { z } from "zod";

import { describeToolFailure, detectTextualToolCall, isAbort } from "./tool-log";

const base = { durationMs: 12, userId: "u1", threadId: "t1", toolCallId: "call-1" };

describe("agent/tool-log", () => {
  it("classifies a bad LLM call as invalid-args, with the offending paths", () => {
    const schema = z.object({ method: z.string(), args: z.array(z.unknown()).optional() });
    let err: unknown;
    try {
      schema.parse({ args: "not an array" });
    } catch (e) {
      err = e;
    }

    const failure = describeToolFailure({
      tool: "call_connection_method",
      err,
      args: { args: "not an array" },
      ...base,
    });

    expect(failure.kind).toBe("invalid-args");
    expect(failure.issues).toEqual(expect.arrayContaining([expect.stringContaining("method")]));
    expect(failure.tool).toBe("call_connection_method");
    expect(failure.threadId).toBe("t1");
  });

  it("classifies a service failure as execution", () => {
    const failure = describeToolFailure({
      tool: "call_connection_method",
      err: new Error("Invalid Value: query"),
      args: { method: "google.drive.list", args: [{ orderBy: "modifiedTime desc" }] },
      ...base,
    });

    expect(failure.kind).toBe("execution");
    expect(failure.message).toBe("Invalid Value: query");
    expect(failure.issues).toBeUndefined();
    // The offending arguments are kept: that's what makes the log actionable.
    expect(failure.args).toContain("google.drive.list");
  });

  it("caps large arguments", () => {
    const failure = describeToolFailure({
      tool: "generate_app",
      err: new Error("boom"),
      args: { prompt: "x".repeat(5000) },
      ...base,
    });
    expect(failure.args!.length).toBeLessThan(600);
    expect(failure.args).toContain("…");
  });

  it("does not treat a user abort as a failure", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(isAbort(abort)).toBe(true);
    expect(isAbort(new Error("boom"))).toBe(false);
  });
});

describe("agent/tool-log — tool calls written as text", () => {
  const tools = ["generate_app", "plan_app", "get_app_html"];

  it("detects the GLM template seen in production", () => {
    const answer = [
      "<tool_call>",
      "<function generate_app() {",
      "return {",
      '  appId: "c601b79d-0359-4da9-9219-555aed7e954d",',
      '  prompt: "Fix the app\'s display"',
      "};",
      "}",
    ].join("\n");

    const detected = detectTextualToolCall(answer, tools);
    expect(detected).not.toBeNull();
    expect(detected!.mentionedTools).toContain("generate_app");
  });

  it("detects other common templates", () => {
    for (const sample of [
      "<|tool_calls_begin|>generate_app",
      '<invoke name="generate_app">',
      "<function=generate_app>",
    ]) {
      expect(detectTextualToolCall(sample, tools), sample).not.toBeNull();
    }
  });

  it("does not trigger when the assistant talks about its tools in prose", () => {
    expect(
      detectTextualToolCall(
        "I'll use generate_app to regenerate the app, then plan_app if needed.",
        tools,
      ),
    ).toBeNull();
    expect(detectTextualToolCall("Here's some code: function app() { return {} }", tools)).toBeNull();
    expect(detectTextualToolCall("", tools)).toBeNull();
  });
});
