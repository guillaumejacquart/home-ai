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
  it("appelle le planificateur et renvoie le plan", async () => {
    mockedCompletion.mockResolvedValueOnce('{"summary":"Résumé"}');
    const r = await planScript("Résume mes mails chaque lundi");
    expect(r.plan).toBe('{"summary":"Résumé"}');
    expect(r.model).toBe("planner-test");
    expect(mockedCompletion).toHaveBeenCalledTimes(1);
    expect(mockedCompletion.mock.calls[0][0][0].role).toBe("system");
  });

  it("détecte l'itération quand un script courant est fourni", async () => {
    mockedCompletion.mockResolvedValueOnce("plan");
    await planScript("Change le schedule", {
      current: { name: "N", schedule: "0 8 * * *", code: "async function main(home){}" },
    });
    const system = mockedCompletion.mock.calls[0][0][0].content as string;
    expect(system).toContain("corriger un script déjà en service");
  });
});

describe("generation.script.planScriptStream", () => {
  it("pousse le plan par le stream", async () => {
    mockedStream.mockResolvedValueOnce({ text: "plan streamé", finishReason: "stop" });
    const r = await planScriptStream("demande", { onToken: vi.fn() });
    expect(r.plan).toBe("plan streamé");
  });
});

describe("generation.script.codeScript", () => {
  it("parse le JSON du coder (nom, schedule, code)", async () => {
    const text = '{"name":"Résumé hebdo","schedule":"0 8 * * 1","code":"async function main(home){}"}';
    mockedStream.mockResolvedValueOnce({ text, finishReason: "stop" });
    const r = await codeScript("demande", "plan validé");
    expect(r.name).toBe("Résumé hebdo");
    expect(r.schedule).toBe("0 8 * * 1");
    expect(r.code).toBe("async function main(home){}");
    expect(r.coderModel).toBe("coder-test");
    // Le plan validé est bien transmis au coder.
    const userContent = mockedStream.mock.calls[0][0][1].content as string;
    expect(userContent).toContain("plan validé");
  });

  it("retombe sur les valeurs du script courant si le JSON est illisible", async () => {
    mockedStream.mockResolvedValueOnce({ text: "réponse sans JSON", finishReason: "stop" });
    const current = { name: "Ancien", schedule: "0 9 * * *", code: "old code" };
    const r = await codeScript("demande", "plan", { current });
    expect(r.name).toBe("Ancien");
    expect(r.schedule).toBe("0 9 * * *");
    expect(r.code).toBe("old code");
  });

  it("garde les valeurs par défaut si rien n'est exploitable", async () => {
    mockedStream.mockResolvedValueOnce({ text: "rien", finishReason: "stop" });
    const r = await codeScript("demande", "plan");
    expect(r.name).toBe("Script");
    expect(r.schedule).toBe("0 8 * * *");
  });
});

describe("generation.script.codeScriptStream", () => {
  it("streamé : parse le JSON du coder", async () => {
    const text = '{"name":"N","schedule":"0 * * * *","code":"code"}';
    mockedStream.mockResolvedValueOnce({ text, finishReason: "stop" });
    const r = await codeScriptStream("demande", "plan");
    expect(r.name).toBe("N");
    expect(r.schedule).toBe("0 * * * *");
  });
});

describe("generation.script.truncateCode", () => {
  it("tronque au-delà de la limite en gardant le début", () => {
    const code = "a".repeat(100);
    const t = truncateCode(code, 50);
    expect(t.length).toBeLessThan(code.length);
    expect(t).toContain("code tronqué");
  });
  it("laisse intact un code court", () => {
    expect(truncateCode("short", 50)).toBe("short");
  });
});