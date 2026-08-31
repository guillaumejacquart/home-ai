import type { ConnectionType } from "@/db/schema";
import type { ConnectionProvider, MethodEntry } from "@/services/connections/definition";
import { imapProvider, smtpProvider } from "@/services/connections/email";
import { googleProvider } from "@/services/connections/google";
import { homeassistantProvider } from "@/services/connections/homeassistant";
import { notionProvider } from "@/services/connections/notion";
import { telegramProvider } from "@/services/connections/telegram";
import { weatherProvider } from "@/services/connections/weather";
import { webhookProvider } from "@/services/connections/webhook";

/** Every registered provider. Adding a connection = one line here + its provider file. */
export const connectionRegistry = new Map<ConnectionType, ConnectionProvider<unknown>>([
  ["google", googleProvider as ConnectionProvider<unknown>],
  ["smtp", smtpProvider as ConnectionProvider<unknown>],
  ["imap", imapProvider as ConnectionProvider<unknown>],
  ["telegram", telegramProvider as ConnectionProvider<unknown>],
  ["notion", notionProvider as ConnectionProvider<unknown>],
  ["homeassistant", homeassistantProvider as ConnectionProvider<unknown>],
  ["weather", weatherProvider as ConnectionProvider<unknown>],
  ["webhook", webhookProvider as ConnectionProvider<unknown>],
]);

/** "Full method" -> entry table (handles the mail.send / mail.search homonyms) */
export const methodRegistry = new Map<string, MethodEntry>();

for (const provider of connectionRegistry.values()) {
  for (const [methodKey, fn] of Object.entries(provider.sdk.methods)) {
    const fullMethod = `${provider.sdk.namespace}.${methodKey}`;
    methodRegistry.set(fullMethod, {
      type: provider.type,
      namespace: provider.sdk.namespace,
      methodKey,
      fullMethod,
      fn: fn as MethodEntry["fn"],
    });
  }
}

export function getProvider(type: ConnectionType): ConnectionProvider<unknown> | undefined {
  return connectionRegistry.get(type);
}

export function getMethod(fullMethod: string): MethodEntry | undefined {
  return methodRegistry.get(fullMethod);
}

export function listProviders(): ConnectionProvider<unknown>[] {
  return [...connectionRegistry.values()];
}

/** Builds the subtree exposed to the LLM / docs */
export function getSdkDocs(): string[] {
  const lines: string[] = [];
  for (const p of connectionRegistry.values()) {
    for (const [k] of Object.entries(p.sdk.methods)) {
      lines.push(`${p.sdk.namespace}.${k}`);
    }
  }
  return lines;
}

/** Human docs per namespace for the LLM prompts — avoids duplicating the prose. */
const PROVIDER_DOCS: Record<string, string> = {
  google:
    "`google.drive.list({query?, orderBy?, pageSize?})` → [{id,name,mimeType,modifiedTime,size}] (query = the Drive API `q` syntax, e.g. `mimeType='application/pdf'`; last N modified = `{orderBy:'modifiedTime desc', pageSize:N}` with no query; without orderBy the ordering is not guaranteed), `google.drive.read(fileId)` → {name, mimeType, content, note?} — `content` is ALWAYS a string or null (never an object): display `.content`, not the whole object. Native Google files are exported (Docs/Slides → text, Sheets → CSV of the 1st sheet). A PDF only yields its metadata (`content: null`): its text cannot be extracted. `note` explains any limit hit, `google.drive.upload({name?, mimeType?, content, fileId?})` — without `fileId` it CREATES a new file (two calls = two same-named files); with `fileId` it REPLACES the existing file's content. For a 'journal' file you keep appending to: `drive.list` to find the id, `drive.read` for the content, then `drive.upload({fileId, content})`, `google.calendar.list({timeMin?, timeMax?, maxResults?})`, `google.calendar.create({summary, description?, start, end?})`, `google.gmail.send({to, subject, text, html?})`, `google.gmail.search(query, maxResults?)`, `google.gmail.read(id)`, `google.sheets.read(spreadsheetId, range?)` → {headers, values, truncated, note?} — PREFER THIS over drive.read for a Google Sheets. `values` includes the header row (`values[0] === headers`): to show only the data, use `values.slice(1)`. `range` in A1 notation, e.g. `Sheet2!A1:D50`; without `range` the default range is A1:Z1000 and `truncated: true` signals you should read again with a wider range, `google.sheets.append(spreadsheetId, [[...]])` (appends at the end), `google.sheets.update(spreadsheetId, range, [[...]])` → {updatedCells, updatedRange} (OVERWRITES the given range — to fix a cell or an existing row, e.g. range `B2` or `Sheet1!A2:C10`), `google.sheets.create({title?, sheetTitle?, values?})`",
  mail: "`mail.send({to, subject, text, html?})` (SMTP), `mail.search(query?, maxResults?)`, `mail.read(uid)` (IMAP)",
  telegram: "`telegram.send({chatId?, text, parseMode?})` → {messageId}, `telegram.getUpdates(limit?)`",
  notion: "`notion.search(query, pageSize?)` → {results}, `notion.queryDatabase(databaseId, {filter?, sorts?, pageSize?})`, `notion.createPage({parent:{database_id?, page_id?}, properties})` → {id}, `notion.getPage(pageId)`",
  homeassistant: "`homeassistant.getStates()` → states[], `homeassistant.getState(entityId)`, `homeassistant.callService({domain, service, entityId?, data?})`",
  weather: "`weather.current({lat?, lon?, city?, lang?, units?})` → current OpenWeather conditions, `weather.forecast({lat?, lon?, city?})` → 5-day forecast",
  webhook: "`webhook.call({url?, method?, body?, headers?})` → {status, body} (uses the stored Webhook connection when url is omitted)",
};

export function getSdkPromptLines(prefix: "homeSDK" | "home"): string[] {
  const lines: string[] = [];
  for (const p of connectionRegistry.values()) {
    const doc = PROVIDER_DOCS[p.sdk.namespace];
    if (doc) lines.push(`- \`${prefix}.${doc}\``);
  }
  // avoids a duplicate mail entry (smtp+imap share the same namespace)
  return [...new Set(lines)];
}
