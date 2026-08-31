import type { ConnectionType } from "@/db/schema";
import type { ConnectionProvider, MethodEntry } from "@/services/connections/definition";
import { imapProvider, smtpProvider } from "@/services/connections/email";
import { googleProvider } from "@/services/connections/google";
import { homeassistantProvider } from "@/services/connections/homeassistant";
import { notionProvider } from "@/services/connections/notion";
import { telegramProvider } from "@/services/connections/telegram";
import { weatherProvider } from "@/services/connections/weather";
import { webhookProvider } from "@/services/connections/webhook";

/** Tous les providers enregistrés. Ajouter une connexion = ajouter une ligne ici + créer son fichier provider. */
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

/** Table "méthode complète" -> entrée (gère homonymes mail.send / mail.search) */
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

/** Construit le sous-arbre exposé au LLM / docs */
export function getSdkDocs(): string[] {
  const lines: string[] = [];
  for (const p of connectionRegistry.values()) {
    for (const [k] of Object.entries(p.sdk.methods)) {
      lines.push(`${p.sdk.namespace}.${k}`);
    }
  }
  return lines;
}

/** Docs humains par namespace pour les prompts LLM — évite de dupliquer la prose. */
const PROVIDER_DOCS: Record<string, string> = {
  google: "`google.drive.list({query?, orderBy?, pageSize?})` → [{id,name,mimeType,modifiedTime,size}] (query = syntaxe `q` de l'API Drive ex. `mimeType='application/pdf'` ; N derniers modifiés = `{orderBy:'modifiedTime desc', pageSize:N}` sans query ; sans orderBy l'ordre n'est pas garanti), `google.drive.read(fileId)` → {name, mimeType, content, note?} — `content` est TOUJOURS une chaîne ou null (jamais un objet) : affiche `.content`, pas l'objet entier. Les fichiers Google natifs sont exportés (Docs/Slides → texte, Sheets → CSV de la 1re feuille). Un PDF ne rend que ses métadonnées (`content: null`) : son texte n'est pas extractible. `note` explique toute limite rencontrée, `google.drive.upload({name?, mimeType?, content, fileId?})` — sans `fileId` CRÉE un nouveau fichier (deux appels = deux fichiers homonymes) ; avec `fileId` REMPLACE le contenu du fichier existant. Pour un fichier « journal » qu'on complète : `drive.list` pour trouver l'id, `drive.read` pour le contenu, puis `drive.upload({fileId, content})`, `google.calendar.list({timeMin?, timeMax?, maxResults?})`, `google.calendar.create({summary, description?, start, end?})`, `google.gmail.send({to, subject, text, html?})`, `google.gmail.search(query, maxResults?)`, `google.gmail.read(id)`, `google.sheets.read(spreadsheetId, range?)` → {headers, values, truncated, note?} — À PRIVILÉGIER sur drive.read pour un Google Sheets. `values` inclut la ligne d'en-tête (`values[0] === headers`) : pour n'afficher que les données, utilise `values.slice(1)`. `range` au format A1, ex. `Feuille2!A1:D50` ; sans `range` la plage par défaut est A1:Z1000 et `truncated: true` signale qu'il faut relire avec une plage plus large, `google.sheets.append(spreadsheetId, [[...]])` (ajoute en fin), `google.sheets.update(spreadsheetId, range, [[...]])` → {updatedCells, updatedRange} (ÉCRASE la plage donnée — pour corriger une cellule ou une ligne existante, ex. range `B2` ou `Feuille1!A2:C10`), `google.sheets.create({title?, sheetTitle?, values?})`",
  mail: "`mail.send({to, subject, text, html?})` (SMTP), `mail.search(query?, maxResults?)`, `mail.read(uid)` (IMAP)",
  telegram: "`telegram.send({chatId?, text, parseMode?})` → {messageId}, `telegram.getUpdates(limit?)`",
  notion: "`notion.search(query, pageSize?)` → {results}, `notion.queryDatabase(databaseId, {filter?, sorts?, pageSize?})`, `notion.createPage({parent:{database_id?, page_id?}, properties})` → {id}, `notion.getPage(pageId)`",
  homeassistant: "`homeassistant.getStates()` → states[], `homeassistant.getState(entityId)`, `homeassistant.callService({domain, service, entityId?, data?})`",
  weather: "`weather.current({lat?, lon?, city?, lang?, units?})` → météo actuelle OpenWeather, `weather.forecast({lat?, lon?, city?})` → prévision 5 jours",
  webhook: "`webhook.call({url?, method?, body?, headers?})` → {status, body} (utilise la connexion Webhook stockée si url omis)",
};

export function getSdkPromptLines(prefix: "homeSDK" | "home"): string[] {
  const lines: string[] = [];
  for (const p of connectionRegistry.values()) {
    const doc = PROVIDER_DOCS[p.sdk.namespace];
    if (doc) lines.push(`- \`${prefix}.${doc}\``);
  }
  // évite doublon mail (smtp+imap partagent le même namespace)
  return [...new Set(lines)];
}
