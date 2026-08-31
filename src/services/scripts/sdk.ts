import { getConnectionConfigByType, ConnectionError } from "@/services/connections/connections";
import { connectionRegistry } from "@/services/connections/registry";
import { httpFetch } from "@/services/connections/webhook";
import {
  clickBrowserSession,
  closeBrowserSession,
  evaluateBrowserSession,
  fillBrowserSession,
  htmlBrowserSession,
  openBrowserSession,
  textBrowserSession,
  waitBrowserSession,
} from "@/services/browser/sessions";
import {
  appScope,
  scriptScope,
  globalScope,
  storageDelete,
  storageGet,
  storageList,
  storageRowOp,
  storageSet,
} from "@/services/storage/storage";
import type { TableRowOp } from "@/lib/storage-table";
import type { StorageScope } from "@/services/storage/scope";
import { getApp } from "@/services/apps/apps";
import { ScriptError } from "./scripts";
import {
  LlmError,
  sanitizeChatMessages,
  type ChatMessage,
} from "@/services/llm/llm";
import { getEffectiveDefaults } from "@/services/llm/settings";

/**
 * Server SDK exposed to script code under the name `home`.
 * Built dynamically from the registry (no more manual switch).
 * Same surface as the iframe-side `homeSDK`, resolved through the owner.
 */

async function getCfg<T>(ownerId: string, type: string): Promise<T> {
  const cfg = await getConnectionConfigByType(ownerId, type as never);
  if (!cfg) throw new ConnectionError(`No ${type} connection (see Connections).`);
  return cfg.data as T;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ScriptSdk = any;

/** Traced SDK used by the runner: adds grouping by phases. */
export interface TracedScriptSdk extends ScriptSdk {
  step: (label: string, fn: () => unknown) => Promise<unknown>;
  __pushStep: (label: string) => string;
  __popStep: () => void;
}

/** Storage API exposed to the script, for a given scope. */
function storageApi(scope: StorageScope) {
  const rowOp = (key: string, op: TableRowOp) => storageRowOp(scope, key, op);
  return {
    get: (key: string) => storageGet(scope, key),
    set: (key: string, value: unknown) => storageSet(scope, key, value).then(() => true),
    list: () => storageList(scope),
    remove: (key: string) => storageDelete(scope, key).then(() => true),
    table: {
      // Same returns as bridgeRpc: the row for add/update/toggle, and a delete
      // acknowledgement for remove.
      add: (key: string, row: Record<string, unknown>) =>
        rowOp(key, { kind: "add", row }).then((r) => r.changed ?? null),
      update: (key: string, id: string, patch: Record<string, unknown>) =>
        rowOp(key, { kind: "update", id, patch }).then((r) => r.changed ?? null),
      remove: (key: string, id: string) =>
        rowOp(key, { kind: "remove", id }).then((r) => ({ ok: true, removed: r.removed ?? 0 })),
      toggle: (key: string, id: string, field?: string) =>
        rowOp(key, { kind: "toggle", id, field }).then((r) => r.changed ?? null),
    },
  };
}

/**
 * Storage of a third-party app, resolved on every call to check that the
 * script's owner really has access to it.
 */
function appStorageApi(ownerId: string, appId: string) {
  const resolve = async () => {
    const app = await getApp(ownerId, appId);
    if (!app) throw new ScriptError(`App ${appId} not found or not accessible.`);
    return storageApi(appScope(app.id));
  };
  return {
    get: (key: string) => resolve().then((s) => s.get(key)),
    set: (key: string, value: unknown) => resolve().then((s) => s.set(key, value)),
    list: () => resolve().then((s) => s.list()),
    remove: (key: string) => resolve().then((s) => s.remove(key)),
    table: {
      add: (key: string, row: Record<string, unknown>) => resolve().then((s) => s.table.add(key, row)),
      update: (key: string, id: string, patch: Record<string, unknown>) =>
        resolve().then((s) => s.table.update(key, id, patch)),
      remove: (key: string, id: string) => resolve().then((s) => s.table.remove(key, id)),
      toggle: (key: string, id: string, field?: string) => resolve().then((s) => s.table.toggle(key, id, field)),
    },
  };
}

/** Builds the `home` SDK for a script run (resolved through the owner). */
export function buildScriptSdk(
  ownerId: string,
  options: { runId?: string; scriptId?: string; webhookPayload?: unknown } = {},
): ScriptSdk {
  const scope = scriptScope(options.scriptId ?? "");
  const global = globalScope(ownerId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdk: any = {
    // Inbound webhook payload (set when the script is triggered through
    // POST /api/hooks/<slug>), sinon null.
    webhook: {
      payload: options.webhookPayload ?? null,
    },
    storage: {
      ...storageApi(scope),
      global: {
        get: (key: string) => storageGet(global, key),
        set: (key: string, value: unknown) => storageSet(global, key, value).then(() => true),
        list: () => storageList(global),
        remove: (key: string) => storageDelete(global, key).then(() => true),
      },
    },
    // Explicit access to another app's storage (the script does not own it).
    app: (appId: string) => ({ storage: appStorageApi(ownerId, appId) }),
    http: {
      fetch: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
        httpFetch(null, url, init),
    },
    browser: {
      open: (url: string, opts?: { timeoutMs?: number }) => openBrowserSession(url, { ...opts, runId: options.runId }),
      click: (sessionId: string, selector: string) => clickBrowserSession(sessionId, selector),
      fill: (sessionId: string, selector: string, value: string) => fillBrowserSession(sessionId, selector, value),
      wait: (sessionId: string, selector: string, timeoutMs?: number) => waitBrowserSession(sessionId, selector, timeoutMs),
      text: (sessionId: string, selector?: string) => textBrowserSession(sessionId, selector),
      html: (sessionId: string, selector?: string) => htmlBrowserSession(sessionId, selector),
      evaluate: (sessionId: string, expression: string) => evaluateBrowserSession(sessionId, expression),
      close: (sessionId: string) => closeBrowserSession(sessionId),
    },
    ai: {
      chat: (prompt: string, opts?: { system?: string; temperature?: number; maxTokens?: number }) => {
        if (!prompt.trim()) return Promise.reject(new LlmError("Empty AI prompt."));
        const messages: ChatMessage[] = [];
        if (opts?.system) messages.push({ role: "system", content: String(opts.system) });
        messages.push({ role: "user", content: prompt });
        return aiChat(ownerId, messages, { ...opts, scriptId: options.scriptId });
      },
      messages: (messages: ChatMessage[], opts?: { system?: string; temperature?: number; maxTokens?: number }) =>
        aiChat(ownerId, sanitizeChatMessages(messages), { ...opts, scriptId: options.scriptId }),
      chatStream: (
        prompt: string,
        opts?: { system?: string; temperature?: number; maxTokens?: number },
        onToken?: (token: string) => void,
      ) => {
        if (!prompt.trim()) return Promise.reject(new LlmError("Empty AI prompt."));
        if (typeof opts === "function" && !onToken) {
          onToken = opts as unknown as (t: string) => void;
          opts = undefined;
        }
        const messages: ChatMessage[] = [];
        if (opts?.system) messages.push({ role: "system", content: String(opts.system) });
        messages.push({ role: "user", content: prompt });
        return aiChatStream(ownerId, messages, { ...opts, onToken, scriptId: options.scriptId });
      },
      messagesStream: (
        messages: ChatMessage[],
        opts?: { temperature?: number; maxTokens?: number },
        onToken?: (token: string) => void,
      ) => {
        if (typeof opts === "function" && !onToken) {
          onToken = opts as unknown as (t: string) => void;
          opts = undefined;
        }
        return aiChatStream(ownerId, sanitizeChatMessages(messages), { ...opts, onToken, scriptId: options.scriptId });
      },
    },
  };

  for (const provider of connectionRegistry.values()) {
    const ns = provider.sdk.namespace;
    if (!sdk[ns]) sdk[ns] = {};
    for (const [methodKey, fn] of Object.entries(provider.sdk.methods)) {
      const parts = methodKey.split(".");
      let cur = sdk[ns] as Record<string, unknown>;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        if (!cur[p] || typeof cur[p] !== "object") cur[p] = {};
        cur = cur[p] as Record<string, unknown>;
      }
      const leaf = parts[parts.length - 1];
      cur[leaf] = (...args: unknown[]) =>
        getCfg(ownerId, provider.type).then((cfg) => (fn as (...a: unknown[]) => Promise<unknown>)(cfg, ...args));
    }
  }

  // The `mail` namespace is shared by smtp (send) and imap (search/read)
  // The loop above already merged the methods into sdk.mail

  return sdk as ScriptSdk;
}

/** LLM call for the SDK, resolved through the owner (the "build" model). Internal streaming. */
async function aiChat(
  ownerId: string,
  messages: ChatMessage[],
  opts?: { system?: string; temperature?: number; maxTokens?: number; scriptId?: string },
): Promise<string> {
  const { chatCompletionStream } = await import("@/services/llm/llm");
  const defaults = await getEffectiveDefaults(ownerId);
  const { text } = await chatCompletionStream(messages, {
    provider: defaults.provider,
    model: defaults.coderModel,
    temperature: opts?.temperature,
    maxTokens: opts?.maxTokens,
    userId: ownerId,
    feature: "ai_sdk_script",
    scriptId: opts?.scriptId ?? null,
    appId: null,
  });
  return text;
}

async function aiChatStream(
  ownerId: string,
  messages: ChatMessage[],
  opts?: { temperature?: number; maxTokens?: number; onToken?: (token: string) => void; scriptId?: string },
): Promise<string> {
  const { chatCompletionStream } = await import("@/services/llm/llm");
  const { getEffectiveDefaults } = await import("@/services/llm/settings");
  const defaults = await getEffectiveDefaults(ownerId);
  const { text } = await chatCompletionStream(messages, {
    provider: defaults.provider,
    model: defaults.coderModel,
    temperature: opts?.temperature,
    maxTokens: opts?.maxTokens,
    onToken: opts?.onToken,
    userId: ownerId,
    feature: "ai_sdk_script",
    scriptId: opts?.scriptId ?? null,
    appId: null,
  });
  return text;
}
