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
  '<html><head><title>Ma liste</title></head><body><div x-data="app()">ok</div>' +
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
  appId = (await createApp(ownerId, { name: "Liste" })).id;
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

const input = { name: "Liste", description: "Une liste", slug: "liste" };

describe("app generation — mode création", () => {
  it("planApp utilise le planificateur de création sans HTML existant", async () => {
    mockedChatCompletion.mockResolvedValue('{"summary":"Une liste","sections":[],"data":[],"notes":[]}');
    const { planApp } = await import("@/services/generation/app");
    await planApp(appId, input, "Crée une liste");
    const [messages] = mockedChatCompletion.mock.calls[0];
    const system = messages[0].content;
    const user = messages[1].content;
    expect(system).toContain("Tu es un chef de projet technique");
    expect(user).toContain("Crée une liste");
    expect(user).not.toContain("Historique des échanges");
  });

  it("codeApp demande une app entière quand aucun HTML courant n'existe", async () => {
    mockedDetailed.mockResolvedValue({ text: FULL_HTML, finishReason: "stop" });
    const { codeApp } = await import("@/services/generation/app");
    const result = await codeApp(appId, input, "Crée une liste", "plan", {});
    const [messages] = mockedDetailed.mock.calls[0];
    expect(messages[0].content).not.toContain("PATCH CIBLÉ");
    expect(messages[1].content).toContain("C'est une nouvelle app");
    expect(result.html).toBe(FULL_HTML);
  });
});

describe("app generation — mode itération", () => {
  // Chaque test repart du même HTML : codeApp crée une version, sinon le test
  // suivant ne retrouverait plus le texte qu'il cherche.
  beforeEach(async () => {
    mockedDetailed.mockReset();
    mockedChatCompletion.mockReset();
    const { createVersion } = await import("@/services/apps/versions");
    await createVersion(appId, { html: FULL_HTML, prompt: "état initial" });
  });

  it("planApp bascule en mode modification et injecte historique + clés de stockage", async () => {
    const { addGenerationMessage } = await import("@/services/messages/chat");
    await addGenerationMessage({ ownerId, appId, role: "user", content: "Crée une liste" });
    await addGenerationMessage({ ownerId, appId, role: "plan", content: '{"summary":"Liste"}' });
    const { createVersion } = await import("@/services/apps/versions");
    await createVersion(appId, { html: FULL_HTML, prompt: "Crée une liste" });

    mockedChatCompletion.mockResolvedValue('{"summary":"Corrige","changes":[],"keep":[],"risks":[]}');
    const { planApp } = await import("@/services/generation/app");
    await planApp(appId, input, "Corrige le bouton", {});
    const [messages] = mockedChatCompletion.mock.calls[0];
    const system = messages[0].content;
    const user = messages[1].content;
    expect(system).toContain("Tu modifies une app web familiale existante");
    expect(user).toContain("todos, settings");
    expect(user).toContain("Historique des échanges précédents");
    expect(user).toContain("Crée une liste");
  });

  it("codeApp demande des blocs d'édition et reçoit le HTML courant en entier", async () => {
    mockedDetailed.mockResolvedValue({ text: FULL_HTML, finishReason: "stop" });
    const { codeApp } = await import("@/services/generation/app");
    const result = await codeApp(appId, input, "Corrige le bouton", "plan", {});
    const [messages] = mockedDetailed.mock.calls[0];
    const system = messages[0].content;
    const user = messages[1].content;
    expect(system).toContain("BLOCS D'ÉDITION");
    expect(system).toContain("<<<<<<< SEARCH");
    expect(user).toContain("Voici le code actuel de l'app");
    // Le fichier entier, plus de troncature à 10k qui cachait le milieu.
    expect(user).toContain(FULL_HTML);
    expect(user).toContain("Historique des échanges précédents");
    expect(user).toContain("Crée une liste");
    // Réponse sans bloc : repli sur la réécriture complète, résultat exploitable.
    expect(result.html).toBe(FULL_HTML);
  });

  /**
   * Sans rattrapage, un SEARCH mal cité coûtait une réécriture complète de tout
   * le fichier. On renvoie plutôt au coder sa sortie et la raison de l'échec.
   */
  it("renvoie l'erreur au coder et applique sa correction", async () => {
    const bad = [
      "<<<<<<< SEARCH",
      "<title>Titre qui n'existe pas</title>",
      "=======",
      "<title>Mes tâches</title>",
      ">>>>>>> REPLACE",
    ].join("\n");
    const good = [
      "<<<<<<< SEARCH",
      "<title>Ma liste</title>",
      "=======",
      "<title>Mes tâches</title>",
      ">>>>>>> REPLACE",
    ].join("\n");
    mockedDetailed
      .mockResolvedValueOnce({ text: bad, finishReason: "stop" })
      .mockResolvedValueOnce({ text: good, finishReason: "stop" });

    const { codeApp } = await import("@/services/generation/app");
    const result = await codeApp(appId, input, "Renomme le titre", "plan", {});

    expect(result.html).toContain("<title>Mes tâches</title>");
    // Deux appels seulement : la correction, pas la réécriture du fichier.
    expect(mockedDetailed).toHaveBeenCalledTimes(2);

    const [retryMessages] = mockedDetailed.mock.calls[1];
    const roles = retryMessages.map((m: { role: string }) => m.role);
    expect(roles).toEqual(["system", "user", "assistant", "user"]);
    // La sortie fautive est renvoyée au modèle, avec la raison précise.
    expect(retryMessages[2].content).toContain("Titre qui n'existe pas");
    expect(retryMessages[3].content).toContain("introuvable");
    expect(retryMessages[3].content).toContain("UNE SEULE FOIS");
  });

  it("retombe sur la réécriture complète après les rattrapages", async () => {
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
    const result = await codeApp(appId, input, "Renomme le titre", "plan", {});

    // 3 tentatives de blocs, puis la réécriture.
    expect(mockedDetailed).toHaveBeenCalledTimes(4);
    expect(result.html).toBe(FULL_HTML);
    // La réécriture réclame bien un fichier entier, pas des blocs.
    const [rewriteMessages] = mockedDetailed.mock.calls[3];
    expect(rewriteMessages[0].content).not.toContain("BLOCS D'ÉDITION");
  });

  it("n'applique pas des blocs issus d'une réponse coupée", async () => {
    const partial = [
      "<<<<<<< SEARCH",
      "<title>Ma liste</title>",
      "=======",
      "<title>Mes tâches</title>",
      ">>>>>>> REPLACE",
    ].join("\n");
    // finishReason=length : d'autres blocs ont pu être perdus.
    mockedDetailed
      .mockResolvedValueOnce({ text: partial, finishReason: "length" })
      .mockResolvedValueOnce({ text: partial, finishReason: "stop" });

    const { codeApp } = await import("@/services/generation/app");
    const result = await codeApp(appId, input, "Renomme le titre", "plan", {});

    expect(mockedDetailed.mock.calls.length).toBeGreaterThan(1);
    expect(result.html).toContain("<title>Mes tâches</title>");
  });

  it("codeApp applique les blocs d'édition sans réécrire le fichier", async () => {
    const edit = [
      "<<<<<<< SEARCH",
      "<title>Ma liste</title>",
      "=======",
      "<title>Mes tâches</title>",
      ">>>>>>> REPLACE",
    ].join("\n");
    mockedDetailed.mockResolvedValue({ text: edit, finishReason: "stop" });
    const { codeApp } = await import("@/services/generation/app");
    const result = await codeApp(appId, input, "Renomme le titre", "plan", {});

    expect(result.html).toContain("<title>Mes tâches</title>");
    expect(result.html).not.toContain("<title>Ma liste</title>");
    // Le reste du fichier est intact : un seul appel au modèle, pas de repli.
    expect(result.html).toContain("function app()");
    expect(mockedDetailed).toHaveBeenCalledTimes(1);
  });
});