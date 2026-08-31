import { chatCompletion, chatCompletionStream, defaultModels, LlmError } from "@/services/llm/llm";
import type { ChatMessage } from "@/services/llm/llm";
import { addGenerationMessage, listAppMessages } from "@/services/messages/chat";
import { createVersion, currentHtml } from "@/services/apps/versions";
import { getAppOwnerId } from "@/services/apps/apps";
import { applyEditBlocks, describeFailure, parseEditBlocks } from "@/services/generation/edit-blocks";
import type { NewAppInput } from "@/services/apps/apps";
import {
  chatWithTruncationRetry,
  extractStorageKeys,
  formatHistory,
  languageInstruction,
  truncateHtml,
  type GenerateOptions,
  type GenerationHistoryEntry,
} from "@/services/generation/shared";
import { getSdkPromptLines } from "@/services/connections/registry";

/**
 * Génération d'apps par prompt (le cœur « Lovable »), découpée en deux phases
 * appelables séparément (visibilité réelle dans l'UI) :
 *  1. `planApp` : planificateur (GLM par défaut) → plan.
 *  2. `codeApp` : implémenteur (DeepSeek par défaut) → HTML complet.
 *
 * L'état entre les deux phases transite par le client (le plan est renvoyé puis
 * réinjecté) : pas de session serveur à maintenir.
 *
 * Itération : dès que l'app a un HTML courant (`currentHtml`), les deux phases
 * basculent en mode « modification » — le planificateur produit un plan
 * d'évolution/correction, le coder reçoit l'historique des échanges précédents
 * et le HTML actuel (tronqué s'il est très gros) avec une consigne de PATCH
 * CIBLÉ (ne pas réécrire tout le fichier, préserver les clés de stockage).
 *
 * Conventions imposées au code généré (Alpine.js + Tailwind) pour un rendu propre.
 */

/** Garde-fou de contexte : assez haut pour laisser passer une app entière. */
const CONTEXT_MAX_CHARS = 120_000;

export interface GenerateResult {
  html: string;
  versionId: string;
  version: number;
  plan: string;
}

function buildCoderSystem(isIterating: boolean): string {
  const sdkLines = getSdkPromptLines("homeSDK").join("\n    ");
  const iterationRules = isIterating
    ? `
- MODIFICATION D'UNE APP EXISTANTE — tu ne renvoies PAS le fichier, mais des BLOCS D'ÉDITION :
    - Format EXACT, un bloc par changement, et RIEN d'autre dans ta réponse (pas de prose, pas de \`\`\`) :
      <<<<<<< SEARCH
      (lignes à remplacer, copiées TEXTUELLEMENT depuis le code actuel)
      =======
      (lignes de remplacement)
      >>>>>>> REPLACE
    - La partie SEARCH doit être copiée caractère pour caractère depuis le code actuel, indentation comprise. Elle doit apparaître UNE SEULE FOIS dans le fichier : ajoute des lignes de contexte autour si besoin pour la rendre unique.
    - Change le strict nécessaire. Tout ce qui n'est pas concerné n'apparaît dans aucun bloc, donc reste intact.
    - Ne touche jamais aux clés de stockage, au manifeste ni au commentaire de storage, sauf si la demande le requiert explicitement.
    - Pour ajouter du code, fais un SEARCH sur une ligne existante voisine et rends-la dans le REPLACE suivie de l'ajout.`
    : "";
  return `Tu es un développeur front-end qui crée de petites apps web familiales dans une page HTML unique.
${iterationRules}
CONVENTIONS STRICTES — à respecter à la lettre :
- Produis un FRAGMENT HTML, PAS un document complet : pas de <!DOCTYPE>, <html>, <head> ni <body>. La plateforme enveloppe ton code dans un document qui charge déjà les bibliothèques. Ton code commence directement par le commentaire de storage puis le balisage.
- NE PAS inclure de <link> Tailwind ni de <script> Alpine : la plateforme injecte déjà Tailwind et Alpine.js. Utilise simplement les classes Tailwind et les attributs Alpine (x-data, x-for, x-model, x-on, x-text, x-show).
- BOOTSTRAP ALPINE — suis EXACTEMENT ce pattern, c'est le seul fiable :
     - Définis UNE fonction globale nommée \`app\` qui retourne l'objet d'état/actions : \`function app() { return { ... } }\`.
     - Utilise \`x-data="app()"\` sur l'élément racine.
     - NE PAS utiliser \`Alpine.data\`, \`document.addEventListener('alpine:init', ...)\`, ni \`window.app\`. Interdiction formelle : ça casse le binding.
- LIBS PRÉ-CHARGÉES — la plateforme injecte déjà :
     - Tailwind CSS (classes utilitaires) et Alpine.js 3.
     - Chart.js 4 (global \`Chart\`, UMD) : disponible sans import. Pour un graphique, ajoute \`<canvas x-ref="myChart"></canvas>\` puis dans le JS : \`this._chart?.destroy(); this._chart = new Chart(this.$refs.myChart, { type: 'bar', data: { labels: [...], datasets: [{ label: '...', data: [...] }] }, options: { responsive: true } })\`. Appelle-le dans \`$nextTick\` ou après chargement des données. NE PAS ajouter de <script> Chart.js.
     - Dates : utilise le natif (\`new Date().toISOString().slice(0,10)\`, \`Intl.DateTimeFormat('fr-FR')\`) — pas besoin de librairie externe.
     - CSP stricte : seul \`cdn.jsdelivr.net\` est autorisé en script/style. N'essaie pas d'importer depuis un autre CDN (bloqué).
- Structure le JavaScript avec des fonctions séparées et nommées. Pas de JS spaghetti dans les attributs.
- Design soigné : mise en page responsive, espacement propre, palette cohérente, lisibilité.
- Toute donnée externe ou persistance passe par l'objet global \`homeSDK\` (fourni par la plateforme). Aucun fetch direct vers l'extérieur. Méthodes disponibles (toutes async, gèrent l'erreur avec try/catch) :
     - \`homeSDK.storage.get(key)\`, \`.set(key, value)\`, \`.list()\`, \`.remove(key)\` — KV JSON persisté par app.
      - \`homeSDK.storage.table.add("todos", {text: "..."} )\` → ligne créée (id auto-généré), \`.update("todos", id, patch)\`, \`.remove("todos", id)\` → {ok, removed}, \`.toggle("todos", id, "done"?)\` — CRUD ligne par ligne sur un tableau d'objets, SANS réécrire la liste entière : à privilégier pour toute collection (pas de read-modify-write de get/set entier).
      - \`homeSDK.storage.global.get(key)\`, \`.set(key, value)\`, \`.list()\`, \`.remove(key)\` — KV JSON global partagé entre toutes les apps de l'utilisateur (à n'utiliser que pour une donnée vraiment partagée, ex. une liste familiale commune).
- CONVENTION DE CLÉS — respecte-la pour que l'assistant et le MCP puissent retrouver tes données :
     - UNE clé par collection, en minuscules (kebab-case) : ex. \`todos\` = \`[{"id":"a","text":"...","done":false,"createdAt":1710000000}]\`, \`settings\` = objet, \`counter\` = nombre.
     - Pas de clés dynamiques par item (ex. \`todo-1\`, \`todo-2\`) : regroupe toujours dans UNE seule clé tableau.
     - Ajoute en haut du HTML un commentaire \`<!-- storage: todos, settings -->\` listant les clés utilisées, pour faciliter la maintenance.
- MANIFESTE (optionnel mais recommandé si l'app gère des données) : déclare ce que l'app expose au MCP et à l'assistant. À la fin du <body>, ajoute un script exactement de cette forme :
     \`<script type="application/json" id="home-manifest">{"tools":[{"name":"add","description":"Ajoute une tâche à la liste","parameters":{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]},"storage":{"op":"append","key":"todos"}},{"name":"toggle","description":"Marque une tâche comme faite/non faite","parameters":{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]},"storage":{"op":"toggle","key":"todos"}},{"name":"remove","description":"Supprime une tâche","parameters":{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]},"storage":{"op":"remove","key":"todos"}}]}</script>\`
     - \`name\` : minuscules + underscores (ex. \`add\`, \`toggle\`). \`description\` : phrase claire. \`parameters\` : JSON Schema (\`type\` + \`properties\` + \`required\`).
     - \`storage.op\` : \`get\`/\`list\` (lire), \`set\` (écrire la valeur entière, paramètre \`value\`), \`append\` (ajoute un élément, les autres paramètres deviennent ses champs + \`id\` auto-généré), \`remove\` (supprime par \`id\`), \`toggle\` (bascule \`done\` par \`id\`, paramètre \`field\` optionnel).
     - \`storage.key\` : la clé KV gérée par le tool (ex. \`todos\`). Chaque élément doit avoir un champ \`id\` unique.
     - Ne déclare pas plus de 5 tools. Si l'app n'a pas de données persistées, n'inclus PAS ce script.
- INTERDICTION FORMELLE : n'utilise JAMAIS \`localStorage\`, \`sessionStorage\`, \`IndexedDB\` ni \`document.cookie\`. L'iframe est sandboxée (origine opaque) : ces APIs sont inaccessibles ou jetables, les données seraient perdues. Toute persistance = \`homeSDK.storage.*\`.
- Tous les appels \`homeSDK.*\` retournent une Promise : \`await\` obligatoire. Le chargement initial de données persistées se fait dans un \`async init()\`, avec un indicateur de chargement et un try/catch.
- Exemple de persistance à adapter (ne pas recopier tel quel) :
     async init() {
       this.loading = true;
       try {
         this.tasks = (await homeSDK.storage.get("tasks")) ?? [];
       } catch (e) {
         this.error = "Impossible de charger les données.";
       }
       this.loading = false;
     },
     async saveTasks() {
       await homeSDK.storage.set("tasks", this.tasks);
     }
 ${sdkLines}
      - \`homeSDK.http.fetch(url, {method?, headers?, body?})\` → {status, body, headers} (fetch générique public, bloqué pour IPs privées)
      - \`homeSDK.ai.chat(prompt, {system?, temperature?, maxTokens?})\` → string (texte généré par le LLM du propriétaire, modèle « build ») ; \`homeSDK.ai.messages([{role: "system"|"user"|"assistant", content}, ...], {temperature?, maxTokens?})\` → string (multi-tours)
      - \`homeSDK.ai.chatStream(prompt, {system?, temperature?, maxTokens?}, onToken)\` → string (même que chat mais streamé : \`onToken\` est appelée pour chaque token, idéal pour afficher une réponse en live avec \`onToken: (tok) => { this.reply += tok }\`) ; \`homeSDK.ai.messagesStream(messages, opts, onToken)\` idem
      - \`homeSDK.scripts.list()\` → [{id, name, triggerKind, enabled, lastRunAt}] (scripts déclenchables), \`homeSDK.scripts.run(nomOuId, payload?)\` → {runId, status:"running"} (lance le script SANS attendre la fin), \`homeSDK.scripts.runStatus(runId)\` → {status, output, error, durationMs}, \`homeSDK.scripts.lastRun(nomOuId)\` → même forme ou null
    Utilise ces méthodes pour les données externes ; laisse les champs optionnels aux valeurs par défaut. En cas d'échec (ex. service non connecté), affiche un message clair à l'utilisateur.
- Les appels IA (\`homeSDK.ai.*\`) sont lents (plusieurs secondes) : affiche un état de chargement et gère l'erreur avec try/catch. Préfère \`chatStream\`/\`messagesStream\` pour une UX en live.
- Bouton qui lance un script : \`run()\` rend la main immédiatement, il faut interroger \`runStatus(runId)\` toutes les secondes jusqu'à ce que \`status\` ne vaille plus \`"running"\`. Désactive le bouton pendant l'exécution (un script a des effets réels : double-clic = double envoi) et demande une confirmation pour une action irréversible.
- Utilise \`async/await\` et gère les erreurs avec un affichage clair.
- Les formulaires utilisent @submit.prevent ; alert/confirm() sont disponibles.

Réponds UNIQUEMENT avec le code HTML complet, dans un bloc de code marqué \`\`\`html ... \`\`\`.`;
}

const PLANNER_SYSTEM = `Tu es un chef de projet technique. L'utilisateur veut créer une petite app web familiale.
Analyse la demande et réponds avec UNIQUEMENT un JSON de ce format :
{
  "summary": "résumé en 1 phrase de ce que fera l'app",
  "sections": ["liste courte des écrans/sections à prévoir"],
  "data": ["données à afficher ou à gérer"],
  "notes": ["points d'attention éventuels"]
}
Pas d'autre texte que le JSON.`;

const PLANNER_ITERATION_SYSTEM = `Tu modifies une app web familiale existante : l'utilisateur veut faire évoluer ou corriger une app déjà en service.
Analyse la demande (et le contexte d'itération fourni) et réponds avec UNIQUEMENT un JSON de ce format :
{
  "summary": "résumé en 1 phrase de la demande (évolution ou correction)",
  "changes": ["liste des modifications à apporter, point par point"],
  "keep": ["liste des éléments existants à conserver absolument (fonctions, clés de stockage, sections)"],
  "risks": ["risques de régression ou points de vigilance (ex. clés de stockage à ne pas casser)"]
}
Pas d'autre texte que le JSON.`;

/** Prompt système du planificateur : création ou itération selon l'existence d'un HTML courant. */
function buildPlannerSystem(isIterating: boolean): string {
  return isIterating ? PLANNER_ITERATION_SYSTEM : PLANNER_SYSTEM;
}

/**
 * Un HTML complet doit se terminer par </html> (hors blancs de fin). Un
 * finish_reason "length" indique aussi une réponse coupée par la limite de tokens.
 */
/**
 * Le format stocké est un FRAGMENT (cf. les templates du dépôt) : exiger une fin
 * en `</html>` déclarait tronquée toute app correcte issue d'un template.
 * On cherche donc les signes réels d'une coupure en plein milieu.
 */
export function looksTruncatedHtml(
  html: string,
  finishReason: string | null,
): boolean {
  if (finishReason === "length") return true;
  const text = html.trim();
  if (!text) return true;
  // <script> ouvert et jamais refermé : coupure au milieu du code.
  const opened = (text.match(/<script\b/gi) ?? []).length;
  const closed = (text.match(/<\/script\s*>/gi) ?? []).length;
  if (opened !== closed) return true;
  // Coupure au milieu d'une balise.
  if (/<[a-z][^>]*$/i.test(text)) return true;
  // Un fragment valide se termine sur une balise fermante ; une coupure en
  // plein mot (« …incomp ») ne finit pas par « > ».
  return !text.endsWith(">");
}

/** Détecte un usage de stockage navigateur interdit dans l'iframe sandboxée. */
export function containsForbiddenStorage(html: string): boolean {
  return /\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/.test(html);
}

/** Détecte un pattern Alpine interdit (Alpine.data / alpine:init / window.app). */
export function containsForbiddenAlpine(html: string): boolean {
  return (
    /\bAlpine\.data\s*\(/.test(html) ||
    /alpine:init/.test(html) ||
    /\bwindow\.app\s*=/.test(html) ||
    /document\.addEventListener\s*\(\s*['"]alpine:init['"]/.test(html)
  );
}

/** Extrait le HTML d'un bloc de code markdown \`\`\`html ... \`\`\`, sinon tout le texte. */
const CLOSING_HTML = "</html>";

export function extractHtml(text: string): string {
  // Bloc markdown bien formé : ```html ... ```
  const m = text.match(/```html\s*([\s\S]*?)```/i);
  const raw = m && m[1]?.trim()
    ? m[1].trim()
    // Sinon, on retire les marqueurs ```html / ``` restés en début et fin de texte.
    : text
        .trim()
        .replace(/^```html\s*/i, "")
        .replace(/^```\s*/, "")
        .replace(/\s*```$/, "");

  // Un modèle bavard commente son travail après le document. Sans découpe, le
  // texte ne finit plus par </html> et `looksTruncatedHtml` croit à une
  // troncature alors que le HTML est complet.
  const end = raw.toLowerCase().lastIndexOf(CLOSING_HTML);
  return end === -1 ? raw : raw.slice(0, end + CLOSING_HTML.length);
}

function userContent(input: NewAppInput, prompt: string): string {
  return `Nom de l'app : ${input.name}
Description : ${input.description ?? "—"}
Demande : ${prompt}`;
}

/** Contexte d'itération pour le planificateur : clés de stockage, taille, historique. */
function plannerContext(
  previousHtml: string | null,
  history: GenerationHistoryEntry[],
): string {
  const lines: string[] = [];
  if (previousHtml) {
    const keys = extractStorageKeys(previousHtml);
    const summary = [`Contexte — l'app existe déjà :`];
    if (keys.length) summary.push(`Clés de stockage utilisées : ${keys.join(", ")}.`);
    summary.push(`Taille du HTML actuel : ${previousHtml.length} caractères.`);
    lines.push(summary.join("\n"));
  }
  const historyBlock = formatHistory(history);
  if (historyBlock) lines.push(historyBlock);
  return lines.join("\n\n");
}

/** Retire la dernière itération (user + plan courants) : déjà fournie explicitement au coder. */
function trimCurrentTurn(history: GenerationHistoryEntry[]): GenerationHistoryEntry[] {
  if (history.length < 2) return history;
  if (history[history.length - 1]?.role !== "plan") return history;
  return history.slice(0, -2);
}

/** Phase 1 : planification. Enregistre les messages user + plan. */
export async function planApp(
  appId: string,
  input: NewAppInput,
  prompt: string,
  opts: GenerateOptions = {},
): Promise<{ plan: string; model: string }> {
  const plannerModel = opts.plannerModel ?? defaultModels.planner;

  const ownerId = await getAppOwnerId(appId);
  if (!ownerId) throw new Error("App introuvable.");

  const previousHtml = await currentHtml(appId);
  const history = await listAppMessages(appId);
  const isIterating = Boolean(previousHtml);

  await addGenerationMessage({ ownerId, appId, role: "user", content: prompt });

  const t = Date.now();
  const planText = await chatCompletion(
    [
      {
        role: "system",
        content: buildPlannerSystem(isIterating) + languageInstruction(opts.locale),
      },
      {
        role: "user",
        content: `${userContent(input, prompt)}\n\n${plannerContext(previousHtml, history)}`,
      },
    ],
    {
      provider: opts.provider,
      model: plannerModel,
      maxTokens: 1024,
      userId: opts.userId ?? ownerId,
      feature: opts.feature ?? "app_plan",
      appId,
    },
  );
  if (!planText.trim() || planText.trim().length < 20) {
    throw new LlmError("Le planificateur n'a rien renvoyé (réponse vide). Réessayez avec un prompt plus précis.");
  }
  await addGenerationMessage({
    ownerId,
    appId,
    role: "plan",
    content: planText,
    model: plannerModel,
    durationMs: Date.now() - t,
  });

  return { plan: planText, model: plannerModel };
}

/** Phase 2 : implémentation du code. Enregistre le message assistant + version. */
export async function codeApp(
  appId: string,
  input: NewAppInput,
  prompt: string,
  plan: string,
  opts: GenerateOptions = {},
): Promise<GenerateResult> {
  const coderModel = opts.coderModel ?? defaultModels.coder;
  const previousHtml = await currentHtml(appId);
  const ownerId = await getAppOwnerId(appId);
  if (!ownerId) throw new Error("App introuvable.");

  const isIterating = Boolean(previousHtml);
  const history = await listAppMessages(appId);
  const historyBlock = formatHistory(trimCurrentTurn(history));

  // Le coder doit voir tout le fichier : à 10k il n'en voyait que 46% (début +
  // fin), le milieu — donc le code à modifier — étant remplacé par un marqueur.
  // L'entrée est bon marché comparée à la sortie ; le garde-fou reste très haut.
  const truncated = previousHtml ? truncateHtml(previousHtml, CONTEXT_MAX_CHARS) : null;
  const contextBlock = truncated
    ? `Voici le code actuel de l'app. Applique la demande en PATCH CIBLÉ : garde l'existant non concerné, corrige uniquement le nécessaire.\n\`\`\`html\n${truncated}\n\`\`\``
    : "C'est une nouvelle app : produis-la entièrement.";

  const t = Date.now();
  const chat = await chatWithTruncationRetry(
    [
      {
        role: "system",
        content: buildCoderSystem(isIterating) + languageInstruction(opts.locale),
      },
      {
        role: "user",
        content: `${userContent(input, prompt)}

Plan proposé :
${plan}

${historyBlock ? `${historyBlock}\n\n` : ""}${contextBlock}`,
      },
    ],
    {
      provider: opts.provider,
      model: coderModel,
      maxTokens: 16384,
      userId: opts.userId ?? ownerId,
      feature: opts.feature ?? "app_code",
      appId,
    },
    // En itération la réponse est faite de blocs d'édition : le seul signe de
    // coupure exploitable est finishReason, pas la forme du HTML.
    (text, finishReason) =>
      isIterating ? finishReason === "length" : looksTruncatedHtml(extractHtml(text), finishReason),
  );

  const coderSystem = buildCoderSystem(isIterating) + languageInstruction(opts.locale);
  const coderUser = `${userContent(input, prompt)}\n\nPlan proposé :\n${plan}\n\n${historyBlock ? `${historyBlock}\n\n` : ""}${contextBlock}`;

  let html: string;
  const resolved = await resolveWithRetry(
    { text: chat.text, finishReason: chat.finishReason },
    previousHtml,
    (extra) =>
      chatWithTruncationRetry(
        [{ role: "system", content: coderSystem }, { role: "user", content: coderUser }, ...extra],
        {
          provider: opts.provider,
          model: coderModel,
          maxTokens: 16384,
          userId: opts.userId ?? ownerId,
          feature: opts.feature ?? "app_code",
          appId,
        },
        (_t, finishReason) => finishReason === "length",
      ),
    { appId },
  );
  if (resolved.ok) {
    html = resolved.html;
  } else {
    console.warn("[generation:edit-blocks] repli sur réécriture complète", {
      appId,
      raison: resolved.reason,
    });
    const rewrite = await chatWithTruncationRetry(
      [
        { role: "system", content: buildCoderSystem(false) + languageInstruction(opts.locale) },
        {
          role: "user",
          content: `${userContent(input, prompt)}\n\nPlan proposé :\n${plan}\n\n${historyBlock ? `${historyBlock}\n\n` : ""}${contextBlock}`,
        },
      ],
      {
        provider: opts.provider,
        model: coderModel,
        maxTokens: 32768,
        userId: opts.userId ?? ownerId,
        feature: opts.feature ?? "app_code",
        appId,
      },
      (text, finishReason) => looksTruncatedHtml(extractHtml(text), finishReason),
    );
    html = extractHtml(rewrite.text);
  }

  const fixedStorage = await fixForbiddenStorage(html, opts, coderModel);
  const afterStorage = fixedStorage ?? html;
  const fixedAlpine = await fixForbiddenAlpine(afterStorage, opts, coderModel);
  const finalHtml = fixedAlpine ?? afterStorage;

  // Extraction + validation du manifeste déclaré par le code généré (si présent).
  const { extractManifestFromHtml } = await import("@/services/apps/manifest");
  const manifest = extractManifestFromHtml(finalHtml);

  const version = await createVersion(appId, {
    html: finalHtml,
    prompt,
    model: coderModel,
    manifest: manifest ? JSON.stringify(manifest) : null,
  });

  await addGenerationMessage({
    ownerId,
    appId,
    role: "assistant",
    content: chat.text,
    model: coderModel,
    versionId: version.id,
    durationMs: Date.now() - t,
  });

  return { html: finalHtml, versionId: version.id, version: version.version, plan };
}

/**
 * Passe de correction : si le code généré utilise un stockage navigateur interdit
 * (localStorage…) dans l'iframe sandboxée, on demande au coder de basculer sur
 * `homeSDK.storage.*`. Retourne le HTML corrigé, ou null si rien à corriger.
 */
async function fixForbiddenStorage(
  html: string,
  opts: GenerateOptions,
  coderModel: string,
): Promise<string | null> {
  if (!containsForbiddenStorage(html)) return null;

  const fix = await chatWithTruncationRetry(
    [
      { role: "system", content: buildCoderSystem(true) + languageInstruction(opts.locale) },
      {
        role: "user",
        content: `Le code suivant utilise \`localStorage\` / \`sessionStorage\` / \`document.cookie\`, interdits dans l'iframe sandboxée (données perdues). Remplace toute la couche de persistance par \`homeSDK.storage.*\` (get/set/list/remove, tous async — n'oublie pas les \`await\`). Garde l'UI et la logique du reste inchangées.\n\n\`\`\`html\n${html}\n\`\`\``,
      },
    ],
    {
      provider: opts.provider,
      model: coderModel,
      maxTokens: 16384,
      userId: opts.userId,
      feature: "app_fix_storage",
      appId: opts.appId ?? null,
    },
    (text, finishReason) => looksTruncatedHtml(extractHtml(text), finishReason),
  );
  const fixedHtml = extractHtml(fix.text);

  if (containsForbiddenStorage(fixedHtml)) {
    throw new LlmError(
      "Le code généré utilise encore localStorage, interdit dans l'iframe sandboxée. Corrigez manuellement ou relancez la génération.",
    );
  }
  return fixedHtml;
}

/**
 * Passe de correction : si le code généré utilise un pattern Alpine interdit
 * (Alpine.data / alpine:init / window.app), on demande au coder de basculer sur
 * `function app(){return{...}}` + `x-data="app()"`. Retourne le HTML corrigé, ou null si rien à corriger.
 */
async function fixForbiddenAlpine(
  html: string,
  opts: GenerateOptions,
  coderModel: string,
): Promise<string | null> {
  if (!containsForbiddenAlpine(html)) return null;

  const fix = await chatWithTruncationRetry(
    [
      { role: "system", content: buildCoderSystem(true) + languageInstruction(opts.locale) },
      {
        role: "user",
        content: `Le code suivant utilise \`Alpine.data\` / \`alpine:init\` / \`window.app\`, interdits par la plateforme (le binding Alpine casse). Remplace OBLIGATOIREMENT par le pattern unique : une fonction globale \`function app() { return { ... } }\` et \`x-data="app()"\\ sur la racine. Supprime tout \`Alpine.data\`, \`document.addEventListener('alpine:init')\` et \`window.app = ...\`. Garde l'UI et la logique inchangées.\n\n\`\`\`html\n${html}\n\`\`\``,
      },
    ],
    {
      provider: opts.provider,
      model: coderModel,
      maxTokens: 16384,
      userId: opts.userId,
      feature: "app_fix_alpine",
      appId: opts.appId ?? null,
    },
    (text, finishReason) => looksTruncatedHtml(extractHtml(text), finishReason),
  );
  const fixedHtml = extractHtml(fix.text);

  if (containsForbiddenAlpine(fixedHtml)) {
    throw new LlmError(
      "Le code généré utilise encore Alpine.data / alpine:init, interdit par la plateforme. Corrigez manuellement ou relancez la génération.",
    );
  }
  return fixedHtml;
}

export interface StreamCallbacks {
  onToken?: (token: string) => void;
  signal?: AbortSignal;
}

/** Phase 1 streamée : même logique que planApp mais pousse les tokens via onToken. */
export async function planAppStream(
  appId: string,
  input: NewAppInput,
  prompt: string,
  opts: GenerateOptions & StreamCallbacks = {},
): Promise<{ plan: string; model: string }> {
  const plannerModel = opts.plannerModel ?? defaultModels.planner;
  const ownerId = await getAppOwnerId(appId);
  if (!ownerId) throw new Error("App introuvable.");
  const previousHtml = await currentHtml(appId);
  const history = await listAppMessages(appId);
  const isIterating = Boolean(previousHtml);
  await addGenerationMessage({ ownerId, appId, role: "user", content: prompt });
  const t = Date.now();
  const planText = await chatCompletionStream(
    [
      { role: "system", content: buildPlannerSystem(isIterating) + languageInstruction(opts.locale) },
      { role: "user", content: `${userContent(input, prompt)}\n\n${plannerContext(previousHtml, history)}` },
    ],
    {
      provider: opts.provider,
      model: plannerModel,
      maxTokens: 1024,
      signal: opts.signal,
      onToken: opts.onToken,
      userId: opts.userId ?? ownerId,
      feature: opts.feature ?? "app_plan",
      appId,
    },
  ).then((r) => r.text);
  if (!planText.trim() || planText.trim().length < 20) {
    throw new LlmError("Le planificateur n'a rien renvoyé (réponse vide). Réessayez avec un prompt plus précis.");
  }
  await addGenerationMessage({
    ownerId,
    appId,
    role: "plan",
    content: planText,
    model: plannerModel,
    durationMs: Date.now() - t,
  });
  return { plan: planText, model: plannerModel };
}


/**
 * Résout la réponse du coder en HTML final.
 *
 * En itération, on attend des blocs d'édition : la sortie du modèle passe de
 * ~21 Ko à quelques lignes. Si les blocs ne s'appliquent pas (SEARCH introuvable
 * ou ambigu), on ne devine pas : l'appelant retombe sur la réécriture complète.
 */
function resolveCoderOutput(
  text: string,
  previousHtml: string | null,
): { ok: true; html: string; edits: number } | { ok: false; reason: string } {
  if (!previousHtml) return { ok: true, html: extractHtml(text), edits: 0 };

  const blocks = parseEditBlocks(text);
  const applied = applyEditBlocks(previousHtml, blocks);
  if (applied.ok) return { ok: true, html: applied.content, edits: applied.applied };
  return { ok: false, reason: describeFailure(applied.failure) };
}

/** 1 tentative initiale + 2 rattrapages avant de renoncer aux blocs. */
const MAX_EDIT_ATTEMPTS = 3;
/** L'écho de la réponse fautive est borné : elle peut contenir tout le fichier. */
const FAULTY_ECHO_MAX_CHARS = 2000;

export interface CoderAttempt {
  text: string;
  finishReason: string | null;
}

function editCorrectionPrompt(reason: string): string {
  return `Ta réponse n'a pas pu être appliquée : ${reason}.

Renvoie UNIQUEMENT des blocs SEARCH/REPLACE corrigés, rien d'autre.
Rappels :
- la partie SEARCH doit être copiée caractère pour caractère depuis le code actuel fourni plus haut, indentation comprise ;
- elle doit apparaître UNE SEULE FOIS dans ce code : ajoute des lignes de contexte autour pour la rendre unique ;
- ne réécris pas le fichier, ne commente pas ton travail.`;
}

/**
 * Boucle de rattrapage : quand les blocs ne s'appliquent pas, on renvoie au
 * coder sa propre sortie et la raison de l'échec, plutôt que de redemander tout
 * le fichier. C'est ce qui rend ce mécanisme fiable en pratique : le modèle
 * corrige presque toujours un SEARCH mal cité quand on lui dit lequel.
 */
async function resolveWithRetry(
  first: CoderAttempt,
  previousHtml: string | null,
  askAgain: (extra: ChatMessage[]) => Promise<CoderAttempt>,
  ctx: { appId: string },
): Promise<{ ok: true; html: string; edits: number } | { ok: false; reason: string }> {
  if (!previousHtml) return { ok: true, html: extractHtml(first.text), edits: 0 };

  const extra: ChatMessage[] = [];
  let attempt = first;

  for (let n = 1; n <= MAX_EDIT_ATTEMPTS; n++) {
    // Une réponse coupée peut contenir des blocs complets et en avoir perdu
    // d'autres : on refuse de l'appliquer partiellement.
    const outcome: { ok: true; html: string; edits: number } | { ok: false; reason: string } =
      attempt.finishReason === "length"
        ? { ok: false, reason: "réponse coupée (finishReason=length), blocs peut-être incomplets" }
        : resolveCoderOutput(attempt.text, previousHtml);

    if (outcome.ok) {
      if (n > 1) {
        console.warn("[generation:edit-blocks] appliqué au rattrapage", {
          appId: ctx.appId,
          tentative: n,
          edits: outcome.edits,
        });
      }
      return outcome;
    }
    if (n === MAX_EDIT_ATTEMPTS) return outcome;

    console.warn("[generation:edit-blocks] tentative refusée, on redemande", {
      appId: ctx.appId,
      tentative: n,
      raison: outcome.reason,
    });
    extra.push({ role: "assistant", content: attempt.text.slice(0, FAULTY_ECHO_MAX_CHARS) });
    extra.push({ role: "user", content: editCorrectionPrompt(outcome.reason) });
    attempt = await askAgain([...extra]);
  }

  return { ok: false, reason: "rattrapages épuisés" };
}

/** Phase 2 streamée : même logique que codeApp mais pousse les tokens via onToken. */
export async function codeAppStream(
  appId: string,
  input: NewAppInput,
  prompt: string,
  plan: string,
  opts: GenerateOptions & StreamCallbacks = {},
): Promise<GenerateResult> {
  const coderModel = opts.coderModel ?? defaultModels.coder;
  const previousHtml = await currentHtml(appId);
  const ownerId = await getAppOwnerId(appId);
  if (!ownerId) throw new Error("App introuvable.");
  const isIterating = Boolean(previousHtml);
  const history = await listAppMessages(appId);
  const historyBlock = formatHistory(trimCurrentTurn(history));
  const truncatedStream = previousHtml ? truncateHtml(previousHtml, CONTEXT_MAX_CHARS) : null;
  const contextBlock = truncatedStream
    ? `Voici le code actuel de l'app. Applique la demande en PATCH CIBLÉ : garde l'existant non concerné, corrige uniquement le nécessaire.\n\`\`\`html\n${truncatedStream}\n\`\`\``
    : "C'est une nouvelle app : produis-la entièrement.";
  const t = Date.now();
  // Utilise le streaming avec retry manuel (pas de double budget automatique en stream pour simplifier)
  let fullText = "";
  let finishReason: string | null = null;
  const streamResult = await chatCompletionStream(
    [
      { role: "system", content: buildCoderSystem(isIterating) + languageInstruction(opts.locale) },
      {
        role: "user",
        content: `${userContent(input, prompt)}\n\nPlan proposé :\n${plan}\n\n${historyBlock ? `${historyBlock}\n\n` : ""}${contextBlock}`,
      },
    ],
    {
      provider: opts.provider,
      model: coderModel,
      maxTokens: 16384,
      signal: opts.signal,
      onToken: opts.onToken,
      userId: opts.userId ?? ownerId,
      feature: opts.feature ?? "app_code",
      appId,
    },
  );
  fullText = streamResult.text;
  finishReason = streamResult.finishReason;

  const coderSystem = buildCoderSystem(isIterating) + languageInstruction(opts.locale);
  const coderUser = `${userContent(input, prompt)}\n\nPlan proposé :\n${plan}\n\n${historyBlock ? `${historyBlock}\n\n` : ""}${contextBlock}`;

  // Chemin normal en itération : appliquer les blocs, avec rattrapage si besoin.
  let html: string;
  const resolved = await resolveWithRetry(
    { text: fullText, finishReason },
    previousHtml,
    (extra) =>
      chatCompletionStream(
        [{ role: "system", content: coderSystem }, { role: "user", content: coderUser }, ...extra],
        {
          provider: opts.provider,
          model: coderModel,
          maxTokens: 16384,
          signal: opts.signal,
          onToken: opts.onToken,
          userId: opts.userId ?? ownerId,
          feature: opts.feature ?? "app_code",
          appId,
        },
      ),
    { appId },
  );
  if (resolved.ok) {
    html = resolved.html;
  } else {
    // Les blocs n'ont pas pu s'appliquer : on ne devine pas, on redemande le
    // fichier entier. Lent mais sûr, et le log dit ce qui a échoué.
    console.warn("[generation:edit-blocks] repli sur réécriture complète", {
      appId,
      raison: resolved.reason,
    });
    const rewrite = await chatCompletionStream(
      [
        {
          role: "system",
          content: buildCoderSystem(false) + languageInstruction(opts.locale),
        },
        {
          role: "user",
          content: `${userContent(input, prompt)}\n\nPlan proposé :\n${plan}\n\n${historyBlock ? `${historyBlock}\n\n` : ""}${contextBlock}`,
        },
      ],
      {
        provider: opts.provider,
        model: coderModel,
        maxTokens: 32768,
        signal: opts.signal,
        onToken: opts.onToken,
        userId: opts.userId ?? ownerId,
        feature: "app_code",
        appId,
      },
    );
    if (looksTruncatedHtml(extractHtml(rewrite.text), rewrite.finishReason)) {
      throw new LlmError("Réponse du modèle tronquée (limite de tokens atteinte). Réessayez.");
    }
    html = extractHtml(rewrite.text);
  }
  const fixedStorage = await fixForbiddenStorage(html, opts, coderModel);
  const afterStorage = fixedStorage ?? html;
  const fixedAlpine = await fixForbiddenAlpine(afterStorage, opts, coderModel);
  const finalHtml = fixedAlpine ?? afterStorage;
  const { extractManifestFromHtml } = await import("@/services/apps/manifest");
  const manifest = extractManifestFromHtml(finalHtml);
  const version = await createVersion(appId, {
    html: finalHtml,
    prompt,
    model: coderModel,
    manifest: manifest ? JSON.stringify(manifest) : null,
  });
  await addGenerationMessage({
    ownerId,
    appId,
    role: "assistant",
    content: fullText,
    model: coderModel,
    versionId: version.id,
    durationMs: Date.now() - t,
  });
  return { html: finalHtml, versionId: version.id, version: version.version, plan };
}