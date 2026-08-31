import { describe, expect, it } from "vitest";
import { z } from "zod";

import { describeToolFailure, detectTextualToolCall, isAbort } from "./tool-log";

const base = { durationMs: 12, userId: "u1", threadId: "t1", toolCallId: "call-1" };

describe("agent/tool-log", () => {
  it("classe un mauvais appel du LLM en invalid-args, avec les chemins fautifs", () => {
    const schema = z.object({ method: z.string(), args: z.array(z.unknown()).optional() });
    let err: unknown;
    try {
      schema.parse({ args: "pas un tableau" });
    } catch (e) {
      err = e;
    }

    const failure = describeToolFailure({
      tool: "call_connection_method",
      err,
      args: { args: "pas un tableau" },
      ...base,
    });

    expect(failure.kind).toBe("invalid-args");
    expect(failure.issues).toEqual(expect.arrayContaining([expect.stringContaining("method")]));
    expect(failure.tool).toBe("call_connection_method");
    expect(failure.threadId).toBe("t1");
  });

  it("classe un échec du service en execution", () => {
    const failure = describeToolFailure({
      tool: "call_connection_method",
      err: new Error("Invalid Value: query"),
      args: { method: "google.drive.list", args: [{ orderBy: "modifiedTime desc" }] },
      ...base,
    });

    expect(failure.kind).toBe("execution");
    expect(failure.message).toBe("Invalid Value: query");
    expect(failure.issues).toBeUndefined();
    // Les arguments fautifs sont conservés : c'est ce qui rend le log actionnable.
    expect(failure.args).toContain("google.drive.list");
  });

  it("borne les arguments volumineux", () => {
    const failure = describeToolFailure({
      tool: "generate_app",
      err: new Error("boom"),
      args: { prompt: "x".repeat(5000) },
      ...base,
    });
    expect(failure.args!.length).toBeLessThan(600);
    expect(failure.args).toContain("…");
  });

  it("ne traite pas un abort utilisateur comme un échec", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(isAbort(abort)).toBe(true);
    expect(isAbort(new Error("boom"))).toBe(false);
  });
});

describe("agent/tool-log — appels d'outil écrits en texte", () => {
  const tools = ["generate_app", "plan_app", "get_app_html"];

  it("détecte le gabarit GLM observé en production", () => {
    const answer = [
      "<tool_call>",
      "<function generate_app() {",
      "return {",
      '  appId: "c601b79d-0359-4da9-9219-555aed7e954d",',
      '  prompt: "Modifie l\'app pour corriger l\'affichage"',
      "};",
      "}",
    ].join("\n");

    const detected = detectTextualToolCall(answer, tools);
    expect(detected).not.toBeNull();
    expect(detected!.mentionedTools).toContain("generate_app");
  });

  it("détecte les autres gabarits courants", () => {
    for (const sample of [
      "<|tool_calls_begin|>generate_app",
      '<invoke name="generate_app">',
      "<function=generate_app>",
    ]) {
      expect(detectTextualToolCall(sample, tools), sample).not.toBeNull();
    }
  });

  it("ne se déclenche pas quand l'assistant parle de ses outils en prose", () => {
    expect(
      detectTextualToolCall(
        "Je vais utiliser generate_app pour régénérer l'app, puis plan_app si besoin.",
        tools,
      ),
    ).toBeNull();
    expect(detectTextualToolCall("Voici du code : function app() { return {} }", tools)).toBeNull();
    expect(detectTextualToolCall("", tools)).toBeNull();
  });
});
