import {
  blob,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

import type { EncryptedPayload } from "@/lib/crypto";

// ---------------------------------------------------------------------------
// better-auth
// ---------------------------------------------------------------------------

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  // RBAC : "admin" | "user" (valeurs du plugin admin better-auth, cf. lib/rbac.ts).
  role: text("role").notNull().default("user"),
  banned: integer("banned", { mode: "boolean" }).notNull().default(false),
  banReason: text("ban_reason"),
  banExpires: integer("ban_expires", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  issuer: text("issuer").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
  scope: text("scope"),
  idToken: text("id_token"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// ---------------------------------------------------------------------------
// Connexions aux services externes
// ---------------------------------------------------------------------------

export const connectionType = [
  "google",
  "smtp",
  "imap",
  "telegram",
  "notion",
  "homeassistant",
  "weather",
  "webhook",
] as const;
export type ConnectionType = (typeof connectionType)[number];

export const connections = sqliteTable("connections", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  type: text("type", { enum: connectionType }).notNull(),
  label: text("label").notNull(),
  // JSON chiffré (AES-256-GCM) : tokens OAuth ou identifiants SMTP/IMAP.
  config: blob("config", { mode: "json" }).$type<EncryptedPayload>().notNull(),
  status: text("status", { enum: ["active", "error", "expired"] })
    .notNull()
    .default("active"),
  lastError: text("last_error"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// ---------------------------------------------------------------------------
// Tokens d'accès personnel (accès programmeur : REST + MCP)
// ---------------------------------------------------------------------------

export const apiTokens = sqliteTable("api_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // Empreinte SHA-256 du token : le jeton en clair n'est jamais stocké.
  tokenHash: text("token_hash").notNull().unique(),
  // Préfixe court (ex. "hai_ab12cd34") affiché dans l'UI pour identifier le token.
  prefix: text("prefix").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
  revokedAt: integer("revoked_at", { mode: "timestamp" }),
});

// ---------------------------------------------------------------------------
// Apps (UI web et/ou scripts)
// ---------------------------------------------------------------------------

export const appVisibility = ["private", "family"] as const;
export type AppVisibility = (typeof appVisibility)[number];

export const apps = sqliteTable("apps", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  visibility: text("visibility", { enum: appVisibility }).notNull().default("private"),
  hasUi: integer("has_ui", { mode: "boolean" }).notNull().default(false),
  // Étiquettes libres (JSON array de strings) pour le catalogue d'apps.
  tags: text("tags"),
  currentVersionId: text("current_version_id"),
  // Manifeste d'exposition (JSON) : storages + tools déclarés par l'app, extraits
  // du HTML généré ou édités à la main. Consommé par MCP/Assistant pour générer
  // des tools typés par app. Voir src/services/apps/manifest.ts.
  manifest: text("manifest"),
  // Modèle d'origine (slug `templates/<slug>`/`sourceTemplate`) si l'app a été
  // installée depuis une template. Null pour une app créée à la main ou via
  // l'assistant. Permet de masquer les templates déjà installées par l'user.
  sourceTemplate: text("source_template"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const appVersions = sqliteTable("app_versions", {
  id: text("id").primaryKey(),
  appId: text("app_id")
    .notNull()
    .references(() => apps.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  html: text("html"),
  prompt: text("prompt"),
  model: text("model"),
  manifest: text("manifest"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});



// Stockage KV par app (persistance utilisable depuis le SDK).
// `kind` : "kv" (valeur libre) ou "table" (valeur = tableau d'objets homogènes,
// typé par `schema`). `schema` : JSON optionnel (ex. { columns: [...] }).
export const storageKind = ["kv", "table"] as const;
export type StorageKind = (typeof storageKind)[number];

export const appStorage = sqliteTable(
  "app_storage",
  {
    appId: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    kind: text("kind", { enum: storageKind }).notNull().default("kv"),
    schema: text("schema"),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("app_storage_app_key").on(t.appId, t.key)],
);

// Stockage global partagé entre toutes les apps du user (et la famille selon
// `visibility`). Même modèle de visibilité que apps/scripts : private = owner seul,
// family = visible par tous. Accessible via homeSDK.storage.global.*.
export const globalStorage = sqliteTable(
  "global_storage",
  {
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    kind: text("kind", { enum: storageKind }).notNull().default("kv"),
    schema: text("schema"),
    visibility: text("visibility", { enum: appVisibility }).notNull().default("private"),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("global_storage_owner_key").on(t.ownerId, t.key)],
);

// ---------------------------------------------------------------------------
// Paramètres utilisateur (LLM)
// ---------------------------------------------------------------------------

export const userSettings = sqliteTable("user_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: ["opencode-go", "openrouter"] }),
  plannerModel: text("planner_model"),
  coderModel: text("coder_model"),
  assistantModel: text("assistant_model"),
  // Langue de l'interface ; null = déduite du navigateur (cf. src/i18n/request.ts).
  locale: text("locale", { enum: ["fr", "en"] }),
  briefEnabled: integer("brief_enabled", { mode: "boolean" }).notNull().default(false),
  briefHour: integer("brief_hour").notNull().default(8),
  briefLastRunAt: integer("brief_last_run_at", { mode: "timestamp" }),
  aiDailyTokenLimit: integer("ai_daily_token_limit"),
  aiWeeklyTokenLimit: integer("ai_weekly_token_limit"),
  aiMonthlyTokenLimit: integer("ai_monthly_token_limit"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// Clés API LLM stockées en base (surchargent les variables d'env), chiffrées
// AES-256-GCM comme les connexions. Une ligne par provider.
export const providerKeys = sqliteTable("provider_keys", {
  provider: text("provider", { enum: ["opencode-go", "openrouter"] }).primaryKey(),
  apiKey: blob("api_key", { mode: "json" }).$type<EncryptedPayload>().notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// ---------------------------------------------------------------------------
// Scripts (anciennement « crons » — un script est un bout de code serveur
// déclenché par un trigger : schedule, manuel ou webhook)
// ---------------------------------------------------------------------------

export const scriptTriggerKind = ["schedule", "manual", "webhook"] as const;
export type ScriptTriggerKind = (typeof scriptTriggerKind)[number];

export const scripts = sqliteTable(
  "scripts",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    visibility: text("visibility", { enum: appVisibility }).notNull().default("private"),
    name: text("name").notNull(),
    // Trigger : "schedule" (expression cron 5 champs), "manual" (à la demande),
    // "webhook" (POST public `/api/hooks/<webhookSlug>` + secret).
    triggerKind: text("trigger_kind", { enum: scriptTriggerKind })
      .notNull()
      .default("schedule"),
    // Expression cron 5 champs. Vide ("") pour un trigger non planifié.
    schedule: text("schedule").notNull(),
    // Slug public du webhook entrant + secret partagé (seulement si webhook).
    webhookSlug: text("webhook_slug"),
    webhookSecret: text("webhook_secret"),
    code: text("code").notNull(), // JS serveur : async function main(home) {}
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    nextRunAt: integer("next_run_at", { mode: "timestamp" }),
    lastRunAt: integer("last_run_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("scripts_webhook_slug").on(t.webhookSlug)],
);

// Stockage KV isolé par script. Mêmes colonnes `kind`/`schema` que `app_storage` :
// un script peut donc porter une valeur « table » typée, exploitable par le Data Studio.
export const scriptStorage = sqliteTable(
  "script_storage",
  {
    scriptId: text("script_id")
      .notNull()
      .references(() => scripts.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    kind: text("kind", { enum: storageKind }).notNull().default("kv"),
    schema: text("schema"),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("script_storage_script_key").on(t.scriptId, t.key)],
);

export const scriptRunStatus = ["running", "success", "error", "timeout"] as const;
export type ScriptRunStatus = (typeof scriptRunStatus)[number];

export const scriptRuns = sqliteTable("script_runs", {
  id: text("id").primaryKey(),
  scriptId: text("script_id")
    .notNull()
    .references(() => scripts.id, { onDelete: "cascade" }),
  status: text("status", { enum: scriptRunStatus }).notNull(),
  output: text("output"),
  error: text("error"),
  durationMs: integer("duration_ms"),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp" }),
});

export const spanKind = ["step", "call", "log"] as const;
export type SpanKind = (typeof spanKind)[number];

export const spanOrigin = ["explicit", "implicit"] as const;
export type SpanOrigin = (typeof spanOrigin)[number];

// Trace d'exécution d'un run : chaque étape (home.step), appel SDK (home.*) et
// log console devient une ligne, organisée en arbre via parentId.
export const scriptRunSpans = sqliteTable(
  "script_run_spans",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => scriptRuns.id, { onDelete: "cascade" }),
    parentId: text("parent_id").references(
      (): AnySQLiteColumn => scriptRunSpans.id,
      { onDelete: "cascade" },
    ),
    seq: integer("seq").notNull(),
    kind: text("kind", { enum: spanKind }).notNull(),
    // "explicit" = via home.step(), "implicit" = futur // @step (pop au prochain step / EOF).
    origin: text("origin", { enum: spanOrigin }),
    label: text("label"),
    method: text("method"),
    // args / result : JSON stringifié, tronqué (~4 Ko).
    args: text("args"),
    result: text("result"),
    status: text("status", { enum: ["success", "error"] }).notNull(),
    error: text("error"),
    startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
    durationMs: integer("duration_ms"),
  },
  (t) => [
    index("script_run_spans_run_seq").on(t.runId, t.seq),
    index("script_run_spans_run_parent").on(t.runId, t.parentId),
  ],
);

// Historique des versions d'un script (snapshot à chaque mise à jour).
export const scriptVersions = sqliteTable("script_versions", {
  id: text("id").primaryKey(),
  scriptId: text("script_id")
    .notNull()
    .references(() => scripts.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  name: text("name").notNull(),
  schedule: text("schedule").notNull(),
  code: text("code").notNull(),
  prompt: text("prompt"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ---------------------------------------------------------------------------
// Tableaux de bord personnalisés (grille d'apps)
// ---------------------------------------------------------------------------

export const dashboards = sqliteTable("dashboards", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  visibility: text("visibility", { enum: appVisibility }).notNull().default("private"),
  // JSON DashboardLayout { cols, widgets }
  layout: text("layout").notNull().default('{"cols":12,"widgets":[]}'),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// ---------------------------------------------------------------------------
// Suivi d'usage LLM
// ---------------------------------------------------------------------------

export const llmUsageFeature = [
  "app_plan",
  "app_code",
  "app_fix_storage",
  "app_fix_alpine",
  "script_plan",
  "script_code",
  "script_generate",
  "assistant_main",
  "assistant_tool",
  "assistant_suggestions",
  "assistant_extraction",
  "assistant_title",
  "brief",
  "storage_seed",
  "ai_sdk_app",
  "ai_sdk_script",
  "test",
  "unknown",
] as const;
export type LlmUsageFeature = (typeof llmUsageFeature)[number];

export const llmUsage = sqliteTable(
  "llm_usage",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    provider: text("provider", { enum: ["opencode-go", "openrouter"] }).notNull(),
    model: text("model").notNull(),
    feature: text("feature", { enum: llmUsageFeature }).notNull().default("unknown"),
    status: text("status", { enum: ["success", "error"] }).notNull().default("success"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    totalTokens: integer("total_tokens"),
    estimated: integer("estimated", { mode: "boolean" }).notNull().default(false),
    costMicros: integer("cost_micros"),
    durationMs: integer("duration_ms"),
    appId: text("app_id").references(() => apps.id, { onDelete: "set null" }),
    scriptId: text("script_id").references(() => scripts.id, { onDelete: "set null" }),
    threadId: text("thread_id"),
    error: text("error"),
  },
  (t) => [
    index("llm_usage_user_created").on(t.userId, t.createdAt),
    index("llm_usage_app").on(t.appId),
    index("llm_usage_script").on(t.scriptId),
    index("llm_usage_feature").on(t.feature),
  ],
);

// ---------------------------------------------------------------------------
// Agent : fils de conversation de l'assistant.
// Un message = une ligne, `parts` porte le JSON UIMessage['parts'] tel quel.
// C'est la source de vérité unique : l'UI le relit directement, la couche LLM
// passe par convertToModelMessages. Aucune conversion maison.
// ---------------------------------------------------------------------------

export const agentContextKind = ["assistant", "app", "script", "journal"] as const;
export type AgentContextKind = (typeof agentContextKind)[number];

export const agentThreads = sqliteTable(
  "agent_threads",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    contextKind: text("context_kind", { enum: agentContextKind }).notNull().default("assistant"),
    contextId: text("context_id"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("agent_threads_user").on(t.userId, t.updatedAt),
    index("agent_threads_context").on(t.userId, t.contextKind, t.contextId),
  ],
);

export const agentMessageRole = ["user", "assistant"] as const;
export type AgentMessageRole = (typeof agentMessageRole)[number];

export const agentMessages = sqliteTable(
  "agent_messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => agentThreads.id, { onDelete: "cascade" }),
    role: text("role", { enum: agentMessageRole }).notNull(),
    /** JSON: UIMessage["parts"] (text, reasoning, tool-*, data-*). */
    parts: text("parts").notNull(),
    model: text("model"),
    /** Ordre stable dans le fil : createdAt seul peut collisionner. */
    seq: integer("seq").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("agent_messages_thread").on(t.threadId, t.seq)],
);

// ---------------------------------------------------------------------------
// Chat de génération (apps + scripts) — hérité, alimenté par services/messages.
// ---------------------------------------------------------------------------

export const assistantContextKind = ["assistant", "app", "script"] as const;
export type AssistantContextKind = (typeof assistantContextKind)[number];

export const assistantThreads = sqliteTable(
  "assistant_threads",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    contextKind: text("context_kind", { enum: assistantContextKind })
      .notNull()
      .default("assistant"),
    contextId: text("context_id"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("assistant_threads_context").on(t.contextKind, t.contextId)],
);

export const assistantMemoryKind = ["fact", "preference", "project"] as const;
export type AssistantMemoryKind = (typeof assistantMemoryKind)[number];

export const assistantMemorySource = ["auto", "assistant", "user"] as const;
export type AssistantMemorySource = (typeof assistantMemorySource)[number];

export const assistantMemory = sqliteTable(
  "assistant_memory",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: assistantMemoryKind }).notNull().default("fact"),
    content: text("content").notNull(),
    source: text("source", { enum: assistantMemorySource }).notNull().default("auto"),
    // Le souvenir vient d'une conversation de l'assistant : le fil vit dans agent_threads.
    threadId: text("thread_id").references(() => agentThreads.id, { onDelete: "set null" }),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    useCount: integer("use_count").notNull().default(0),
    lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("assistant_memory_user").on(t.userId)],
);

export const assistantMessageRole = ["user", "assistant", "tool", "plan"] as const;
export type AssistantMessageRole = (typeof assistantMessageRole)[number];

// Historique des appels MCP (outil → résultat), par utilisateur.
export const mcpToolCalls = sqliteTable(
  "mcp_tool_calls",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    // Préfixe du token (hai_xxxx) si l'appel vient d'un PAT.
    tokenPrefix: text("token_prefix"),
    args: text("args"),
    result: text("result"),
    status: text("status", { enum: ["success", "error"] }).notNull(),
    error: text("error"),
    durationMs: integer("duration_ms"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("mcp_tool_calls_user_created").on(t.userId, t.createdAt),
    index("mcp_tool_calls_user_tool").on(t.userId, t.toolName),
  ],
);

// Une ligne = un message du chat. `tool` porte l'appel d'outil, `plan` le plan éditable (apps).
export const assistantMessages = sqliteTable(
  "assistant_messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => assistantThreads.id, { onDelete: "cascade" }),
    role: text("role", { enum: assistantMessageRole }).notNull(),
    content: text("content").notNull().default(""),
    // Réflexion du modèle (chain-of-thought). Stockée séparée pour ne pas polluer le markdown de sortie.
    reasoning: text("reasoning"),
    // Message `assistant` ayant demandé des outils : liste JSON [{id,name,args}].
    toolCalls: text("tool_calls"),
    // Message `tool` : exécution d'un appel d'outil.
    toolCallId: text("tool_call_id"),
    toolName: text("tool_name"),
    toolArgs: text("tool_args"),
    toolResult: text("tool_result"),
    toolOk: integer("tool_ok", { mode: "boolean" }),
    model: text("model"),
    versionId: text("version_id"),
    durationMs: integer("duration_ms"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("assistant_messages_thread").on(t.threadId)],
);
