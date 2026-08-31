import { google } from "googleapis";
import { z } from "zod";

import { env, isGoogleConfigured } from "@/lib/env";
import type { ConnectionProvider } from "@/services/connections/definition";

/**
 * Connexion Google (Drive, Calendar, Gmail) en OAuth 2.0.
 *
 * "Read + send" scopes:
 *  - Gmail : lire + envoyer
 *  - Calendar: read + create/update events
 *  - Drive: read everything + create/manage the app's own files (drive.file)
 */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/spreadsheets",
];

export const googleSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  accessTokenExpiresAt: z.number().optional(),
  scope: z.string().min(1),
  email: z.string().optional(),
});

export type GoogleConfig = z.infer<typeof googleSchema>;
export interface GoogleConfigLegacy {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt?: number; // epoch ms
  scope: string;
  email?: string;
}

function redirectUri(): string {
  return `${env.BETTER_AUTH_URL}/api/connections/google/callback`;
}

function oauthClient() {
  return new google.auth.OAuth2({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: redirectUri(),
  });
}

/** Google consent URL. `state` is what ties the connection back to the user. */
export function googleAuthUrl(state: string): string {
  const client = oauthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES,
    state,
  });
}

/** Exchanges the authorisation code for tokens and builds the stored config. */
export async function exchangeCode(code: string): Promise<GoogleConfig> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("Incomplete OAuth response (missing tokens).");
  }
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessTokenExpiresAt: tokens.expiry_date ?? undefined,
    scope: tokens.scope ?? GOOGLE_SCOPES.join(" "),
  };
}

/**
 * Guarantees a valid access token: refreshes it when expired (or when it has no
 * expiry date) and returns the updated config to persist.
 */
export async function refreshGoogleConfig(cfg: GoogleConfig): Promise<GoogleConfig> {
  const isFresh =
    cfg.accessTokenExpiresAt && cfg.accessTokenExpiresAt > Date.now() + 60_000;
  if (isFresh) return cfg;

  const client = oauthClient();
  client.setCredentials({ refresh_token: cfg.refreshToken });
  const { credentials } = await client.refreshAccessToken();
  if (!credentials.access_token) {
    throw new Error("Could not refresh the Google token.");
  }
  return {
    ...cfg,
    accessToken: credentials.access_token,
    accessTokenExpiresAt: credentials.expiry_date ?? undefined,
  };
}

/**
 * Tests a Google connection by fetching the profile through the Drive `about`
 * API (`drive.readonly`/`drive.file` scope, already granted). We avoid
 * `/oauth2/v2/userinfo`, which requires the `userinfo` scope we do not request.
 */
export async function testGoogle(cfg: GoogleConfig): Promise<string> {
  const client = authClient(cfg);
  const drive = google.drive({ version: "v3", auth: client });
  const { data } = await drive.about.get({ fields: "user(displayName,emailAddress)" });
  const name = data.user?.displayName ?? "";
  const email = data.user?.emailAddress ?? "unknown";
  return `Google: connection OK — ${name} <${email}>`;
}

/** OAuth2 client authenticated with a valid access token. */
function authClient(cfg: GoogleConfig) {
  const client = oauthClient();
  client.setCredentials({ access_token: cfg.accessToken });
  return client;
}

// ---------------------------------------------------------------------------
// Drive
// ---------------------------------------------------------------------------

export interface DriveListOptions {
  /** Drive API `q` syntax, e.g. `mimeType = 'application/pdf'`. */
  query?: string;
  /** E.g. `modifiedTime desc`. Without a sort, Drive's ordering is not guaranteed. */
  orderBy?: string;
  pageSize?: number;
}

const DRIVE_PAGE_SIZE_DEFAULT = 50;
const DRIVE_PAGE_SIZE_MAX = 200;

export async function driveList(cfg: GoogleConfig, opts?: string | DriveListOptions) {
  // Tolerates both LLM-generated shapes: `list("q")` and `list({ query: "q" })`.
  const o: DriveListOptions = typeof opts === "string" ? { query: opts } : (opts ?? {});
  const pageSize = Math.min(Math.max(o.pageSize ?? DRIVE_PAGE_SIZE_DEFAULT, 1), DRIVE_PAGE_SIZE_MAX);
  const drive = google.drive({ version: "v3", auth: authClient(cfg) });
  const { data } = await drive.files.list({
    q: o.query || undefined,
    orderBy: o.orderBy || undefined,
    pageSize,
    fields: "files(id,name,mimeType,modifiedTime,size),nextPageToken",
  });
  return (data.files ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    modifiedTime: f.modifiedTime,
    size: f.size,
  }));
}

/**
 * Coerces the body returned by googleapis into a string.
 *
 * `responseType: "text"` is not enough: for a JSON mimeType, googleapis parses
 * the body and returns an object. Apps then displayed "[object Object]".
 * The contract is therefore normalised here, once, rather than in every app.
 */
function driveContentToString(data: unknown): string | null {
  if (data === null || data === undefined) return null;
  if (typeof data === "string") return data;
  if (typeof data === "number" || typeof data === "boolean") return String(data);
  if (data instanceof Uint8Array) return Buffer.from(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data)).toString("utf8");
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

export const SHEETS_MIME = "application/vnd.google-apps.spreadsheet";

/**
 * A native Google file has no bytes to download: it must be exported, and each
 * type accepts different formats. Asking for `text/plain` on a sheet fails —
 * hence the silent `content: null` before this fix.
 */
const GOOGLE_NATIVE_EXPORTS: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  [SHEETS_MIME]: "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};

const PDF_MIME = "application/pdf";

/** Notes returned to the caller when the content is partial or absent. */
const READ_NOTES: Record<string, string> = {
  [SHEETS_MIME]:
    "CSV export of the FIRST sheet only. For structured data, another sheet or a " +
    "precise range, use google.sheets.read(fileId, range).",
  [PDF_MIME]:
    "A PDF's text cannot be extracted by this method (Drive only exports native " +
    "Google documents). Only the metadata is available.",
};

export async function driveRead(cfg: GoogleConfig, fileId: string) {
  const drive = google.drive({ version: "v3", auth: authClient(cfg) });
  const meta = await drive.files.get({
    fileId,
    fields: "id,name,mimeType",
  });
  const mimeType = meta.data.mimeType ?? "";
  // PDFs are excluded: downloading their bytes "as text" only produced garbage,
  // which is worse than an absent, clearly flagged content.
  const isText =
    !mimeType ||
    mimeType.startsWith("text/") ||
    mimeType.includes("json") ||
    mimeType.includes("csv");

  const content = isText
    ? await drive.files
        .get({ fileId, alt: "media" }, { responseType: "text" })
        .then((r) => driveContentToString(r.data))
    : // Native Google or binary file: export in a format the type accepts.
      await drive.files
        .export({ fileId, mimeType: GOOGLE_NATIVE_EXPORTS[mimeType] ?? "text/plain" })
        .then((r) => driveContentToString(r.data))
        .catch(() => null);

  const result = { name: meta.data.name, mimeType: meta.data.mimeType, content };
  const note = READ_NOTES[mimeType];
  return note ? { ...result, note } : result;
}

/** Creates a file, or replaces its content when `fileId` is provided. */
export async function driveUpload(
  cfg: GoogleConfig,
  input: { name?: string; mimeType?: string; content: string; fileId?: string },
) {
  const drive = google.drive({ version: "v3", auth: authClient(cfg) });
  const media = { mimeType: input.mimeType ?? "text/plain", body: input.content };
  if (input.fileId) {
    const { data } = await drive.files.update({
      fileId: input.fileId,
      requestBody: input.name ? { name: input.name } : {},
      media,
      fields: "id,name,mimeType",
    });
    return { id: data.id, name: data.name, mimeType: data.mimeType };
  }
  if (!input.name) throw new Error("`name` is required to create a file (or provide `fileId`).");
  const { data } = await drive.files.create({
    requestBody: { name: input.name, mimeType: input.mimeType },
    media,
    fields: "id,name,mimeType",
  });
  return { id: data.id, name: data.name, mimeType: data.mimeType };
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export async function calendarList(
  cfg: GoogleConfig,
  opts: { timeMin?: string; timeMax?: string; maxResults?: number } = {},
) {
  const calendar = google.calendar({ version: "v3", auth: authClient(cfg) });
  const { data } = await calendar.events.list({
    calendarId: "primary",
    timeMin: opts.timeMin ?? new Date().toISOString(),
    timeMax: opts.timeMax,
    maxResults: opts.maxResults ?? 20,
    singleEvents: true,
    orderBy: "startTime",
  });
  return (data.items ?? []).map((e) => ({
    id: e.id,
    summary: e.summary,
    description: e.description,
    start: e.start?.dateTime ?? e.start?.date,
    end: e.end?.dateTime ?? e.end?.date,
  }));
}

export async function calendarCreate(
  cfg: GoogleConfig,
  input: { summary: string; description?: string; start: string; end?: string },
) {
  const calendar = google.calendar({ version: "v3", auth: authClient(cfg) });
  const { data } = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.start },
      end: { dateTime: input.end ?? input.start },
    },
  });
  return { id: data.id, summary: data.summary, start: input.start };
}

// ---------------------------------------------------------------------------
// Gmail
// ---------------------------------------------------------------------------

function base64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

export async function gmailSend(
  cfg: GoogleConfig,
  input: { to: string; subject: string; text: string; html?: string },
) {
  const gmail = google.gmail({ version: "v1", auth: authClient(cfg) });
  const message = [
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
    "",
    input.html ?? input.text.replace(/\n/g, "<br/>"),
  ].join("\r\n");
  const { data } = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: base64url(message) },
  });
  return { id: data.id };
}

export async function gmailSearch(cfg: GoogleConfig, query: string, maxResults = 20) {
  const gmail = google.gmail({ version: "v1", auth: authClient(cfg) });
  const { data } = await gmail.users.messages.list({
    userId: "me",
    q: query || undefined,
    maxResults,
  });
  return (data.messages ?? []).map((m) => ({ id: m.id }));
}

export async function gmailRead(cfg: GoogleConfig, id: string) {
  const gmail = google.gmail({ version: "v1", auth: authClient(cfg) });
  const { data } = await gmail.users.messages.get({
    userId: "me",
    id,
    format: "metadata",
    metadataHeaders: ["From", "To", "Subject", "Date"],
  });
  const headers = (data.payload?.headers ?? []).reduce<Record<string, string>>(
    (acc, h) => {
      if (h.name && h.value) acc[h.name.toLowerCase()] = h.value;
      return acc;
    },
    {},
  );
  return {
    id: data.id,
    from: headers.from,
    to: headers.to,
    subject: headers.subject,
    date: headers.date,
    snippet: data.snippet,
  };
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

/** Default range. Bounded, so a large sheet can be cut off. */
const SHEETS_DEFAULT_RANGE = "A1:Z1000";
const SHEETS_DEFAULT_ROWS = 1000;
const SHEETS_DEFAULT_COLS = 26;

export interface SheetsReadResult {
  headers: string[];
  /** Includes the header row: `values[0] === headers`. */
  values: string[][];
  /** True when the default range may have truncated the data. */
  truncated: boolean;
  /** Only present when `truncated`: says how to fetch the rest. */
  note?: string;
}

export async function sheetsRead(
  cfg: GoogleConfig,
  spreadsheetId: string,
  range?: string,
): Promise<SheetsReadResult> {
  const sheets = google.sheets({ version: "v4", auth: authClient(cfg) });
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: range || SHEETS_DEFAULT_RANGE,
  });
  const values = (data.values ?? []) as string[][];
  const headers = values[0] ?? [];

  // On the default range, hitting the bound probably means there is more data.
  // This used to be cut off silently.
  const atLimit =
    !range &&
    (values.length >= SHEETS_DEFAULT_ROWS ||
      values.some((row) => row.length >= SHEETS_DEFAULT_COLS));

  if (!atLimit) return { headers, values, truncated: false };
  return {
    headers,
    values,
    truncated: true,
    note: `Data possibly cut off by the default range ${SHEETS_DEFAULT_RANGE}. Read again with an explicit range, e.g. "A1:AZ5000" or "Sheet2!A1:Z2000".`,
  };
}

/** Writes a precise range. `sheetsAppend` appends; this one overwrites. */
export async function sheetsUpdate(
  cfg: GoogleConfig,
  spreadsheetId: string,
  range: string,
  values: (string | number)[][],
): Promise<{ updatedCells: number; updatedRange: string | null }> {
  if (!range?.trim()) throw new Error("range is required (e.g. \"B2\" or \"Sheet1!A2:C10\").");
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("values must be a non-empty array of rows, e.g. [[\"a\", 1]].");
  }
  const sheets = google.sheets({ version: "v4", auth: authClient(cfg) });
  const { data } = await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "RAW",
    requestBody: { values },
  });
  return { updatedCells: data.updatedCells ?? 0, updatedRange: data.updatedRange ?? null };
}

/** Appends one or more rows at the end of a spreadsheet's data. */
export async function sheetsAppend(
  cfg: GoogleConfig,
  spreadsheetId: string,
  values: (string | number)[][],
): Promise<{ updatedRow: number }> {
  const sheets = google.sheets({ version: "v4", auth: authClient(cfg) });
  const { data } = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "A1",
    valueInputOption: "RAW",
    requestBody: { values },
  });
  const updated = data.updates?.updatedRange;
  const match = updated?.match(/\d+$/);
  return { updatedRow: match ? Number(match[0]) : 0 };
}

/**
 * Creates a Google spreadsheet through the Sheets API, with optional initial
 * values. Prefer it over `driveUpload` for sheets: a file created by the Drive
 * API has no grid Sheets can use (`values.append` then fails with "Request
 * contains an invalid argument").
 */
export async function sheetsCreate(
  cfg: GoogleConfig,
  input: { title?: string; sheetTitle?: string; values?: (string | number)[][] },
): Promise<{ id: string; name: string; sheet: string }> {
  const sheets = google.sheets({ version: "v4", auth: authClient(cfg) });
  const sheet = input.sheetTitle ?? "Sheet1";
  const { data } = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: input.title },
      sheets: [{ properties: { title: sheet } }],
    },
  });
  const spreadsheetId = data.spreadsheetId;
  if (!spreadsheetId) {
    throw new Error("Spreadsheet creation failed.");
  }
  if (input.values && input.values.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheet}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: input.values },
    });
  }
  return { id: spreadsheetId, name: input.title ?? spreadsheetId, sheet };
}

export const googleProvider = {
  type: "google",
  label: "Google",
  schema: googleSchema,
  test: testGoogle,
  resolve: refreshGoogleConfig as (cfg: GoogleConfig) => Promise<GoogleConfig>,
  sdk: {
    namespace: "google",
    methods: {
      "drive.list": driveList as (cfg: GoogleConfig, ...args: unknown[]) => Promise<unknown>,
      "drive.read": driveRead as (cfg: GoogleConfig, ...args: unknown[]) => Promise<unknown>,
      "drive.upload": driveUpload as (cfg: GoogleConfig, ...args: unknown[]) => Promise<unknown>,
      "calendar.list": calendarList as (cfg: GoogleConfig, ...args: unknown[]) => Promise<unknown>,
      "calendar.create": calendarCreate as (cfg: GoogleConfig, ...args: unknown[]) => Promise<unknown>,
      "gmail.send": gmailSend as (cfg: GoogleConfig, ...args: unknown[]) => Promise<unknown>,
      "gmail.search": gmailSearch as (cfg: GoogleConfig, ...args: unknown[]) => Promise<unknown>,
      "gmail.read": gmailRead as (cfg: GoogleConfig, ...args: unknown[]) => Promise<unknown>,
      "sheets.read": sheetsRead as (cfg: GoogleConfig, ...args: unknown[]) => Promise<unknown>,
      "sheets.append": sheetsAppend as (cfg: GoogleConfig, ...args: unknown[]) => Promise<unknown>,
      "sheets.update": sheetsUpdate as (cfg: GoogleConfig, ...args: unknown[]) => Promise<unknown>,
      "sheets.create": sheetsCreate as (cfg: GoogleConfig, ...args: unknown[]) => Promise<unknown>,
    },
  },
  ui: { icon: "Cloud", descriptionKey: "providerGoogleDescription" },
} satisfies ConnectionProvider<GoogleConfig>;

export { isGoogleConfigured };
