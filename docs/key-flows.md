# Key flows (home-ai)

Step-by-step traces of the three flows that are not obvious from the file
layout. File paths at each hop. Module locations: `docs/architecture.md`.

## 1. App generation (prompt → HTML)

The "Lovable core". Two LLM phases, both orchestrated by `src/services/generation/app.ts`. Depuis la migration, le chat embarqué a été supprimé : création et itérations passent par l'assistant global avec contexte strict + plan éditable (carte PlanCard).

1. User clique « Modifier avec l'assistant » (ou « Créer avec l'assistant ») dans `src/components/AppEditor.tsx` / `src/components/AppsList.tsx` / `src/components/ScriptsManager.tsx` → ouvre l'overlay scopé (`AppShell` → `AgentContext` → `openAssistant({appId|scriptId}, query)`).
2. En mode scopé, `POST /api/assistant/chat` avec `{id, message, scope}` → `runTurn(..., scope)` réutilise le fil lié (résolu côté client via `getThreadByContext`), injecte l'artefact (`buildScopeBlock` : HTML tronqué + clés `<!-- storage: -->` via `truncateHtml`/`extractStorageKeys`, ou code script via `truncateCode`) dans `buildSystemPrompt`. L'assistant appelle `plan_app` (→ `planApp`) puis affiche la **PlanCard** (`src/components/agent/parts/PlanCardPart.tsx`) ; l'utilisateur édite puis « Générer le code » → message `Applique le plan validé …` → `generate_app` (avec `plan` optionnel, sinon re-plan) → `codeApp`.
   Le flux direct `POST /api/apps/[id]/generate/plan` → `planApp` + `POST /api/apps/[id]/generate/code` → `codeApp` reste l'implémentation sous-jacente (utilisée par les tools), mais plus appelé directement par l'UI.
    Détail `planApp` :
    - stores the user message (`addMessage`, role `user`),
    - one LLM call with the **planner model** (`glm-5.3` by default, maxTokens 1024)
      using the `PLANNER_SYSTEM` prompt (**mode itération** `PLANNER_ITERATION_SYSTEM`
      si l'app a déjà un HTML courant : plan au format `{changes, keep, risks}`
      au lieu de `{sections, data}`),
    - en mode itération, le planificateur reçoit aussi les clés de stockage
      déclarées (`<!-- storage: ... -->`), la taille du HTML courant et
      l'historique des échanges précédents (`formatHistory`, messages `assistant`
      exclus — leur contenu est le HTML),
    - stores the result as role `plan`.
   Détail `codeApp` : `POST /api/apps/[id]/generate/code` → `codeApp(appId, input, prompt, plan)`
   - loads the app's current HTML (`currentHtml`) — if present, the coder is told
     to *edit* it rather than rewrite from scratch (iterative refinement),
   - le coder reçoit l'historique (dernière itération retirée, déjà transmise via
     `prompt`+`plan`), le HTML courant (tronqué via `truncateHtml` s'il dépasse
     ~15 ko) et, en mode itération, une consigne **PATCH CIBLÉ** : ne réécrire
     que le nécessaire, préserver les clés de stockage, le manifeste et le
     commentaire `<!-- storage: ... -->`,
   - one LLM call with the **coder model** (`deepseek-v4-flash`, maxTokens 16384),
   - **truncation guard**: if the response hits the token limit (`finish_reason`
     `length`) or the extracted HTML doesn't end with `</html>`, it auto-retries
     **once** with doubled tokens; if still truncated it throws instead of
     saving a broken version,
   - **`extractHtml()`** pulls the HTML out of the ```html markdown block,
    - **storage guard**: the CODER prompt forbids `localStorage` /
      `sessionStorage` / `IndexedDB` / `document.cookie` (iframe sandboxée, origine
      opaque). Si le HTML généré en utilise quand même, `fixForbiddenStorage()` fait
      un appel de correction LLM pour basculer sur `homeSDK.storage.*` (get/set/list/remove) ;
      si le fixé en utilise encore, une `LlmError` est levée au lieu de sauvegarder,
    - **Alpine guard**: même pattern pour `Alpine.data` / `alpine:init` / `window.app` (`containsForbiddenAlpine` → `fixForbiddenAlpine`). Le prompt CODER impose `function app(){return{...}}` + `x-data="app()"` ; si le HTML généré utilise l'API interdite, un second appel LLM corrige le bootstrap.
    - **`createVersion()`** saves a row in `app_versions` and points
      `apps.currentVersionId` at it; assistant message stored in `app_messages`.
 3. The preview refreshes by fetching `/api/apps/[id]/html` (bouton « Actualiser l'aperçu » dans `AppEditor`) and rendering it in the sandboxed iframe.

Model/provider resolution: user overrides in `user_settings`
(`getEffectiveDefaults`) → else env defaults; API keys via `resolveApiKey`
(db row wins over env).

Script generation mirrors the app pattern (depuis le plan gate) : deux phases
`planScript` → `codeScript` dans `src/services/generation/script.ts` (`planScript(Stream)`,
`codeScript(Stream)`, prompts PLANNER/CODER). L'UI s'arrête sur un **plan éditable**
(bouton « Générer le code ») avant de créer le script — même mécanique que les apps.
Le prompt (CODER/PLANNER) est construit selon le **trigger** (`triggerKind`) :
`schedule` impose une expression cron 5 champs, `manual`/`webhook` n'ont pas de
`schedule` (le JSON généré l'omet). Les routes sont
`POST /api/scripts/generate/plan/stream` + `/generate/stream` (création, `triggerKind`
dans le body) et `POST /api/scripts/[id]/generate/plan/stream` + `/generate/stream`
(itération). L'assistant et le MCP gardent la passe unique `generateScript` (prompt → script,
avec `triggerKind` optionnel) ; le code cap à maxTokens 4096 avec la même
troncature-retry (limite de tokens seule), un JSON coupé jette plutôt que de créer
un script par défaut.

## 2. Serving an app (`/a/<slug>` + homeSDK RPC)

How a stored HTML string becomes a live app talking to real services.

1. `src/app/a/[slug]/page.tsx`: requires login, loads the app by slug for the
   viewer (visibility private/family), reads its current HTML.
2. **`buildAppDocument(html, appId)`** in `src/lib/app-runtime.ts` wraps it into
   a full document:
   - CSP meta tag: `default-src 'none'`, CDN only jsdelivr, `connect-src 'none'`,
     `form-action 'none'` — no direct network/cookies from the iframe,
   - Tailwind 4 browser build + Alpine.js 3 + Chart.js 4 (global `Chart`) from `cdn.jsdelivr.net`,
   - the inline `BRIDGE` script defining `window.homeSDK`.
3. The page renders inside `src/components/AppFrame.tsx`: sandboxed iframe
   (`allow-scripts allow-forms allow-modals`, opaque origin).
4. Generated code calls e.g. `homeSDK.storage.get("x")` → bridge does
   `window.parent.postMessage({ type: "homesdk", method, args })`. Args are
   JSON-cloned first (Alpine proxies can't be cloned). Default timeout 3s,
   60s for `ai.*` methods.
5. Parent page relays to `POST /api/apps/[id]/rpc` → **`bridgeRpc.handle(method, args, { appId, ownerId })`**
    dispatch via **registry** : `getMethod(method)` → `getProvider(type)` → `methods[methodKey](cfg, ...args)`. Couvre `storage.*` (dont `storage.table.add/update/remove/toggle` — CRUD ligne atomique sur une valeur table), `storage.global.*` (KV partagé entre apps, résolu par l'owner), `google.*`, `mail.*`, `telegram.*`, `notion.*`, `homeassistant.*`, `weather.*`, `webhook.*`, `http.*`, `ai.*`. Résolution par le **owner** (pas le viewer).
6. Result goes back down the same path as `{ type: "homesdk-result" }`.

Key consequence: an app always acts *as its owner* — family members viewing it
use the owner's Google account / mailboxes.

## 3. Script execution (anciennement « Script »)

Un script serveur est déclenché par trois triggers possibles — le moteur d'exécution
est le même (`runScript`) :

1. **`schedule`** (défaut) : `src/instrumentation.ts` (`register()`) start a poller
   on server boot: every **30s** calls **`runDueScripts()`** in `src/services/scripts/runner.ts`.
   `runDueScripts()` ne ramasse que les scripts `triggerKind = 'schedule'` et `enabled`
   dont `nextRunAt` est due (`computeNextRun` parses the 5-field schedule via cron-parser,
   in `src/services/scripts/scripts.ts`).
2. **`manual`** : `POST /api/scripts/[id]/run` (bouton « Exécuter ») → `runScript(scriptId)`.
3. **`webhook`** : `POST /api/hooks/<webhookSlug>` (route publique, authentifiée par
   l'en-tête `x-webhook-secret`) → `runScript(scriptId, { payload })`. Le corps JSON du
   webhook est exposé au code via `home.webhook.payload` ; un script désactivé répond
   `{ ok: true, skipped: true }`.

Each run goes through **`runScript(scriptId, opts?)`**:
   - builds the SDK with **`buildScriptSdk(ownerId, {scriptId, runId, webhookPayload})`** (`scripts/sdk.ts`,
      same methods as `homeSDK`, direct calls). `home.storage.*` vise toujours
      `script_storage` (clé `scriptId`) ; pour toucher le stockage d'une app le
      script passe par `home.app(appId).storage.*`, qui revérifie l'accès à chaque appel.
    - executes `async function main(home) {...}` from `scripts.code` inside
      **`node:vm`** with a 60s timeout,
    - `home.browser.*` ouvre des sessions Lightpanda locales via CDP ; les
      sessions sont liées au `runId` et toujours fermées en fin de run,
   - writes status/output/error/duration to **`script_runs`**
     (`success` | `error` | `timeout`), updates `scripts.lastRunAt` / `nextRunAt`
     (`nextRunAt` reste `null` pour un script non planifié).
4. Every update to a script snapshots its state into `script_versions`
   (restorable via `restoreScriptVersion`).

### Flow d'exécution (traçage + pragmas `home.step`)

Le run est tracé : chaque appel `home.*` devient un span `call`, chaque groupe
`home.step("Label", fn)` un span `step` (les appels faits dans `fn` deviennent
ses enfants), chaque `console.log` un span `log`. Le tout est stocké dans
**`script_run_spans`** (`(runId, parentId)` = arbre) et affiché comme timeline
n8n-like par `src/components/ScriptFlow.tsx` (bouton « Flow » sur chaque run).

1. `createTracedHome(ownerId, appId|null, runId, scriptId?)` (`src/services/scripts/traced-sdk.ts`)
   enveloppe le SDK d'un Proxy : méthodes feuilles enregistrées (durée, args,
   résultat/erreur, `parentId` = step courant), `home.step` pousse/relève un
   span `step`, `console` intercepté pousse des spans `log`.
2. `runScript` (`src/services/scripts/runner.ts`) persiste les spans après le run
   et applique la rétention (50 derniers runs par script).
3. `GET /api/scripts/[id]/runs/[runId]` retourne `{ run, spans }` (access check
   via `getScriptWithApp`).

Pragmas : `home.step` est volontaire — sans lui le moteur trace quand même
chaque appel. Le commentaire `// @step Label` (portée implicite jusqu'au
prochain `// @step` ou fin de run, `// @endstep` optionnel) est transformé par
`transformPragmas` dans `runner.ts` vers `home.__pushStep` / `__popStep`
(auto-pop). `home.step` et `__pushStep`/`__popStep` sont **script-only** — pas
présents dans le bridge iframe `homeSDK`.

`node:vm` is a mitigation, not a security boundary (accepted family risk).

## 4. Assistant global (chat de pilotage de la plateforme)

L'assistant est un agent conversationnel qui pilote apps + scripts + dashboards + connexions dans un seul fil par utilisateur. Il réutilise les mêmes services que REST et MCP.

Le moteur est le **Vercel AI SDK v7** utilisé sans surcouche : `streamText` + `tool()` typés,
`toUIMessageStream`, et une seule écriture en base à la fin du tour.

1. **UI** — page `src/app/assistant/[[...threadId]]` (serveur : charge le fil + la liste des conversations, passés en props) ou drawer `agent/Overlay.tsx` (⌘J). `agent/ChatView.tsx` utilise `useChat` + `DefaultChatTransport` → `POST /api/assistant/chat`. `prepareSendMessagesRequest` n'envoie que `{ id, message, scope?, locale }` : **le dernier message seulement**, le serveur détient l'historique. L'**id du fil est choisi par le client** (uuid rendu par le serveur pour un fil neuf) et stable d'un tour à l'autre — rien ne doit donc remonter pendant le stream. Le scope `{appId,scriptId,storage?}` vient des boutons « Modifier/Créer avec l'assistant » (`AppShell` → `AgentContext` → `openAssistant(scope, query)`).
2. **`POST /api/assistant/chat`** (`src/app/api/assistant/chat/route.ts`) : valide le corps (zod) puis le message (`validateUIMessages`), refuse un prompt vide ou > 32k caractères, vérifie l'accès au scope (`getApp` / `getScriptWithApp`) car le prompt va en exposer le contenu, puis `ensureThread(userId, id, titre, contexte)` — crée le fil sous l'id du client, refuse l'id d'un autre utilisateur.
3. **`runTurn`** (`src/services/agent/turn.ts`) :
   - recharge l'historique (`loadMessages`) et y ajoute le nouveau message ;
   - en parallèle : `getEffectiveDefaults`, `listApps`, l'**état utilisateur** (`getUserStateGraph` → `formatGraphBlock`, ~2000c — voir §7) et le **contexte scopé** (`buildScopeBlock` : HTML tronqué + clés storage, ou code du script, ou contenu de la clé storage demandée) ;
   - construit le system prompt (`buildSystemPrompt`) et le modèle (`getAgentModel` : provider + `extractReasoningMiddleware({ tagName: "think" })`, qui remplace tout parsing manuel des balises `<think>`) ;
   - `streamText({ model, system, messages: await convertToModelMessages(messages, { tools, ignoreIncompleteToolCalls: true }), tools, stopWhen: stepCountIs(8) })`. `ignoreIncompleteToolCalls` absorbe un tour précédent interrompu — plus besoin de fabriquer des faux résultats d'outil ;
   - `toUIMessageStream({ stream, originalMessages, generateMessageId, onEnd })` : le protocole UIMessage est produit par le SDK, pas écrit à la main. **`onEnd` est le seul point de persistance** : il reçoit la liste complète mise à jour et la réécrit (`saveMessages`, upsert par id), ce qui rend impossible tout désaccord entre ce qui a été streamé et ce qui est stocké ;
   - puis, hors chemin critique, `runPostTurn` : extraction mémoire (`buildExtractionPrompt` → `addMemory` source `auto`) et titre du fil si c'est le premier tour.
4. Les **relances** ont leur propre route (`POST /api/assistant/suggestions`), appelée par le client quand le tour est fini : elles ne retardent plus la fermeture du stream ni la persistance de la réponse.
5. Les **outils** viennent du registre partagé (`src/services/tools/registry.ts`), adaptés en `ToolSet` typé par `src/services/agent/tools.ts` (+ outils de manifeste `app_<slug>__<tool>`) :
   - connexions : `list_connections`, `call_connection_method` (délègue à `bridgeRpc.handle` via `methodRegistry`) ;
   - apps : `list_apps`/`get_app`/`get_app_html`/`create_app`/`update_app`/`delete_app`/`plan_app` + `generate_app` (enchaîne `planApp`→`codeApp` ; PlanCard éditable côté UI) ;
   - scripts : `list_scripts`/`create_script`/`plan_script`/`generate_script`/`update_script`/`delete_script`/`run_script`/`list_script_runs` ;
   - dashboards : `list_dashboards`/`get_dashboard`/`create_dashboard`/`update_dashboard`/`delete_dashboard`/`add_dashboard_widget`/`remove_dashboard_widget` ;
   - assistant : `memory_list`/`memory_save`/`memory_delete`, `platform_overview`, `user_state_graph`, `generate_brief`.
   Un outil qui échoue **lève** : le SDK produit alors une part `tool-output-error`. C'est la seule source de vérité sur l'échec (avant, le statut était deviné en cherchant `"error"` dans la sortie sérialisée, ce qui marquait en échec tout résultat contenant ce mot — `list_script_runs` a une colonne `error`).
6. Persisté dans `agent_threads` + `agent_messages` (une ligne = un `UIMessage`, `parts` en JSON) + `assistant_memory`. Threads via `GET /api/assistant/threads` + `GET /api/assistant/threads/[id]` (→ `messages: UIMessage[]`, relus tels quels), mémoire via `GET/POST /api/assistant/memory` + `PATCH/DELETE /api/assistant/memory/[id]` (même garde `requireUser` que REST/MCP). L'UI mémoire vit dans Paramètres. Le drawer scopé résout d'abord le fil `app`/`script` existant (historique visible), sinon part sur un id neuf.

**Entrypoint global** : `AppShell` (`src/components/AppShell.tsx`) monte deux composants partout :
- `CommandPalette` (`src/components/CommandPalette.tsx`) — ⌘K : fetch `GET /api/apps` + `/api/scripts` + `/api/dashboards` + `/api/templates` (filtrage client), groupes Navigation/Apps/Scripts/Tableaux/Modèles, item « Demander à l'assistant : <query> » qui ouvre le drawer. Navigation via `router.push`, clavier ↑↓/Entrée/Échap. Les templates déjà installées sont marquées « installé ».
- `AssistantOverlay` (`src/components/agent/Overlay.tsx`) — ⌘J : slide-over droite (max 440px), même `ChatView` que la page plein écran + bandeau scope + chips de relance, `scope` transmis dans le body, réutilisation du fil `app`/`script`. Boutons « Modifier/Créer avec l'assistant » dans `AppEditor`, `ScriptsManager`, `AppsList`, `StorageExplorer`. Query initiale depuis la palette ou les boutons auto-envoie le message.

**Vue d'ensemble & brief** : tools `platform_overview` (`src/services/agent/overview.ts` → `getPlatformOverview`: counts, scriptsHealth avec dernier run, apps/dashboards, recentStorages 5 plus récents, memories, threads) et `generate_brief` (`src/services/agent/brief.ts` : overview + agenda/météo best-effort via `bridgeRpc` → prompt → `chatCompletion` → `appendMessage` dans le fil « Journal », identifié par `contextKind: "journal"` plutôt que par son titre). API `GET /api/assistant/overview` et `POST /api/assistant/brief` (`GET` pour le dernier brief). Planification via `runDueBriefs` dans `src/instrumentation.ts` (toutes les 5min, 1 fois/jour après `briefHour`, maj `user_settings.briefLastRunAt`), configurable dans Paramètres → Brief quotidien.

`node:vm` et les garde-fous d'outil (validation zod, `destructive` → confirmation demandée dans le system prompt, résultat tronqué à 8000 chars) sont des mitigations, pas des barrières de sécurité dures (usage familial).

## 5. Data Studio (explorateur de stockage)

Le « Data Studio » est l'explorateur unifié des trois stockages KV
(`app_storage`, `global_storage`, `script_storage`) dans `src/components/StorageExplorer.tsx`.
Un seul composant, périmètres filtrés (App / Global / Script) :

1. Chargement : selon les props `appId`/`scriptId`, il appelle `GET /api/apps/[id]/storage`,
   `GET /api/global-storage` et/ou `GET /api/scripts/[id]/storage`. Le serveur renvoie
   `kind`, `schema` et `updatedAt` par clé (`kind` d'inférence locale en secours via
   `inferKind`). La prop `showScope` cadre le périmètre par point d'appel : l'éditeur
   d'app passe `"app"` (stockage de l'app seul), le panneau Stockage d'un script
   `"local"` (script + app liée, sans global), la page `/storage` `"app"` ou global selon
   l'app sélectionnée. `"all"` ne sert plus qu'en secours.
2. Édition : une clé `table` s'édite dans la grille **TableEditor**
   (`src/components/storage/TableEditor.tsx`, TanStack Table headless) — pagination
   50/page, tri en vue, sélection multiple + duplication/suppression groupées,
   colonnes ajoutables/renommées/déplaçables/supprimables, éditeurs de cellules
   typés (schéma déclaré sinon `inferColumnType`), ids de lignes générés côté client.
   Les autres clés restent en JSON. Tout est brouillon : rien n'écrit avant le bouton
   « Enregistrer » (garde-fou confirmation à la fermeture si modifié).
3. Sauvegarde = POST valeur entière + `baseUpdatedAt` : si la clé a changé ailleurs
   entre-temps, le serveur répond **409 `storageConflict`** et propose de recharger.
   CSV import/export via `parseCsv`/`toCsv` avec aperçu (remplacement ou ajout en fin
   du brouillon). Schéma éditable en JSON Schema sous la grille, bouton « Déduire »
   via `inferJsonSchema(rows)`.
4. Création : le formulaire « nouvelle clé » de type `table` propose un constructeur
   de colonnes (nom + type) qui écrit une valeur `[]` et un `schema`
   `{type:"object", properties}` — plus de JSON à la main.
5. CRUD ligne côté apps/scripts/MCP : les opérations `add/update/remove/removeMany/toggle`
   passent par `applyRowOp` (`src/lib/storage-table.ts`) exécuté **en transaction** par
   les services (`storageRowOp` / `globalStorageRowOp` / `scriptStorageRowOp`) ;
   exposées au REST (`PATCH .../storage`), aux tools de manifeste (append/remove/toggle
   délèguent désormais à `storageRowOp`) et aux SDK `homeSDK.storage.table.*` /
   `home.storage.table.*`.
6. **Jeu d'essai** : `POST /api/storage/seed` appelle le LLM du propriétaire et écrit
   selon le scope comme avant.
7. **Garde-fou** : l'explorateur lit le HTML de l'app (`GET /api/apps/[id]/html`) pour
   extraire les clés déclarées (`<!-- storage: ... -->`) et affiche « orpheline »
   (stockée mais non déclarée) / « manquante » (déclarée mais absente).

NB atomicité : la colonne `updatedAt` est stockée en **secondes** (drizzle mode
timestamp) — les anti-conflits comparent à la seconde près ; deux écritures dans la
même seconde sont indiscernables.

## 6. Presets de planification

`src/lib/natural-script.ts` fournit `SCRIPT_PRESETS` (chips qui remplissent le champ
schedule d'un script) + `isValidScript` (valide via `previewSchedule`). Pas de parser
LLM pour l'instant : le planificateur (`planScript`) renvoie un `scheduleIntent` en
langage naturel que le coder convertit en expression 5 champs.

## 7. User State Graph (représentation de l'état utilisateur)

Une **vue dérivée** (lecture seule, jamais écrite) qui relie ce que la plateforme
sait d'un utilisateur, pour aider l'assistant à personnaliser ses réponses et
servir de page de debug (`/state`). Modules dans `src/services/user-state/`.

1. `GET /api/user-state` → **`getUserStateGraph(userId)`** (`graph.ts`) : charge
   en parallèle les données **propres à l'utilisateur** (ownerId = userId —
   jamais les apps/scripts des autres membres), construit noeuds + arêtes :
   - noeuds : `user`, `connection`, `app`, `script`, `storage:{app|global|script}:…`,
     `memory`, `thread` (scopés app/script), `signal` ;
   - arêtes : `OWNS` (user→tout), `ATTACHED_TO` (script→app), `STORES`
     (app/script/user→storage), `RELATES_TO` (mémoire→app/storage par **mots-clés**,
     `match.ts`), `ROUTINE` (script→signal routine via `describeSchedule`,
     `schedule.ts`), `HEALTH` (signal→script en échec / connexion non active),
     `INTEREST` (≥2 souvenirs liés à une même app → signal), `ACTIVITY`
     (thread scopé → app/script) ;
   - aucun appel LLM : tout est déterministe.
2. **Injection prompt** : à chaque tour (`runTurn` dans `agent/turn.ts`),
   `formatGraphBlock(graph)` (`context.ts`) produit un bloc compact (~2000c,
   priorité intérêts → routines → santé → capacités) injecté dans
   `buildSystemPrompt({ locale, stateBlock, scopeBlock, destructiveTools })`
   (`agent/prompt.ts`). Les ids de souvenirs
   référencés alimentent `touchMemory` (usage tracking) — remplace l'ancien
   bloc mémoire plat `formatMemoryBlock`.
3. **Tool assistant** : `user_state_graph` (read-only) renvoie le JSON du graphe
   pour « que sais-tu de moi ? », « quels sont mes projets/routines ? ».
4. **UI debug** : `/state` (`src/app/(app)/state/page.tsx`) — filtres par type /
   recherche, table des noeuds (avec badges signal) + table des liens.

Taille attendue : 30-150 noeuds / 50-300 arêtes par user. Pas de cache ni de
persistance en V1 : le graphe se recalcule à la demande (toujours frais).
Le graphe est strictement scopé par `userId` — aucune donnée d'un autre membre.

## Common tasks

### Add an API route
Create `src/app/api/<group>/<route>/route.ts`; keep it thin (parse → service →
JSON); errors go through `apiError(err)`. Business logic belongs in
`src/services/` (+ co-located test).

### Add an admin-only capability
1. Déclarer la permission dans `PERMISSIONS` (`src/lib/rbac.ts`)
2. L'attribuer au rôle `admin` dans `ROLE_PERMISSIONS` (même fichier)
3. En tête du handler : `await requirePermission("<permission>")`
   (`src/lib/session.ts`) — renvoie 401/403 via `apiError`
4. UI : masquer l'entrée de nav / la section avec `can(session.user.role, "<permission>")`

La gestion des membres (liste + rôles) n'a **pas** de routes maison :
`authClient.admin.listUsers/setRole` passe par le catch-all better-auth, qui
vérifie lui-même le rôle admin côté serveur.

### Let an external agent (REST / MCP) call home-ai

Un agent externe s'authentifie par **token d'accès personnel** (Bearer), pas par
session cookie. Deux entrées, un seul garde (`requireUser` dans
`src/lib/session.ts`, qui accepte cookie **ou** Bearer) :

- **REST** : n'importe quelle route `/api/*` avec `Authorization: Bearer hai_...`.
- **MCP** : `POST /api/mcp` (Streamable HTTP stateless), outils dans
  `src/services/mcp/server.ts` (+ historique `services/mcp/calls.ts` : `logMcpCall`/`listMcpCalls` → table `mcp_tool_calls`). Préférer MCP si l'agent parle MCP (découverte +
  schémas), sinon REST directement.
- **Diagnostic MCP** : `GET /api/mcp/tools` (catalogue sérialisé), `GET /api/mcp/calls?limit=50` (historique par `userId`), page `Paramètres → MCP` (`settings/mcp` — URL, snippets hermes/Claude, catalogue filtrable, activité récente).

Workflow :
1. Mint un token : UI Paramètres → Accès → Tokens, ou `POST /api/tokens` (jwt montré une fois). Voir l'URL et les snippets dans `Paramètres → MCP`.
2. L'agent l'envoie en `Authorization: Bearer` sur ses appels (`lastUsedAt` + `mcp_tool_calls.tokenPrefix` mis à jour).
3. Révoquer : `DELETE /api/tokens/[id]` (soft delete via `revokedAt`). Debug : `GET /api/mcp/calls` ou onglet MCP → Activité récente.

Ajouter un outil MCP = le définir dans le `tools.ts` de son domaine puis l'ajouter à `toolRegistry` (`services/tools/registry.ts`) — `buildMcpServer(userId, {tokenPrefix})` l'expose et le trace seul. Les tools d'app viennent du manifeste (`app_<slug>__<tool>` via `registerManifestTools`), vérif propriété (`getApp`/`getScriptWithApp`) avant d'agir.

### Add/change a DB column
Edit `src/db/schema.ts` → `npm run db:generate` (creates SQL in `drizzle/`) →
`npm run db:migrate`. SQLite only.

### Extend `homeSDK` (new capability for generated apps)
**Depuis le refactor registry :** 1 seul endroit à toucher :

1. Crée `src/services/connections/<type>.ts` qui exporte `<type>Provider` : `schema` zod + `test` + `sdk: {namespace, methods}` + `ui`. Ajoute 1 ligne dans `src/services/connections/registry.ts` (`connectionRegistry.set(...)`).
2. Le reste est automatique : `BRIDGE` (généré via `methodRegistry`), `bridgeRpc.handle()` (lookup), `buildScriptSdk` (boucle), prompts LLM (`getSdkPromptLines()`), `POST /api/connections` (validation zod), tests (`methodRegistry`).
3. Ajoute un test de provider (`registry.test.ts` ou co-located) + cas `bridgeRpc` si méthode critique.

Exception : `home.step` / `__pushStep` / `__popStep` sont **script-only** (futur
pragmas `// @step`) — ajoutés dans `src/services/scripts/traced-sdk.ts`, pas dans
le bridge iframe. Voir §3 « Flow d'exécution ».
`http.fetch` et `browser.*` restent **hors registry** (pas de `type`, garde SSRF partagée dans `src/lib/ssrf.ts`).

Timeouts: non-`ai.` methods get 3s; prefix a slow method with `ai.` to get 60s.
