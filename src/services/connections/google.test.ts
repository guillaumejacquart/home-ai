import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockedFilesList, mockedFilesGet, mockedFilesExport, mockedValuesGet, mockedValuesUpdate } =
  vi.hoisted(() => ({
    mockedFilesList: vi.fn(),
    mockedFilesGet: vi.fn(),
    mockedFilesExport: vi.fn(),
    mockedValuesGet: vi.fn(),
    mockedValuesUpdate: vi.fn(),
  }));

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: vi.fn(function (this: { setCredentials: () => void }) {
        this.setCredentials = () => undefined;
      }),
    },
    drive: vi.fn(() => ({
      files: { list: mockedFilesList, get: mockedFilesGet, export: mockedFilesExport },
    })),
    sheets: vi.fn(() => ({
      spreadsheets: { values: { get: mockedValuesGet, update: mockedValuesUpdate } },
    })),
  },
}));

import { driveList, driveRead, sheetsRead, sheetsUpdate, SHEETS_MIME } from "./google";

const CFG = {
  accessToken: "t",
  refreshToken: "r",
  scope: "https://www.googleapis.com/auth/drive.file",
};

describe("driveList", () => {
  beforeEach(() => {
    mockedFilesList.mockReset();
    mockedFilesList.mockResolvedValue({ data: { files: [] } });
  });

  it("passe une requête en chaîne telle quelle", async () => {
    await driveList(CFG, "name='toto' and 'root' in parents");
    expect(mockedFilesList).toHaveBeenCalledWith(
      expect.objectContaining({ q: "name='toto' and 'root' in parents" }),
    );
  });

  it("normalise { query } en chaîne (forme générée par le LLM)", async () => {
    await driveList(CFG, { query: "name='toto'" });
    expect(mockedFilesList).toHaveBeenCalledWith(expect.objectContaining({ q: "name='toto'" }));
  });

  it("liste sans requête", async () => {
    await driveList(CFG);
    expect(mockedFilesList).toHaveBeenCalledWith(expect.objectContaining({ q: undefined }));
  });

  // « les N derniers fichiers modifiés » était inexprimable : sans orderBy,
  // Drive renvoie un ordre non garanti et le modèle triait 50 lignes au hasard.
  it("transmet orderBy et pageSize", async () => {
    await driveList(CFG, { orderBy: "modifiedTime desc", pageSize: 10 });
    expect(mockedFilesList).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: "modifiedTime desc", pageSize: 10, q: undefined }),
    );
  });

  it("borne pageSize et laisse orderBy vide par défaut", async () => {
    await driveList(CFG, { pageSize: 5000 });
    expect(mockedFilesList).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 200, orderBy: undefined }),
    );

    await driveList(CFG, { pageSize: 0 });
    expect(mockedFilesList).toHaveBeenLastCalledWith(expect.objectContaining({ pageSize: 1 }));
  });
});
/**
 * L'app générée affichait « [object Object] » : googleapis parse le corps d'un
 * fichier JSON en objet malgré `responseType: "text"`. Le contrat est normalisé
 * dans driveRead pour qu'aucune app n'ait à le refaire.
 */
describe("driveRead", () => {
  beforeEach(() => {
    mockedFilesGet.mockReset();
    mockedFilesExport.mockReset();
  });

  function mockFile(mimeType: string, body: unknown) {
    mockedFilesGet
      .mockResolvedValueOnce({ data: { id: "f1", name: "test-drive", mimeType } })
      .mockResolvedValueOnce({ data: body });
  }

  it("sérialise un corps JSON parsé en objet", async () => {
    mockFile("application/json", { todos: [{ text: "acheter du pain" }] });
    const res = await driveRead(CFG, "f1");
    expect(typeof res.content).toBe("string");
    expect(res.content).toContain("acheter du pain");
  });

  it("laisse une chaîne intacte", async () => {
    mockFile("text/plain", "ligne 1\nligne 2");
    expect((await driveRead(CFG, "f1")).content).toBe("ligne 1\nligne 2");
  });

  it("décode un corps binaire en UTF-8", async () => {
    mockFile("text/plain", new TextEncoder().encode("héllo"));
    expect((await driveRead(CFG, "f1")).content).toBe("héllo");
  });

  it("renvoie null quand il n'y a pas de contenu", async () => {
    mockFile("text/plain", null);
    expect((await driveRead(CFG, "f1")).content).toBeNull();
  });

  it("normalise aussi l'export d'un fichier non textuel", async () => {
    mockedFilesGet.mockResolvedValueOnce({
      data: { id: "f1", name: "doc", mimeType: "application/vnd.google-apps.document" },
    });
    mockedFilesExport.mockResolvedValue({ data: { paragraphs: ["a"] } });
    const res = await driveRead(CFG, "f1");
    expect(typeof res.content).toBe("string");
    expect(res.content).toContain("paragraphs");
  });
});

/**
 * Un Google Sheets tombait dans la branche export avec `text/plain`, format que
 * Drive ne propose pas pour les feuilles : l'export levait, le catch avalait, et
 * l'appelant recevait `content: null` sans savoir pourquoi.
 */
describe("driveRead — fichiers Google natifs", () => {
  beforeEach(() => {
    mockedFilesGet.mockReset();
    mockedFilesExport.mockReset();
  });

  function mockNative(mimeType: string) {
    mockedFilesGet.mockResolvedValueOnce({ data: { id: "f1", name: "compta", mimeType } });
  }

  it("exporte une feuille en CSV, pas en text/plain", async () => {
    mockNative(SHEETS_MIME);
    mockedFilesExport.mockResolvedValue({ data: "date,montant\n2026-08-01,42" });

    const res = await driveRead(CFG, "f1");
    expect(mockedFilesExport).toHaveBeenCalledWith({ fileId: "f1", mimeType: "text/csv" });
    expect(res.content).toContain("2026-08-01,42");
  });

  it("aiguille vers sheets.read pour une feuille", async () => {
    mockNative(SHEETS_MIME);
    mockedFilesExport.mockResolvedValue({ data: "a,b" });

    const res = (await driveRead(CFG, "f1")) as { note?: string };
    expect(res.note).toContain("google.sheets.read");
    expect(res.note).toContain("PREMIÈRE feuille");
  });

  it("exporte un Google Doc en texte, sans note", async () => {
    mockNative("application/vnd.google-apps.document");
    mockedFilesExport.mockResolvedValue({ data: "corps du document" });

    const res = (await driveRead(CFG, "f1")) as { content?: string | null; note?: string };
    expect(mockedFilesExport).toHaveBeenCalledWith({
      fileId: "f1",
      mimeType: "text/plain",
    });
    expect(res.content).toBe("corps du document");
    expect(res.note).toBeUndefined();
  });
});

/**
 * La plage par défaut A1:Z1000 coupait les grandes feuilles en silence :
 * l'appelant croyait avoir tout lu.
 */
describe("sheetsRead", () => {
  beforeEach(() => mockedValuesGet.mockReset());

  function rows(count: number, cols = 3): string[][] {
    return Array.from({ length: count }, (_, i) => Array.from({ length: cols }, (_, c) => `r${i}c${c}`));
  }

  it("ne signale rien sur une petite feuille", async () => {
    mockedValuesGet.mockResolvedValue({ data: { values: rows(3) } });
    const res = await sheetsRead(CFG, "s1");
    expect(res.truncated).toBe(false);
    expect(res.note).toBeUndefined();
    expect(res.headers).toEqual(["r0c0", "r0c1", "r0c2"]);
  });

  it("signale la troncature quand la limite de lignes est atteinte", async () => {
    mockedValuesGet.mockResolvedValue({ data: { values: rows(1000) } });
    const res = await sheetsRead(CFG, "s1");
    expect(res.truncated).toBe(true);
    expect(res.note).toContain("A1:Z1000");
  });

  it("signale la troncature quand la limite de colonnes est atteinte", async () => {
    mockedValuesGet.mockResolvedValue({ data: { values: rows(2, 26) } });
    expect((await sheetsRead(CFG, "s1")).truncated).toBe(true);
  });

  it("ne signale rien si l'appelant a fourni sa propre plage", async () => {
    mockedValuesGet.mockResolvedValue({ data: { values: rows(1000) } });
    const res = await sheetsRead(CFG, "s1", "Feuille2!A1:C5000");
    expect(res.truncated).toBe(false);
    expect(mockedValuesGet).toHaveBeenCalledWith(
      expect.objectContaining({ range: "Feuille2!A1:C5000" }),
    );
  });

  it("utilise la plage par défaut quand aucune n'est donnée", async () => {
    mockedValuesGet.mockResolvedValue({ data: { values: [] } });
    await sheetsRead(CFG, "s1");
    expect(mockedValuesGet).toHaveBeenCalledWith(expect.objectContaining({ range: "A1:Z1000" }));
  });
});

describe("sheetsUpdate", () => {
  beforeEach(() => mockedValuesUpdate.mockReset());

  it("écrit la plage demandée en RAW", async () => {
    mockedValuesUpdate.mockResolvedValue({
      data: { updatedCells: 2, updatedRange: "Feuille1!B2:C2" },
    });
    const res = await sheetsUpdate(CFG, "s1", "Feuille1!B2:C2", [["ok", 42]]);
    expect(mockedValuesUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        spreadsheetId: "s1",
        range: "Feuille1!B2:C2",
        valueInputOption: "RAW",
        requestBody: { values: [["ok", 42]] },
      }),
    );
    expect(res).toEqual({ updatedCells: 2, updatedRange: "Feuille1!B2:C2" });
  });

  it("refuse une plage vide ou des valeurs vides, sans appeler l'API", async () => {
    await expect(sheetsUpdate(CFG, "s1", "", [["a"]])).rejects.toThrow(/range/);
    await expect(sheetsUpdate(CFG, "s1", "A1", [])).rejects.toThrow(/values/);
    expect(mockedValuesUpdate).not.toHaveBeenCalled();
  });
});

describe("driveRead — PDF", () => {
  beforeEach(() => {
    mockedFilesGet.mockReset();
    mockedFilesExport.mockReset();
  });

  // Avant : les octets du PDF étaient lus « en texte » et renvoyés en charabia.
  it("ne télécharge pas les octets et explique pourquoi", async () => {
    mockedFilesGet.mockResolvedValueOnce({
      data: { id: "f1", name: "Cartes & Menus.pdf", mimeType: "application/pdf" },
    });
    mockedFilesExport.mockRejectedValue(new Error("export non supporté"));

    const res = (await driveRead(CFG, "f1")) as { content: string | null; note?: string };
    expect(res.content).toBeNull();
    expect(res.note).toContain("PDF");
    // Un seul files.get : les métadonnées. Pas de second appel alt=media.
    expect(mockedFilesGet).toHaveBeenCalledTimes(1);
  });
});
