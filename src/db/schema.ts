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
  // RBAC: "admin" | "user" (values from the better-auth admin plugin, see lib/rbac.ts).
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
// Connections to external services
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
  // Encrypted JSON (AES-256-GCM): OAuth tokens or SMTP/IMAP credentials.
  config: blob("config", { mode: "json" }).$type<EncryptedPayload>().notNull(),
  status: text("status", { enum: ["active", "error", "expired"] })
    .notNull()
    .default("active"),
  lastError: text("last_error"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// ---------------------------------------------------------------------------
// Personal access tokens (programmatic access: REST + MCP)
// ---------------------------------------------------------------------------

export const apiTokens = sqliteTable("api_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // SHA-256 hash of the token: the plaintext token is never stored.
  tokenHash: text("token_hash").notNull().unique(),
  // Short prefix (e.g. "hai_ab12cd34") shown in the UI to identify the token.
  prefix: text("prefix").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
  revokedAt: integer("revoked_at", { mode: "timestamp" }),
});

// ---------------------------------------------------------------------------
// Apps (web UI and/or scripts)
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
  // Free-form tags (JSON array of strings) for the app catalog.
  tags: text("tags"),
  currentVersionId: text("current_version_id"),
  // Exposure manifest (JSON): storages + tools declared by the app, extracted
  // from the generated HTML or hand-edited. Consumed by MCP/Assistant to
  // generate per-app typed tools. See src/services/apps/manifest.ts.
  manifest: text("manifest"),
  // Source template (slug `templates/<slug>`/`sourceTemplate`) if the app was
  // installed from a template. Null for an app created by hand or via the
  // assistant. Used to hide templates the user already installed.
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



// Per-app KV storage (persistence usable from the SDK).
// `kind`: "kv" (free-form value) or "table" (value = array of homogeneous
// objects, typed by `schema`). `schema`: optional JSON (e.g. { columns: [...] }).
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

// Global storage shared across all of the user's apps (and the family,
// depending on `visibility`). Same visibility model as apps/scripts: private =
// owner only, family = visible to everyone. Accessible via homeSDK.storage.global.*.
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
// User settings (LLM)
// ---------------------------------------------------------------------------

export const userSettings = sqliteTable("user_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: ["opencode-go", "openrouter"] }),
  plannerModel: text("planner_model"),
  coderModel: text("coder_model"),
  assistantModel: text("assistant_model"),
  // UI language; null = inferred from the browser (see src/i18n/request.ts).
  locale: text("locale", { enum: ["fr", "en"] }),
  briefEnabled: integer("brief_enabled", { mode: "boolean" }).notNull().default(false),
  briefHour: integer("brief_hour").notNull().default(8),
  briefLastRunAt: integer("brief_last_run_at", { mode: "timestamp" }),
  aiDailyTokenLimit: integer("ai_daily_token_limit"),
  aiWeeklyTokenLimit: integer("ai_weekly_token_limit"),
  aiMonthlyTokenLimit: integer("ai_monthly_token_limit"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// LLM API keys stored in the database (override env vars), encrypted
// AES-256-GCM like connections. One row per provider.
export const providerKeys = sqliteTable("provider_keys", {
  provider: text("provider", { enum: ["opencode-go", "openrouter"] }).primaryKey(),
  apiKey: blob("api_key", { mode: "json" }).$type<EncryptedPayload>().notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// ---------------------------------------------------------------------------
// Scripts (formerly "crons" — a script is a piece of server-side code
// triggered by: schedule, manual, or webhook)
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
    // Trigger: "schedule" (5-field cron expression), "manual" (on demand),
    // "webhook" (public POST `/api/hooks/<webhookSlug>` + secret).
    triggerKind: text("trigger_kind", { enum: scriptTriggerKind })
      .notNull()
      .default("schedule"),
    // 5-field cron expression. Empty ("") for a non-scheduled trigger.
    schedule: text("schedule").notNull(),
    // Public inbound webhook slug + shared secret (only if webhook).
    webhookSlug: text("webhook_slug"),
    webhookSecret: text("webhook_secret"),
    code: text("code").notNull(), // Server-side JS: async function main(home) {}
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    nextRunAt: integer("next_run_at", { mode: "timestamp" }),
    lastRunAt: integer("last_run_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("scripts_webhook_slug").on(t.webhookSlug)],
);

// Per-script isolated KV storage. Same `kind`/`schema` columns as `app_storage`:
// a script can therefore hold a typed "table" value, usable by the Data Studio.
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

// Execution trace of a run: each step (home.step), SDK call (home.*), and
// console log becomes a row, organized as a tree via parentId.
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
    // "explicit" = via home.step(), "implicit" = future // @step (popped at the next step / EOF).
    origin: text("origin", { enum: spanOrigin }),
    label: text("label"),
    method: text("method"),
    // args / result: stringified JSON, truncated (~4 KB).
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

// History of a script's versions (snapshot on every update).
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
// Custom dashboards (grid of apps)
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
// LLM usage tracking
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
// Agent: assistant conversation threads.
// One message = one row, `parts` carries the UIMessage['parts'] JSON as-is.
// This is the single source of truth: the UI reads it directly, the LLM layer
// goes through convertToModelMessages. No custom conversion.
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
    /** Stable order within the thread: createdAt alone can collide. */
    seq: integer("seq").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("agent_messages_thread").on(t.threadId, t.seq)],
);

// ---------------------------------------------------------------------------
// Generation chat (apps + scripts) — legacy, fed by services/messages.
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
    // The memory comes from an assistant conversation: the thread lives in agent_threads.
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

// History of MCP calls (tool → result), per user.
export const mcpToolCalls = sqliteTable(
  "mcp_tool_calls",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    // Token prefix (hai_xxxx) if the call came from a PAT.
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

// One row = one chat message. `tool` carries the tool call, `plan` the editable plan (apps).
export const assistantMessages = sqliteTable(
  "assistant_messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => assistantThreads.id, { onDelete: "cascade" }),
    role: text("role", { enum: assistantMessageRole }).notNull(),
    content: text("content").notNull().default(""),
    // Model reasoning (chain-of-thought). Stored separately to avoid polluting the output markdown.
    reasoning: text("reasoning"),
    // `assistant` message that requested tools: JSON list [{id,name,args}].
    toolCalls: text("tool_calls"),
    // `tool` message: execution of a tool call.
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
