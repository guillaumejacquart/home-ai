import { google } from "googleapis";
import { z } from "zod";

import { env, isGoogleConfigured } from "@/lib/env";
import type { ConnectionProvider } from "@/services/connections/definition";

/**
 * Connexion Google (Drive, Calendar, Gmail) en OAuth 2.0.
 *
 * Scopes « lecture + envoi » :
 *  - Gmail : lire + envoyer
 *  - Calendar : lire + créer/modifier des évènements
 *  - Drive : lire tout + créer/gérer les fichiers de l'app (drive.file)
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

/** URL de consentement Google. `state` sert à rattacher la connexion à l'utilisateur. */
export function googleAuthUrl(state: string): string {
  const client = oauthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES,
    state,
  });
}

/** Échange le code d'autorisation contre des tokens et construit la config stockée. */
export async function exchangeCode(code: string): Promise<GoogleConfig> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("Réponse OAuth incomplète (tokens manquants).");
  }
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessTokenExpiresAt: tokens.expiry_date ?? undefined,
    scope: tokens.scope ?? GOOGLE_SCOPES.join(" "),
  };
}

/**
 * Garantit un access token valide : rafraîchit s'il est expiré (ou sans date
 * d'expiration) et retourne la config mise à jour à persister.
 */
export async function refreshGoogleConfig(cfg: GoogleConfig): Promise<GoogleConfig> {
  const isFresh =
    cfg.accessTokenExpiresAt && cfg.accessTokenExpiresAt > Date.now() + 60_000;
  if (isFresh) return cfg;

  const client = oauthClient();
  client.setCredentials({ refresh_token: cfg.refreshToken });
  const { credentials } = await client.refreshAccessToken();
  if (!credentials.access_token) {
    throw new Error("Impossible de rafraîchir le jeton Google.");
  }
  return {
    ...cfg,
    accessToken: credentials.access_token,
    accessTokenExpiresAt: credentials.expiry_date ?? undefined,
  };
}

/**
 * Teste une connexion Google en récupérant le profil via l'API Drive `about`
 * (scope `drive.readonly`/`drive.file`, déjà accordé). On évite `/oauth2/v2/userinfo`
 * qui exige le scope `userinfo` non demandé.
 */
export async function testGoogle(cfg: GoogleConfig): Promise<string> {
  const client = authClient(cfg);
  const drive = google.drive({ version: "v3", auth: client });
  const { data } = await drive.about.get({ fields: "user(displayName,emailAddress)" });
  const name = data.user?.displayName ?? "";
  const email = data.user?.emailAddress ?? "inconnu";
  return `Google : connexion OK — ${name} <${email}>`;
}

/** Client OAuth2 authentifié avec un access token valide. */
function authClient(cfg: GoogleConfig) {
  const client = oauthClient();
  client.setCredentials({ access_token: cfg.accessToken });
  return client;
}

// ---------------------------------------------------------------------------
// Drive
// ---------------------------------------------------------------------------

export interface DriveListOptions {
  /** Syntaxe `q` de l'API Drive, ex. `mimeType = 'application/pdf'`. */
  query?: string;
  /** Ex. `modifiedTime desc`. Sans tri, l'ordre renvoyé par Drive n'est pas garanti. */
  orderBy?: string;
  pageSize?: number;
}

const DRIVE_PAGE_SIZE_DEFAULT = 50;
const DRIVE_PAGE_SIZE_MAX = 200;

export async function driveList(cfg: GoogleConfig, opts?: string | DriveListOptions) {
  // Tolère les deux formes générées par le LLM : `list("q")` et `list({ query: "q" })`.
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
 * Ramène le corps renvoyé par googleapis à une chaîne.
 *
 * `responseType: "text"` ne suffit pas : pour un mimeType JSON, googleapis parse
 * le corps et rend un objet. Les apps affichaient alors « [object Object] ».
 * Le contrat est donc normalisé ici, une fois, plutôt que dans chaque app.
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
 * Un fichier Google natif n'a pas d'octets à télécharger : il faut l'exporter,
 * et chaque type accepte des formats différents. Demander `text/plain` pour une
 * feuille échoue — d'où un `content: null` silencieux avant ce correctif.
 */
const GOOGLE_NATIVE_EXPORTS: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  [SHEETS_MIME]: "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};

const PDF_MIME = "application/pdf";

/** Précisions renvoyées au appelant quand le contenu est partiel ou absent. */
const READ_NOTES: Record<string, string> = {
  [SHEETS_MIME]:
    "Export CSV de la PREMIÈRE feuille uniquement. Pour des données structurées, " +
    "une autre feuille ou une plage précise, utilise google.sheets.read(fileId, range).",
  [PDF_MIME]:
    "Le texte d'un PDF n'est pas extractible par cette méthode (Drive n'exporte " +
    "que les documents Google natifs). Seules les métadonnées sont disponibles.",
};

export async function driveRead(cfg: GoogleConfig, fileId: string) {
  const drive = google.drive({ version: "v3", auth: authClient(cfg) });
  const meta = await drive.files.get({
    fileId,
    fields: "id,name,mimeType",
  });
  const mimeType = meta.data.mimeType ?? "";
  // Un PDF est exclu : télécharger ses octets « en texte » ne donnait que du
  // charabia, ce qui est pire qu'un contenu absent et clairement signalé.
  const isText =
    !mimeType ||
    mimeType.startsWith("text/") ||
    mimeType.includes("json") ||
    mimeType.includes("csv");

  const content = isText
    ? await drive.files
        .get({ fileId, alt: "media" }, { responseType: "text" })
        .then((r) => driveContentToString(r.data))
    : // Fichier Google natif ou binaire : export au format que le type accepte.
      await drive.files
        .export({ fileId, mimeType: GOOGLE_NATIVE_EXPORTS[mimeType] ?? "text/plain" })
        .then((r) => driveContentToString(r.data))
        .catch(() => null);

  const result = { name: meta.data.name, mimeType: meta.data.mimeType, content };
  const note = READ_NOTES[mimeType];
  return note ? { ...result, note } : result;
}

/** Crée un fichier, ou remplace son contenu si `fileId` est fourni. */
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
  if (!input.name) throw new Error("`name` est requis pour créer un fichier (ou fournis `fileId`).");
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

/** Lit les valeurs d'un spreadsheet. `range` par défaut = toute la feuille active. */
/** Plage par défaut. Bornée, donc une grande feuille peut être coupée. */
const SHEETS_DEFAULT_RANGE = "A1:Z1000";
const SHEETS_DEFAULT_ROWS = 1000;
const SHEETS_DEFAULT_COLS = 26;

export interface SheetsReadResult {
  headers: string[];
  /** Inclut la ligne d'en-tête : `values[0] === headers`. */
  values: string[][];
  /** Vrai si la plage par défaut a pu tronquer les données. */
  truncated: boolean;
  /** Présent seulement si `truncated` : dit comment récupérer le reste. */
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

  // Sur la plage par défaut, atteindre la borne veut probablement dire qu'il
  // reste des données. Avant, la coupure était silencieuse.
  const atLimit =
    !range &&
    (values.length >= SHEETS_DEFAULT_ROWS ||
      values.some((row) => row.length >= SHEETS_DEFAULT_COLS));

  if (!atLimit) return { headers, values, truncated: false };
  return {
    headers,
    values,
    truncated: true,
    note: `Données possiblement coupées par la plage par défaut ${SHEETS_DEFAULT_RANGE}. Relis avec une plage explicite, ex. "A1:AZ5000" ou "Feuille2!A1:Z2000".`,
  };
}

/** Écrit une plage précise. `sheetsAppend` ajoute en fin, celle-ci écrase. */
export async function sheetsUpdate(
  cfg: GoogleConfig,
  spreadsheetId: string,
  range: string,
  values: (string | number)[][],
): Promise<{ updatedCells: number; updatedRange: string | null }> {
  if (!range?.trim()) throw new Error("range est requis (ex. \"B2\" ou \"Feuille1!A2:C10\").");
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("values doit être un tableau de lignes non vide, ex. [[\"a\", 1]].");
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

/** Ajoute une ligne (ou plusieurs) en fin de données d'un spreadsheet. */
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
 * Crée un spreadsheet Google via l'API Sheets, avec valeurs initiales
 * optionnelles. À privilégier sur `driveUpload` pour les feuilles : un fichier
 * créé par l'API Drive n'a pas de grille exploitable par Sheets (`values.append`
 * échoue alors avec « Request contains an invalid argument »).
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
    throw new Error("Création du spreadsheet échouée.");
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
