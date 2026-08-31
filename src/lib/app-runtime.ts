/**
 * Builds the full HTML document served inside an app's sandboxed iframe.
 *
 * The platform injects Tailwind and Alpine.js, then the `homeSDK` bridge that
 * talks to the parent page over postMessage (opaque origin → no direct
 * cookies/fetch). The parent relays the calls to `/api/apps/[id]/rpc`.
 */

import { injectedLibTags } from "@/lib/app-libs";
import { isRowOpInput } from "@/lib/storage-table";
import type { ChatMessage } from "@/services/llm/llm";
import { methodRegistry } from "@/services/connections/registry";

// ---------------------------------------------------------------------------
// BRIDGE generated from the registry (no more manual coupling)
// ---------------------------------------------------------------------------

function buildBridgeEntries(): string {
  // Namespace tree: namespace -> (nested key -> fullMethod)
  const tree = new Map<string, Map<string, unknown>>();

  for (const entry of methodRegistry.values()) {
    let node = tree.get(entry.namespace);
    if (!node) {
      node = new Map<string, unknown>();
      tree.set(entry.namespace, node);
    }
    const parts = entry.methodKey.split(".");
    let cur: Map<string, unknown> = node;
    for (let i = 0; i < parts.length - 1; i++) {
      let next = cur.get(parts[i]) as Map<string, unknown> | undefined;
      if (!next || typeof next === "string") {
        next = new Map<string, unknown>();
        cur.set(parts[i], next);
      }
      cur = next;
    }
    cur.set(parts[parts.length - 1], entry.fullMethod);
  }

  function mapToJs(map: Map<string, unknown>): string {
    const entries: string[] = [];
    for (const [k, v] of map) {
      if (typeof v === "string") {
        entries.push(
          `${k}: function(){ return call("${v}", ...Array.prototype.slice.call(arguments)) }`,
        );
      } else {
        entries.push(`${k}: { ${mapToJs(v as Map<string, unknown>)} }`);
      }
    }
    return entries.join(", ");
  }

  const parts: string[] = [];
  for (const [ns, node] of tree) {
    parts.push(`${ns}: { ${mapToJs(node)} }`);
  }
  return parts.join(",\n    ");
}

const DYNAMIC_SDK = buildBridgeEntries();

const BRIDGE = `(function () {
  if (window.__homeSDK) return;
  var pending = {};
  var streaming = {};
  var seq = 0;
  var DEFAULT_TIMEOUT_MS = 3000;
  var AI_TIMEOUT_MS = 60000;

  function timeoutFor(method) {
    return method.indexOf("ai.") === 0 ? AI_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
  }

  function call(method) {
    var args = Array.prototype.slice.call(arguments, 1);
    var id = ++seq;
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        delete pending[id];
        reject(new Error("No response from the platform (timeout)"));
      }, timeoutFor(method));
      pending[id] = {
        resolve: function (v) { if (settled) return; settled = true; clearTimeout(timer); resolve(v); },
        reject: function (e) { if (settled) return; settled = true; clearTimeout(timer); reject(e); }
      };
      window.parent.postMessage(
        { type: "homesdk", id: id, method: method, args: JSON.parse(JSON.stringify(args)) },
        "*"
      );
    });
  }

  function callStream(method, args, onToken) {
    var id = ++seq;
    return new Promise(function (resolve, reject) {
      var settled = false;
      var acc = "";
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        delete streaming[id];
        reject(new Error("No response from the platform (timeout)"));
      }, AI_TIMEOUT_MS);
      streaming[id] = {
        onToken: onToken,
        resolve: function () { if (settled) return; settled = true; clearTimeout(timer); resolve(acc); },
        reject: function (e) { if (settled) return; settled = true; clearTimeout(timer); reject(e); },
        push: function (tok) { acc += tok; if (onToken) { try { onToken(tok); } catch (e) {} } }
      };
      window.parent.postMessage(
        { type: "homesdk-stream", id: id, method: method, args: JSON.parse(JSON.stringify(args)) },
        "*"
      );
    });
  }

  window.homeSDK = {
    storage: {
      get: function (key) { return call("storage.get", key); },
      set: function (key, value) { return call("storage.set", key, value); },
      list: function () { return call("storage.list"); },
      remove: function (key) { return call("storage.remove", key); },
      table: {
        add: function (key, row) { return call("storage.table.add", key, row); },
        update: function (key, id, patch) { return call("storage.table.update", key, id, patch); },
        remove: function (key, id) { return call("storage.table.remove", key, id); },
        toggle: function (key, id, field) { return call("storage.table.toggle", key, id, field); }
      },
      global: {
        get: function (key) { return call("storage.global.get", key); },
        set: function (key, value) { return call("storage.global.set", key, value); },
        list: function () { return call("storage.global.list"); },
        remove: function (key) { return call("storage.global.remove", key); }
      }
    },
    ${DYNAMIC_SDK},
    scripts: {
      list: function () { return call("scripts.list"); },
      run: function (nameOrId, payload) { return call("scripts.run", nameOrId, payload); },
      runStatus: function (runId) { return call("scripts.runStatus", runId); },
      lastRun: function (nameOrId) { return call("scripts.lastRun", nameOrId); }
    },
    http: {
      fetch: function (url, init) { return call("http.fetch", url, init); }
    },
    ai: {
      chat: function (prompt, opts) { return call("ai.chat", prompt, opts); },
      messages: function (messages, opts) { return call("ai.messages", messages, opts); },
      chatStream: function (prompt, opts, onToken) {
        if (typeof opts === "function" && !onToken) { onToken = opts; opts = undefined; }
        return callStream("ai.chat", [prompt, opts], onToken);
      },
      messagesStream: function (messages, opts, onToken) {
        if (typeof opts === "function" && !onToken) { onToken = opts; opts = undefined; }
        return callStream("ai.messages", [messages, opts], onToken);
      }
    }
  };

  window.addEventListener("message", function (e) {
    var msg = e.data;
    if (!msg) return;
    if (msg.type === "homesdk-result" && pending[msg.id]) {
      var p = pending[msg.id];
      delete pending[msg.id];
      if (msg.ok) p.resolve(msg.value);
      else p.reject(new Error(msg.error || "Error"));
    } else if (msg.type === "homesdk-stream-token" && streaming[msg.id]) {
      streaming[msg.id].push(msg.token);
    } else if (msg.type === "homesdk-stream-done" && streaming[msg.id]) {
      var s = streaming[msg.id];
      delete streaming[msg.id];
      s.resolve();
    } else if (msg.type === "homesdk-stream-error" && streaming[msg.id]) {
      var se = streaming[msg.id];
      delete streaming[msg.id];
      se.reject(new Error(msg.error || "Error"));
    }
  });
})();`;

export function buildAppDocument(appHtml: string, appId: string): string {
  const metaCsp =
    "default-src 'none'; style-src 'unsafe-inline' https://cdn.jsdelivr.net; " +
    "script-src 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; img-src * data:; " +
    "font-src https://cdn.jsdelivr.net; connect-src https://cdn.jsdelivr.net; form-action 'none';";

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${metaCsp}" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
${injectedLibTags()}
</head>
<body data-appid="${appId}">
${appHtml}
<script>${BRIDGE}</script>
</body>
</html>`;
}

type RunView = {
  runId: string;
  status: string;
  output: string | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number | null;
};

function toRunView(run: {
  id: string;
  status: string;
  output: string | null;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
}): RunView {
  return {
    runId: run.id,
    status: run.status,
    output: run.output,
    error: run.error,
    startedAt: run.startedAt.getTime(),
    finishedAt: run.finishedAt?.getTime() ?? null,
    durationMs: run.durationMs,
  };
}

/**
 * `homeSDK.scripts.*`: an app can only trigger scripts owned by its own owner,
 * and `run` returns without waiting for the run to finish.
 */
async function handleScriptsRpc(op: string, args: unknown[], ownerId: string) {
  const scripts = await import("@/services/scripts/scripts");
  const runner = await import("@/services/scripts/runner");

  if (op === "list") return scripts.listOwnedScripts(ownerId);

  if (op === "runStatus") {
    const run = await runner.getScriptRun(String(args[0]));
    if (!run) throw new Error("Run not found.");
    const parent = await scripts.getScript(run.scriptId);
    if (!parent || parent.ownerId !== ownerId) throw new Error("Run not found.");
    return toRunView(run);
  }

  const script = await scripts.findOwnedScript(ownerId, String(args[0] ?? ""));
  if (!script) throw new Error(`Script not found: ${String(args[0] ?? "")}`);

  if (op === "run") {
    const { runId, done } = await runner.startScriptRun(script.id, { payload: args[1] });
    void done.catch(() => {});
    return { runId, status: "running" };
  }

  if (op === "lastRun") {
    const run = await runner.lastScriptRun(script.id);
    return run ? toRunView(run) : null;
  }

  throw new Error(`Unknown SDK method: scripts.${op}`);
}

/** Bridge relay: calls the server and returns the result to the iframe. */
export const bridgeRpc = {
  async handle(method: string, args: unknown[], ctx: { appId: string; ownerId: string }) {
    const { appId, ownerId } = ctx;

    // --- storage : par app (`storage.*`) ou global (`storage.global.*`) ---
    // Same code on both sides, only the scope differs.
    if (method.startsWith("storage.") && !method.startsWith("storage.table.")) {
      const isGlobal = method.startsWith("storage.global.");
      const op = isGlobal ? method.slice("storage.global.".length) : method.slice("storage.".length);
      if (["get", "set", "list", "remove"].includes(op)) {
        const store = await import("@/services/storage/storage");
        const scope = isGlobal ? store.globalScope(ownerId) : store.appScope(appId);
        if (op === "get") return store.storageGet(scope, String(args[0]));
        if (op === "list") return store.storageList(scope);
        if (op === "set") {
          await store.storageSet(scope, String(args[0]), args[1]);
          return true;
        }
        await store.storageDelete(scope, String(args[0]));
        return true;
      }
    }

    // --- table row ops (atomic CRUD on a "table" value) ---
    if (method.startsWith("storage.table.")) {
      const opKind = method.slice("storage.table.".length) as
        | "add"
        | "update"
        | "remove"
        | "toggle";
      if (!["add", "update", "remove", "toggle"].includes(opKind)) {
        throw new Error(`Unknown method: ${method}`);
      }
      const op =
        opKind === "add"
          ? { kind: "add" as const, row: args[1] as Record<string, unknown> }
          : opKind === "update"
            ? { kind: "update" as const, id: String(args[1]), patch: args[2] as Record<string, unknown> }
            : opKind === "remove"
              ? { kind: "remove" as const, id: String(args[1]) }
              : { kind: "toggle" as const, id: String(args[1]), field: args[2] === undefined ? undefined : String(args[2]) };
      if (!isRowOpInput(op)) throw new Error("invalidRowOp");
      const store = await import("@/services/storage/storage");
      const result = await store.storageRowOp(store.appScope(appId), String(args[0]), op);
      // add/update/toggle return the row; remove returns a delete acknowledgement.
      return result.changed ?? { ok: true, removed: result.removed ?? 0 };
    }

    // --- Scripts: manual trigger from an app (button) ---
    if (method.startsWith("scripts.")) {
      return handleScriptsRpc(method.slice("scripts.".length), args, ownerId);
    }

    // --- Generic HTTP (outside the registry, SSRF guard) ---
    if (method === "http.fetch") {
      return (await import("@/services/connections/webhook")).httpFetch(
        null,
        String(args[0]),
        args[1] as { method?: string; headers?: Record<string, string>; body?: string } | undefined,
      );
    }

    // --- IA ---
    if (method === "ai.chat") {
      const prompt = String(args[0] ?? "");
      if (!prompt.trim()) {
        const { LlmError } = await import("@/services/llm/llm");
        throw new LlmError("Empty AI prompt.");
      }
      const opts = args[1] as AiCallOptions | undefined;
      const messages: ChatMessage[] = [];
      if (opts?.system) messages.push({ role: "system", content: String(opts.system) });
      messages.push({ role: "user", content: prompt });
      return aiChat(ownerId, messages, { ...opts, appId });
    }
    if (method === "ai.messages") {
      const opts = args[1] as AiCallOptions | undefined;
      const { sanitizeChatMessages } = await import("@/services/llm/llm");
      return aiChat(ownerId, sanitizeChatMessages(args[0]), { ...opts, appId });
    }

    // --- Connections via registry (google, mail, telegram, notion, homeassistant, weather, webhook) ---
    const { getMethod, getProvider } = await import("@/services/connections/registry");
    const entry = getMethod(method);
    if (entry) {
      const { getConnectionConfigByType, ConnectionError } = await import(
        "@/services/connections/connections"
      );
      const cfg = await getConnectionConfigByType(ownerId, entry.type);
      if (!cfg) {
        throw new ConnectionError(`No ${entry.type} connection (see Connections).`);
      }
      // Resolved at call time so vitest mocks are picked up
      const provider = getProvider(entry.type);
      const fn =
        (provider?.sdk.methods[entry.methodKey] as
          | ((cfg: unknown, ...a: unknown[]) => Promise<unknown>)
          | undefined) ?? (entry.fn as (cfg: unknown, ...a: unknown[]) => Promise<unknown>);
      return fn(cfg.data, ...args);
    }

    throw new Error(`Unknown SDK method: ${method}`);
  },
};

interface AiCallOptions {
  system?: string;
  temperature?: number;
  maxTokens?: number;
}

/** LLM call for the SDK, resolved through the owner (the "build" model). Uses internal streaming to reduce timeouts. */
async function aiChat(
  ownerId: string,
  messages: ChatMessage[],
  opts?: AiCallOptions & { appId?: string; feature?: string },
): Promise<string> {
  const { chatCompletionStream } = await import("@/services/llm/llm");
  const { getEffectiveDefaults } = await import("@/services/llm/settings");
  const defaults = await getEffectiveDefaults(ownerId);
  const { text } = await chatCompletionStream(messages, {
    provider: defaults.provider,
    model: defaults.coderModel,
    temperature: opts?.temperature,
    maxTokens: opts?.maxTokens,
    userId: ownerId,
    feature: opts?.feature ?? "ai_sdk_app",
    appId: opts?.appId ?? null,
  });
  return text;
}
