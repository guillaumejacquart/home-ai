# Architecture map (home-ai)

Factual map of where things live. Read this before exploring `src/` — it should
save you most of the grep work. Step-by-step flows are in `docs/key-flows.md`.

> Keep this file in sync when you move/rename/add modules or tables
> (see "Keeping docs current" in AGENTS.md).

## Folder layout

| Folder | Purpose |
|---|---|
| `src/app/` | Next.js App Router: pages + API routes |
| `src/app/(app)/settings/` | Paramètres : un **segment de route par onglet** (`general`, `intelligence`, `memory`, `access`, `mcp`, `usage`). `layout.tsx` porte l'en-tête + la navigation, `page.tsx` redirige vers `general`. Chaque onglet ne charge que ses propres données ; état partagé et types dans `src/components/settings/shared.ts` (`useSettings`, `useAction`, `useSyncFrom`, `putSettings`) |
| `src/app/a/[slug]/` | Serves a generated app inside its sandboxed iframe page |
| `src/app/d/[slug]/` | Serves a dashboard with 12-col grid of live app iframes |
| `src/app/api/` | REST routes (`auth`, `apps`, `connections`, `scripts`, `settings`, `dashboards`, `tokens`, `templates`, `assistant`) + webhooks entrants publics (`hooks`) + endpoint MCP (`mcp` : `POST /` Streamable HTTP + `GET /tools` catalogue + `GET /calls` historique) |
| `src/app/assistant/` | Assistant global — UI dédiée plein écran `assistant/[[...threadId]]` (catch-all : `/assistant` = nouvelle conversation, `/assistant/<id>` = fil existant) + API (`assistant`, `assistant/threads`) |
| `src/components/` | React UI; primitives in `src/components/ui`, global entrypoints `CommandPalette.tsx` (⌘K) + `agent/Overlay.tsx` (⌘J) + `agent/AgentContext.tsx` (scope) montés dans `AppShell`, `agent/*` (chat, sidebar, parts) + `chat/Markdown.tsx` |
| `src/components/agent/` | UI de l'assistant : `ChatView.tsx` (`useChat` + rendu par type de part), `ThreadSidebar.tsx` (présentationnel, liste fournie par le serveur), `Overlay.tsx` (drawer contextuel ⌘J), `AgentContext.tsx` (scope + ouverture), `parts/` (Reasoning, Tool, PlanCard) |
| `src/components/scripts/` | Pièces extraites de `ScriptsManager` : `types.ts` (types partagés + `RUN_VARIANT`), `SchedulePreview.tsx`, `RunRow.tsx` |
| `src/components/settings/` | `shared.ts` : types de `/api/settings` + `useSettings`/`useAction`/`useSyncFrom`/`putSettings`, partagés par les onglets |
| `src/db/` | Drizzle schema, client, migration runner |
| `src/lib/` | Framework-agnostic helpers (runtime bridge, auth config, errors, crypto, env) + la frontière HTTP : `route.ts` (routes API) et `api-client.ts`/`use-resource.ts` (côté React) |
| `src/services/` | Business logic grouped by domain folders (`apps/`, `agent/`, `browser/`, `scripts/`, `connections/`, `generation/`, `llm/`, `storage/`, `templates/`, `user-state/`) — API routes stay thin and delegate here |
| `templates/` | Prebuilt app templates: `templates/<slug>/{template.json, app.html}` — `todo`, `budget` (Chart.js), `planning`, `notes` — installed on demand via `installTemplate` |
| `drizzle/` | Generated SQL migrations |

## Services (`src/services/`, grouped by domain)

### `apps/`

| File | Purpose |
|---|---|
| `apps.ts` | App CRUD, slugs (`slugify`), `getAppOwnerId`, `AppError` |
| `versions.ts` | `createVersion`, `listVersions`, `getVersion`, `rollbackToVersion`, `currentHtml` |
| `manifest.ts` | Manifeste d'exposition : schéma zod (`appManifestSchema`), extraction depuis le HTML (`extractManifestFromHtml`), exécution des tools déclarés (`executeManifestTool` : get/set/list/append/remove/toggle/update) + conversion JSON Schema → zod (`jsonSchemaToZod`) |

### `tools/`

Registre d'outils partagé : **une définition par outil**, consommée par les deux
surfaces (assistant + MCP). Avant, les 18 outils communs étaient écrits deux fois,
avec des schémas et des handlers séparés qui divergeaient.

| File | Purpose |
|---|---|
| `define.ts` | `defineTool({ name, title, description, input, exposure, destructive, handler })` → `ToolDef`. Le handler reçoit des arguments **déjà validés et typés** (`z.infer`), d'où la disparition des `String(x)` défensifs. `run()` est async : un échec de validation donne une promesse rejetée |
| `registry.ts` | `toolRegistry` : concatène les `tools.ts` de chaque domaine. Ajouter un outil = l'écrire dans son domaine + une ligne ici |
| `registry.test.ts` | Garde-fous : pas de doublon de nom, noms acceptés par MCP, description non vide, schéma bien un `z.object` (l'adaptateur MCP lit `.shape`), validation effective |

Les définitions vivent à côté de leur service : `apps/tools.ts`, `scripts/tools.ts`,
`dashboards/tools.ts`, `storage/tools.ts`, `connections/tools.ts`,
`templates/tools.ts`, `agent/own-tools.ts`. Même principe que
`connections/registry.ts`. Par défaut un outil est exposé aux **deux** surfaces
(`exposure` permet de restreindre).

### `storage/`

Stockage KV unifié : **une seule implémentation** pour les trois portées
(app, global, script). Avant, trois modules quasi identiques (~520 lignes) qui
avaient déjà divergé — `script_storage` n'avait ni `kind` ni `schema`.

| File | Purpose |
|---|---|
| `scope.ts` | `StorageScope` (`app`/`global`/`script`) + constructeurs `appScope`/`globalScope`/`scriptScope`, et un `ScopeRepo` par portée : table visée, résolution de lecture (global : sa clé puis repli sur une clé `family`), filtre de liste, présence de `visibility`. Volontairement bête — aucune logique métier |
| `storage.ts` | Toute la logique, écrite une fois : `storageGet/GetMeta/Set/List/Delete/Clear/RowOp`, round-trip JSON, anti-conflit `baseUpdatedAt` (409 à la seconde près), opérations ligne atomiques en transaction (`applyRowOp`), `isJsonSerializable` |

Les trois tables restent séparées : `app_storage.app_id` et `script_storage.script_id`
portent un `ON DELETE CASCADE` qu'une table unique ne pourrait pas reproduire
(une FK ne peut pas viser trois parents).

### `messages/`

| File | Purpose |
|---|---|
| `chat.ts` | Chat de génération (apps/scripts) : `addGenerationMessage` / `listGenerationMessages` / `listAppMessages` / `listScriptMessages`, au-dessus de `assistant_threads`/`assistant_messages` (contextKind `app`/`script`) |
| `threads.ts` | Stockage de ce chat-là (`getOrCreateThread`, `addMessage`, `listMessages`). Schéma plat role/content, indépendant des tables `agent_*` de l'assistant |

### `scripts/`

Un script serveur (concept public « script ») est un `async function main(home)` exécuté en `node:vm`,
déclenché par un **trigger** : `schedule` (expression cron 5 champs, défaut), `manual` (à la demande) ou
`webhook` (POST public `/api/hooks/<slug>` + secret, payload exposé via `home.webhook.payload`).

| File | Purpose |
|---|---|
| `scripts.ts` | Script/script CRUD, versions (`snapshotScriptVersion`), `computeNextRun`/`nextRunOrNull` (schedule vide = non planifié), `isScheduled`/`generateWebhookSlug`/`generateWebhookSecret`, `getScriptByWebhookSlug` (route publique), ACL (`canReadScript`/`canWriteScript`), `ScriptError` |
| `runner.ts` | Execution in `node:vm`: `runScript(scriptId, {payload})`, `runDueScripts` (ne ramasse que `triggerKind = 'schedule'`), `listScriptRuns` |
| `sdk.ts` | `buildScriptSdk(ownerId, {scriptId, runId, webhookPayload})` — server-side twin of the iframe `homeSDK`; `home.storage.*` est toujours sur `scriptScope`, `home.app(appId).storage.*` donne accès au stockage d'une app (contrôle d'accès à chaque appel). Expose `home.webhook.payload` (null hors webhook) |
| `traced-sdk.ts` | Proxy de traçage (`createTracedHome`) — chaque appel `home.*` devient un span, `home.step`/pragmas `// @step` des spans `step` |

### `browser/`

| File | Purpose |
|---|---|
| `cdp.ts` | Client CDP minimal sur WebSocket natif et wrapper de page |
| `lightpanda.ts` | Health check et démarrage du sidecar Lightpanda local |
| `sessions.ts` | Sessions browser des scripts, actions, TTL et cleanup par run |

### `connections/`

| File | Purpose |
|---|---|
| `connections.ts` | External connections CRUD, secrets encrypted at rest; `getConnectionConfigByType`, `ConnectionError` — **délègue au registry** (`getProvider().schema/test/resolve`) |
| `definition.ts` | Contrat `ConnectionProvider<TConfig>` (schema zod + test + sdk namespace/methods) |
| `registry.ts` | Registre central : `connectionRegistry` + `methodRegistry` (`fullMethod` → provider). Ajouter une connexion = 1 fichier provider + 1 ligne dans registry. Génère aussi `getSdkPromptLines()` pour LLM. |
| `google.ts` | OAuth 2.0 + Drive/Calendar/Gmail/Sheets — exporte `googleProvider` (resolve = refresh). Contrats normalisés côté service pour que les apps générées n'aient rien à devenir : `drive.read` rend `content` **toujours** en chaîne ou `null` (googleapis parse un corps JSON en objet) et exporte les fichiers Google natifs au format qu'ils acceptent (Sheets → CSV, Docs/Slides → texte) ; `drive.list` accepte `orderBy`/`pageSize` ; `sheets.read` signale `truncated` quand la plage par défaut coupe ; `sheets.update` écrit une plage précise. Un champ `note` explique toute limite (CSV 1re feuille, PDF non extractible) |
| `email.ts` | SMTP/IMAP — exporte `smtpProvider` + `imapProvider` (namespace partagé `mail`) |
| `telegram.ts` | Telegram Bot API — exporte `telegramProvider` |
| `notion.ts` | Notion API — exporte `notionProvider` |
| `homeassistant.ts` | Home Assistant REST — exporte `homeassistantProvider` (namespace `homeassistant`, plus de `hass`) |
| `weather.ts` | OpenWeatherMap — exporte `weatherProvider` |
| `webhook.ts` | Generic webhook + `httpFetch` (SSRF-guarded, **hors registry** pour `http.fetch`) — exporte `webhookProvider` |

### `generation/`

| File | Purpose |
|---|---|
| `app.ts` | App generation: `planApp`, `codeApp`, `extractHtml`, `looksTruncatedHtml`, `containsForbiddenStorage`/`fixForbiddenStorage` (anti-localStorage) + `containsForbiddenAlpine`/`fixForbiddenAlpine` (anti-Alpine.data), Chart.js dans libs pré-chargées, the CODER/PLANNER prompts. **Mode itération** automatique dès qu'un HTML courant existe : planner `{changes,keep,risks}`, coder en PATCH CIBLÉ avec historique (`formatHistory`) + HTML tronqué (`truncateHtml`) |
| `script.ts` | Script generation: `generateScript` (passe unique, assistant/MCP) + **deux phases** `planScript`/`codeScript` (+ streams, prompts PLANNER/CODER, `parseGeneratedScript`) pour l'UI |
| `shared.ts` | `chatWithTruncationRetry` (retry à budget doublé), `GenerateOptions`, `languageInstruction`, `formatHistory`, `truncateHtml`, `extractStorageKeys` |

### `llm/`

| File | Purpose |
|---|---|
| `llm.ts` | OpenAI-compatible client, multi-provider; encrypted key resolution (`resolveApiKey`), `LlmError`, `chatCompletion`/`chatCompletionDetailed`/`chatCompletionStream`, `sanitizeChatMessages`. Le tool calling n'est plus ici : l'assistant passe par `services/agent/` (AI SDK) |
| `ai-sdk.ts` | Factory AI SDK : `getAiModel(provider, modelId)` via `createOpenAICompatible` avec `baseURL` et `apiKey: () => resolveApiKey(provider)` (clé chiffrée DB > env). Utilisé par le nouveau flux assistant UIMessage |
| `settings.ts` | Per-user model/provider settings; `getEffectiveDefaults` |

### `user-state/`

| File | Purpose |
|---|---|
| `types.ts` | Contrat `UserStateGraph` : noeuds (`user`/`connection`/`app`/`script`/`storage`/`memory`/`thread`/`signal`) + arêtes (`OWNS`/`ATTACHED_TO`/`STORES`/`RELATES_TO`/`ROUTINE`/`HEALTH`/`INTEREST`/`ACTIVITY`), poids 0..1 |
| `graph.ts` | `getUserStateGraph(userId)` — **vue dérivée** (jamais écrite) construite à la demande : apps/scripts/connexions/mémoire/stockage/threads du user + signaux dérivés. Routines via `describeSchedule` (libellé lisible d'une expression cron 5 champs), liens mémoire→app/stockage par mots-clés (`matchMemoryToApps`/`matchMemoryToStorages`), santé (scripts en échec, connexions non actives), intérêts (≥2 souvenirs liés à une app) |
| `schedule.ts` | `describeSchedule` — traduction best-effort d'une expression script en libellé (ex. « Chaque lundi à 09h00 »). Pur, testable sans DB |
| `match.ts` | Appariement mémoire→app/storage par recouvrement de tokens. Pur, testable sans DB |
| `context.ts` | `formatGraphBlock(graph)` — sérialise le graphe en un bloc compact (~2000c) pour le system prompt de l'assistant (priorité intérêts → routines → santé → capacités) + `memoryIds` référencés (pour `touchMemory`) |

Le graphe est **per-user et 100% auto-dérivé** : rien n'est persisté, aucun appel LLM pour le construire (heuristiques déterministes). Chaque tour d'assistant le recalcule.

### `agent/`

Assistant conversationnel. Le moteur est le **Vercel AI SDK v7** utilisé tel quel :
`streamText` + `tool()` typés, `toUIMessageStream`, et une seule écriture en base
dans `onEnd`. Il n'y a plus de conversion maison entre la base, le LLM et l'UI.

| File | Purpose |
|---|---|
| `threads.ts` | Fils et messages (`agent_threads`/`agent_messages`) — `ensureThread` (crée sous l'id choisi par le client, refuse celui d'un autre utilisateur), `getThread`/`getThreadByContext`/`getOrCreateThreadForContext`, `listThreads`, `updateThreadTitle`, `deleteThread`, `loadMessages`/`saveMessages` (upsert de la liste complète), `appendMessage`, `messageText`. Une ligne = un `UIMessage`, `parts` stocké en JSON |
| `turn.ts` | Un tour de conversation : recharge l'historique, assemble system prompt + outils + modèle, `streamText` avec `stopWhen: stepCountIs(8)`, puis `toUIMessageStream` dont `onEnd` réécrit le fil et déclenche le post-tour. `convertToModelMessages(..., { ignoreIncompleteToolCalls: true })` absorbe un tour précédent interrompu |
| `tools.ts` | **Surface assistant** du registre partagé (`services/tools/registry.ts`) → `ToolSet` typé, + `buildAgentTools` (outils de manifeste d'app) et `destructiveToolNames` (liste injectée dans le prompt de confirmation). Un outil qui échoue **lève** : c'est le SDK qui produit la part `tool-output-error`. On n'ajoute pas d'outil ici |
| `model.ts` | `getAgentModel` — modèle du provider enveloppé par `extractReasoningMiddleware({ tagName: "think" })`, pour les modèles qui émettent leur raisonnement inline |
| `prompt.ts` | `buildSystemPrompt` — rôle, règles, méthodes des services connectés, bloc d'état utilisateur, bloc de scope, consigne de langue |
| `scope.ts` | Contexte app / script / storage : `resolveScope` (requête + contexte du fil) et `buildScopeBlock` (HTML ou code tronqué, clés storage, contenu de la clé demandée) |
| `post-turn.ts` | Hors chemin critique, après persistance : `generateSuggestions` (relances, appelée par sa propre route) + `runPostTurn` (extraction mémoire et titre du fil, best-effort) |
| `memory.ts` | Mémoire durable (`assistant_memory`) — `listMemory`/`addMemory`/`updateMemory`/`deleteMemory`, `formatMemoryBlock`, `touchMemory`, parsers et prompt builders (`buildExtractionPrompt`/`parseExtractionPayload`, `buildTitlePrompt`/`parseTitle`, `buildFollowupPrompt`/`parseFollowups`) |
| `overview.ts` | Vue d'ensemble agrégée (`getPlatformOverview`) — apps/scripts (santé + dernier run), dashboards, connexions, storages récents, souvenirs, threads récents. Un seul appel pour l'assistant |
| `brief.ts` | Brief quotidien — `getOrCreateJournalThread` (fil `contextKind: "journal"`, identifié par son contexte et non par son titre), `generateBrief` (overview + agenda/météo best-effort → `chatCompletion` → `appendMessage`), `shouldGenerateBriefForUser` + `runDueBriefs` |
| `own-tools.ts` | Outils propres à l'assistant (mémoire, overview, brief, graphe d'état) déclarés dans le registre partagé — donc exposés aussi via MCP |
| `schemas.ts` | Schémas zod partagés par les routes mémoire |

### `templates/`

| File | Purpose |
|---|---|
| `templates.ts` | `listTemplates`, `listTemplatesForUser(userId)` (ajoute `installed` via `apps.sourceTemplate`), `getTemplate`, `installTemplate(userId, slug)` — reads `templates/<slug>/{template.json, app.html}` from disk, `createApp` (avec `sourceTemplate`) + `createVersion` + seed table storages |

### `dashboards/`

| File | Purpose |
|---|---|
| `dashboards.ts` | Dashboard CRUD, layout validation (`validateLayout`), `DashboardError`; 12-col grid, owner/visibility checks. Ajoute `addDashboardWidget` / `removeDashboardWidget` (placement auto) pour l'assistant |

Each service has a co-located `.test.ts`.

## Lib (`src/lib/`)

| File | Purpose |
|---|---|
| `app-runtime.ts` | Core of the platform runtime: `buildAppDocument()` (full iframe HTML with CSP/Tailwind/Alpine/Chart.js), the inline `homeSDK` bridge string, and `bridgeRpc.handle()` (server dispatcher for SDK calls — incl. `storage.table.add/update/remove/toggle` sur les valeurs table) |
| `api-helpers.ts` | `apiError(err)` — `HttpError` → friendly API responses |
| `route.ts` | `route({ permission, body, query, handler })` — enveloppe des routes API : auth, params, query, parsing/validation zod, `try/catch → apiError` faits une seule fois. Un message zod qui **est** un `ErrorCode` (ex. `z.string().min(1, "keyRequired")`) produit la réponse traduite habituelle ; sinon `invalidBody`. Renvoyer une `Response` (SSE, cookie, redirection) la transmet telle quelle |
| `schemas.ts` | Briques zod partagées entre domaines (`visibilitySchema`, `nameSchema`) |
| `api-client.ts` | `api.get/post/put/patch/del` côté React : lit la forme `{ error, code }` des routes et lève une `ApiError` typée. Remplace les `fetch` à la main dans les composants |
| `use-resource.ts` | `useResource(url)` → `{ data, loading, error, reload, setData }` — remplace le trio d'états répété autour de chaque GET |
| `auth.ts` / `auth-client.ts` | better-auth server config / client helpers |
| `errors.ts` | Error taxonomy : `HttpError` (base, porte le statut HTTP), `UnauthenticatedError` (401), `ForbiddenError` (403), `StorageConflictError` (409 écriture concurrente), `StorageRowError` (400/404 op table) |
| `rbac.ts` | Politique RBAC : rôles (`admin`/`user`), permissions, matrice `can()` ; better-auth ne fait que stocker le rôle |
| `crypto.ts` | AES-256-GCM encrypt/decrypt (`EncryptedPayload`) for secrets |
| `env.ts` | Centralized env validation, default LLM models |
| `session.ts` | `requireUser` / `requirePermission(perm)` / `getSession` server helpers. `requireUser` accepte la session cookie **ou** un token d'accès personnel (`Authorization: Bearer hai_...`) — c'est le point d'entrée unique de l'auth pour REST et MCP |
| `api-tokens.ts` | Tokens d'accès personnel : `createApiToken`/`listApiTokens`/`revokeApiToken`/`resolveApiToken`/`extractBearerToken`. Empreinte SHA-256 stockée, clair jamais persisté |
| `format.ts`, `tags.ts`, `thumbnail.ts` | French relative time, tag normalization, thumbnail gradients |
| `natural-script.ts` | Presets de planification (`SCRIPT_PRESETS`) + `isValidScript` pour l'éditeur de script |
| `storage-table.ts` | Data Studio + row ops : `parseCsv`/`toCsv`/`splitCsvLine`/`parseCell`, `inferKind`, `toTable` (plus de cap 8 colonnes) ; CRUD de lignes `applyRowOp`/`isRowOpInput`/`newRowId`, opérations colonnes (`append/rename/delete/moveColumn`), inférence `inferColumnType`/`inferJsonSchema`. Framework-agnostic, testé |
| `json-schema.ts` | `jsonSchemaToZod` (ex-manifest.ts) — importable côté client |
| `../instrumentation.ts` | Next instrumentation hook: starts the script poller (every 30s) + brief scheduler (every 5min, 1 fois/jour à `briefHour`) |

## Database (`src/db/schema.ts`, SQLite only)

Auth (better-auth): `user`, `session`, `account`, `verification`. Le plugin
`admin` ajoute sur `user` : `role` (`admin` | `user`), `banned`, `banReason`,
`banExpires`. RBAC : premier compte créé = admin (backfill migration 0006 +
hook d'amorçage dans `lib/auth.ts`) ; politique dans `lib/rbac.ts` ; endpoints
de gestion `/api/auth/admin/*` montés par le plugin (réservés aux admins).

Dashboards domain:
- `dashboards` — slug unique, name, ownerId, visibility (`private` | `family`), layout JSON (`{ cols:12, widgets: {i,appId,x,y,w,h,title?}[] }`), 12-col responsive grid, max 20 widgets

Assistant (`agent_*`, drizzle 0024) :
- `agent_threads` — `id` (choisi par le client), `userId` → `user`, `title`, `contextKind` (`assistant`|`app`|`script`|`journal`, default `assistant`), `contextId` (appId/scriptId/userId), `createdAt`, `updatedAt` (index `agent_threads_user`, `agent_threads_context`)
- `agent_messages` — `id`, `threadId` → `agent_threads`, `role` (`user` | `assistant`), **`parts`** (JSON `UIMessage["parts"]` : text, reasoning, `tool-*`), `model`, `seq` (ordre stable dans le fil), `createdAt` (index `agent_messages_thread`). Une ligne = un `UIMessage` : l'UI le relit tel quel et la couche LLM passe par `convertToModelMessages`, donc aucune conversion maison des deux côtés

Chat de génération (apps/scripts), schéma plat conservé, alimenté par `src/services/messages/` :
- `assistant_threads` — `id`, `userId` → `user`, `title`, `contextKind` (`assistant`|`app`|`script`), `contextId`, `createdAt`, `updatedAt` (index `assistant_threads_context`)
- `assistant_messages` — `id`, `threadId`, `role` (`user` | `assistant` | `tool` | `plan`), `content`, `model`, `versionId`, `durationMs`, `createdAt` (index `assistant_messages_thread`)
- `assistant_memory` — `id`, `userId` → `user`, `kind` (`fact`|`preference`|`project`), `content`, `source` (`auto`|`assistant`|`user`), `threadId` (provenance → `agent_threads`), `pinned`, `useCount`, `lastUsedAt`, `createdAt`, `updatedAt` (index `assistant_memory_user`). Mémoire durable ; source du graphe d'état utilisateur (`src/services/user-state/`), injectée dans le system prompt via `formatGraphBlock` (ex-`formatMemoryBlock`, cap 2000 chars/40 items)

Apps domain:
- `apps` — slug, name, ownerId, visibility (`private` | `family`), hasUi, tags, currentVersionId, manifest (JSON des storages/tools déclarés, consommé par MCP/Assistant), sourceTemplate (slug de la template d'origine si l'app est issue d'un modèle)
- `app_versions` — HTML snapshots (html, prompt, model, manifest)
- `app_storage` — KV JSON per app; **no `id` column**, composite key `(appId, key)`; `kind` kv/table + `schema` JSON optionnel
- `global_storage` — KV JSON partagé entre les apps; composite key `(ownerId, key)`; `visibility` private/family (family = lisible par tous)

Manifeste d'app : `<script type="application/json" id="home-manifest">` dans le HTML généré,
extrait par `extractManifestFromHtml` à chaque `codeApp`, validé par zod, stocké sur
`apps.manifest` + `app_versions.manifest`. Mapping déclaratif (`op` : get/set/list/append/remove/toggle/update
sur une clé) — jamais de JS arbitraire. MCP et Assistant exposent ces tools sous le nom
`app_<slug>__<tool>` (cap 50 tools au total). Modèles préfabriqués dans `templates/<slug>/` (même HTML + manifeste) installés via `installTemplate` — une app installée est une app normale (`apps.sourceTemplate` garde la trace du modèle d'origine pour masquer les templates déjà installées par l'user dans la vitrine ; l'API `GET /api/templates` renvoie le flag `installed` par user).

Messages domain (chat unifié — legacy) :
- `generation_messages` — ancienne table (`user` | `assistant` | `plan`, `appId`/`scriptId`/`ownerId`) migrée vers `assistant_threads`/`assistant_messages` (drizzle 0014 backfill). Conservée temporairement en lecture seule (fallback dans `src/services/messages/chat.ts`) puis supprimée dans une prochaine migration

Scripts domain:
- `scripts` — scripts serveur (anciennement « crons ») : aucun lien vers une app ; `ownerId` + `visibility` (`private` | `family`) font foi pour l'accès ; `triggerKind` (`schedule` | `manual` | `webhook`, défaut `schedule`) ; `schedule` 5 champs (**vide** si non planifié), `webhookSlug` (unique, si webhook) + `webhookSecret`, JS code (`async function main(home)`), enabled, nextRunAt/lastRunAt
- `script_storage` — KV JSON per standalone script; composite key `(scriptId, key)`; `kind` kv/table + `schema` (comme `app_storage`, depuis drizzle 0019) ; utilisé quand le script n'a pas d'app
- `script_runs` — history: status `success` | `error` | `timeout`, output, error, durationMs
- `script_run_spans` — trace d'exécution en arbre (`parentId`): `step` (groupes `home.step`), `call` (appels `home.*` auto-tracés), `log` (console) ; indexé `(runId, seq)` ; rétention : 50 derniers runs par script
- `script_versions` — code snapshots, restorable

Le traçage vit dans `src/services/scripts/traced-sdk.ts` (`createTracedHome`) : il enveloppe
`buildScriptSdk` d'un Proxy qui enregistre chaque appel SDK + les pragmas `home.step`.
Le pragma commentaire `// @step Label` (portée implicite jusqu'au prochain `// @step` ou fin de run,
`// @endstep` optionnel) est transformé dans `runner.ts` (`transformPragmas`) vers
`home.__pushStep` — pop auto au prochain step / fin de run.

Settings:
- `user_settings` — per-user provider/planner/coder/**assistantModel** overrides (+ locale) + **brief** `briefEnabled`/`briefHour`/`briefLastRunAt`
- `provider_keys` — one row per provider, encrypted API key (overrides env)

Programmatic access (REST + MCP):
- `api_tokens` — personal access tokens: `userId`, `name`, `tokenHash` (SHA-256, never plaintext), `prefix` (e.g. `hai_ab12cd34`), `createdAt`, `lastUsedAt`, `revokedAt` (soft revoke via `revokedAt IS NOT NULL`)
- `mcp_tool_calls` — historique des appels MCP : `userId`, `toolName`, `tokenPrefix`, `args`/`result` (JSON tronqué 4 Ko), `status` (`success`|`error`), `error`, `durationMs`, `createdAt` (index `user_created`, `user_tool`). Écrit best-effort depuis `services/mcp/server.ts` via `services/mcp/calls.ts` ; exposé via `GET /api/mcp/calls` (scopé `userId`, `limit` 1..100). Purge 30j/500 max.

Connections:
- `connections` — type `google` | `smtp` | `imap` | `telegram` | `notion` | `homeassistant` | `weather` | `webhook`; `config` is an **encrypted blob** (AES-256-GCM); status active/error/expired

Migrations live in `drizzle/*.sql`; workflow: `npm run db:generate` then `npm run db:migrate`.

## Where `homeSDK` lives

Not a package — quatre pièces coordonnées, **découplées via registry** :

1. **Bridge (iframe side)** — `BRIDGE` généré dynamiquement dans `src/lib/app-runtime.ts` via `methodRegistry` (`buildBridgeEntries()` → `{ google{drive{list,read...}}, mail{send,search...}, telegram{send...}, notion{...}, homeassistant{...}, weather{...}, webhook{...} }` + `storage` (avec `storage.global.*`), `http`, `ai` hors registry). Expose `window.homeSDK`.
2. **Relay (parent side)** — `src/components/AppFrame.tsx` listens for `postMessage` type `"homesdk"` and POSTs to `/api/apps/[id]/rpc` (avec `e.source` check pour dashboards multi-iframes)
3. **Server dispatcher** — `bridgeRpc.handle()` dans `src/lib/app-runtime.ts` : `storage.*`/`storage.global.*` résolus par une `StorageScope` (une seule branche), `ai`/`http.fetch` en dur, sinon lookup `getMethod(method)` → `getProvider(type)` → `provider.sdk.methods[methodKey](cfg, ...args)`
4. **Script twin** — `buildScriptSdk(ownerId, {scriptId, runId, webhookPayload})` dans `src/services/scripts/sdk.ts` : même génération dynamique à partir de `connectionRegistry` (boucle `provider.sdk.methods`, gestion `mail` partagé). `home.storage.*` est sur `scriptScope` ; `home.app(appId).storage.*` sur `appScope`, avec un `getApp(ownerId, appId)` à chaque appel. Plus de switch ni de branche par store. `home.webhook.payload` expose le corps d'un webhook entrant (null sinon).

Ajouter une connexion = créer `src/services/connections/<type>.ts` qui exporte `<type>Provider` (`schema` zod + `test` + `sdk`), puis 1 ligne dans `registry.ts`. Le prompt LLM (`getSdkPromptLines()`) et `POST /api/connections` s'adaptent seuls — plus besoin de toucher `app-runtime`, `sdk`, `generation`.

## Programmatic access (external agents: REST + MCP)

Un agent externe (ex. hermes sur un VPS) interagit avec home-ai sans session
navigateur, via un **token d'accès personnel** :

- Mint dans l'UI Paramètres → « Tokens d'accès personnel » ou `POST /api/tokens`
  (le jeton `hai_...` est montré une seule fois). Révoquer : `DELETE /api/tokens/[id]`.
- Envoi : `Authorization: Bearer hai_...` sur n'importe quelle route `/api/*`.
  `requireUser()` (src/lib/session.ts) résout soit la session cookie, soit le
  Bearer — un seul garde pour tout. Le token est stocké en empreinte SHA-256.

**Endpoint MCP** : `POST /api/mcp` (Streamable HTTP, mode **stateless**). Il
réutilise les services existants et le même garde d'auth. Les outils viennent du **registre partagé** (`src/services/tools/registry.ts`) : `buildMcpServer(userId, {tokenPrefix})` boucle dessus et n'en définit plus aucun lui-même. MCP expose donc les mêmes 42 outils que l'assistant, plus les tools déclarés par les apps (`app_<slug>__<tool>`, via `registerManifestTools`).
Chaque outil vérifie la propriété (via `getApp` / `getScriptWithApp`) avant d'agir. Chaque appel est tracé best-effort dans `mcp_tool_calls` (`services/mcp/calls.ts` : `logMcpCall`/`listMcpCalls`) avec `durationMs` + `tokenPrefix` (préfixe `hai_…`). Diagnostic : `GET /api/mcp/tools` (catalogue sérialisé pour l'UI) + `GET /api/mcp/calls` (historique) + page `Paramètres → MCP` (`settings/mcp` : URL, snippets hermes/Claude, catalogue filtrable, activité récente).

**Assistant global** : page `assistant` + API `assistant`:
- UI `src/app/assistant/[[...threadId]]` (catch-all plein écran). La **page serveur** charge le fil et la liste des conversations et les passe en props : pas de fetch d'historique côté client, pas d'état de chargement. `AssistantPageClient` + `agent/ThreadSidebar` (présentationnel, rafraîchi par `router.refresh()`) + `agent/ChatView` (`useChat` + `DefaultChatTransport`, rendu par type de part, reasoning/tool repliés par défaut, `PlanCardPart` éditable). Drawer `agent/Overlay.tsx` (⌘J, scope app/script/storage sans navigation) + Paramètres → Mémoire / Brief
- **L'id du fil est choisi par le client** et renvoyé à chaque tour ; `ensureThread` le crée à la demande. Rien n'a donc besoin de remonter du serveur pendant le stream (plus de `data-thread`), et reprendre un fil est idempotent
- API `POST /api/assistant/chat` (`{ id, message, scope?, locale }` — seul le dernier message est envoyé, le serveur détient l'historique ; cap à 32k caractères), `GET /api/assistant/threads` (+ filtre `?contextKind=&contextId=`), `GET /api/assistant/threads/[id]` (→ `messages: UIMessage[]`), `DELETE /api/assistant/threads/[id]`, `POST /api/assistant/suggestions` (relances, hors du stream pour ne pas retarder sa fermeture), `GET/POST /api/assistant/memory` + `PATCH/DELETE /api/assistant/memory/[id]`, `GET /api/assistant/overview`, `POST/GET /api/assistant/brief`, `PUT /api/settings` (assistantModel + brief*)
- Moteur : `streamText` + `tool()` typés + `toUIMessageStream`, `stopWhen: stepCountIs(8)`. La persistance se fait **une seule fois**, dans `onEnd`, en réécrivant la liste que le SDK a produite. Même garde `requireUser()` que REST/MCP. Modèle effectif : `assistantModel` → env `LLM_ASSISTANT_MODEL` → `LLM_PLANNER_MODEL`. Brief via `runDueBriefs` dans `instrumentation.ts`

Connexion hermes :
```sh
hermes mcp connect https://<domain>/api/mcp --header "Authorization: Bearer hai_..."
```

## Conventions to know

- Code comments and UI strings are **French**.
- API routes are thin: parse input, call a service, return JSON via `apiError(err)` on failure.
- Tests are vitest, co-located next to the file they test.
