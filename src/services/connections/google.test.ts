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

  it("passes a string query as-is", async () => {
    await driveList(CFG, "name='toto' and 'root' in parents");
    expect(mockedFilesList).toHaveBeenCalledWith(
      expect.objectContaining({ q: "name='toto' and 'root' in parents" }),
    );
  });

  it("normalises { query } into a string (the form the LLM generates)", async () => {
    await driveList(CFG, { query: "name='toto'" });
    expect(mockedFilesList).toHaveBeenCalledWith(expect.objectContaining({ q: "name='toto'" }));
  });

  it("lists with no query", async () => {
    await driveList(CFG);
    expect(mockedFilesList).toHaveBeenCalledWith(expect.objectContaining({ q: undefined }));
  });

  // "the N most recently modified files" was impossible: without orderBy, Drive
  // returns an unspecified order and the model sorted 50 rows at random.
  it("forwards orderBy and pageSize", async () => {
    await driveList(CFG, { orderBy: "modifiedTime desc", pageSize: 10 });
    expect(mockedFilesList).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: "modifiedTime desc", pageSize: 10, q: undefined }),
    );
  });

  it("clamps pageSize and defaults orderBy to undefined", async () => {
    await driveList(CFG, { pageSize: 5000 });
    expect(mockedFilesList).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 200, orderBy: undefined }),
    );

    await driveList(CFG, { pageSize: 0 });
    expect(mockedFilesList).toHaveBeenLastCalledWith(expect.objectContaining({ pageSize: 1 }));
  });
});
/**
 * The generated app displayed "[object Object]": googleapis parses a JSON
 * file's body into an object despite `responseType: "text"`. The contract is
 * normalised in driveRead so no app has to redo this.
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

  it("serialises a JSON body parsed into an object", async () => {
    mockFile("application/json", { todos: [{ text: "buy bread" }] });
    const res = await driveRead(CFG, "f1");
    expect(typeof res.content).toBe("string");
    expect(res.content).toContain("buy bread");
  });

  it("leaves a string untouched", async () => {
    mockFile("text/plain", "line 1\nline 2");
    expect((await driveRead(CFG, "f1")).content).toBe("line 1\nline 2");
  });

  it("decodes a binary body as UTF-8", async () => {
    mockFile("text/plain", new TextEncoder().encode("héllo"));
    expect((await driveRead(CFG, "f1")).content).toBe("héllo");
  });

  it("returns null when there is no content", async () => {
    mockFile("text/plain", null);
    expect((await driveRead(CFG, "f1")).content).toBeNull();
  });

  it("also normalises the export of a non-text file", async () => {
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
 * A Google Sheet fell into the export branch with `text/plain`, a format
 * Drive doesn't offer for sheets: the export threw, the catch swallowed it,
 * and the caller got `content: null` with no explanation.
 */
describe("driveRead — native Google files", () => {
  beforeEach(() => {
    mockedFilesGet.mockReset();
    mockedFilesExport.mockReset();
  });

  function mockNative(mimeType: string) {
    mockedFilesGet.mockResolvedValueOnce({ data: { id: "f1", name: "accounting", mimeType } });
  }

  it("exports a sheet as CSV, not text/plain", async () => {
    mockNative(SHEETS_MIME);
    mockedFilesExport.mockResolvedValue({ data: "date,amount\n2026-08-01,42" });

    const res = await driveRead(CFG, "f1");
    expect(mockedFilesExport).toHaveBeenCalledWith({ fileId: "f1", mimeType: "text/csv" });
    expect(res.content).toContain("2026-08-01,42");
  });

  it("points to sheets.read for a sheet", async () => {
    mockNative(SHEETS_MIME);
    mockedFilesExport.mockResolvedValue({ data: "a,b" });

    const res = (await driveRead(CFG, "f1")) as { note?: string };
    expect(res.note).toContain("google.sheets.read");
    expect(res.note).toContain("FIRST sheet");
  });

  it("exports a Google Doc as text, with no note", async () => {
    mockNative("application/vnd.google-apps.document");
    mockedFilesExport.mockResolvedValue({ data: "document body" });

    const res = (await driveRead(CFG, "f1")) as { content?: string | null; note?: string };
    expect(mockedFilesExport).toHaveBeenCalledWith({
      fileId: "f1",
      mimeType: "text/plain",
    });
    expect(res.content).toBe("document body");
    expect(res.note).toBeUndefined();
  });
});

/**
 * The default A1:Z1000 range silently truncated large sheets: the caller
 * thought it had read everything.
 */
describe("sheetsRead", () => {
  beforeEach(() => mockedValuesGet.mockReset());

  function rows(count: number, cols = 3): string[][] {
    return Array.from({ length: count }, (_, i) => Array.from({ length: cols }, (_, c) => `r${i}c${c}`));
  }

  it("reports nothing on a small sheet", async () => {
    mockedValuesGet.mockResolvedValue({ data: { values: rows(3) } });
    const res = await sheetsRead(CFG, "s1");
    expect(res.truncated).toBe(false);
    expect(res.note).toBeUndefined();
    expect(res.headers).toEqual(["r0c0", "r0c1", "r0c2"]);
  });

  it("reports truncation when the row limit is hit", async () => {
    mockedValuesGet.mockResolvedValue({ data: { values: rows(1000) } });
    const res = await sheetsRead(CFG, "s1");
    expect(res.truncated).toBe(true);
    expect(res.note).toContain("A1:Z1000");
  });

  it("reports truncation when the column limit is hit", async () => {
    mockedValuesGet.mockResolvedValue({ data: { values: rows(2, 26) } });
    expect((await sheetsRead(CFG, "s1")).truncated).toBe(true);
  });

  it("reports nothing when the caller provided its own range", async () => {
    mockedValuesGet.mockResolvedValue({ data: { values: rows(1000) } });
    const res = await sheetsRead(CFG, "s1", "Sheet2!A1:C5000");
    expect(res.truncated).toBe(false);
    expect(mockedValuesGet).toHaveBeenCalledWith(
      expect.objectContaining({ range: "Sheet2!A1:C5000" }),
    );
  });

  it("uses the default range when none is given", async () => {
    mockedValuesGet.mockResolvedValue({ data: { values: [] } });
    await sheetsRead(CFG, "s1");
    expect(mockedValuesGet).toHaveBeenCalledWith(expect.objectContaining({ range: "A1:Z1000" }));
  });
});

describe("sheetsUpdate", () => {
  beforeEach(() => mockedValuesUpdate.mockReset());

  it("writes the requested range as RAW", async () => {
    mockedValuesUpdate.mockResolvedValue({
      data: { updatedCells: 2, updatedRange: "Sheet1!B2:C2" },
    });
    const res = await sheetsUpdate(CFG, "s1", "Sheet1!B2:C2", [["ok", 42]]);
    expect(mockedValuesUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        spreadsheetId: "s1",
        range: "Sheet1!B2:C2",
        valueInputOption: "RAW",
        requestBody: { values: [["ok", 42]] },
      }),
    );
    expect(res).toEqual({ updatedCells: 2, updatedRange: "Sheet1!B2:C2" });
  });

  it("refuses an empty range or empty values, without calling the API", async () => {
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

  // Before: the PDF's raw bytes were read "as text" and returned as gibberish.
  it("doesn't download the bytes and explains why", async () => {
    mockedFilesGet.mockResolvedValueOnce({
      data: { id: "f1", name: "Cards & Menus.pdf", mimeType: "application/pdf" },
    });
    mockedFilesExport.mockRejectedValue(new Error("export not supported"));

    const res = (await driveRead(CFG, "f1")) as { content: string | null; note?: string };
    expect(res.content).toBeNull();
    expect(res.note).toContain("PDF");
    // Only one files.get call, for metadata — no second alt=media call.
    expect(mockedFilesGet).toHaveBeenCalledTimes(1);
  });
});
