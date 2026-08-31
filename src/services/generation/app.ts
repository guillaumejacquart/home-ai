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
 * Prompt-driven app generation (the "Lovable" core), split into two phases that
 * can be called separately (so the UI can show real progress):
 *  1. `planApp`: planner (GLM by default) → plan.
 *  2. `codeApp`: implementer (DeepSeek by default) → full HTML.
 *
 * State between the two phases travels through the client (the plan is returned
 * then fed back in): no server-side session to maintain.
 *
 * Iterating: as soon as the app has a current HTML (`currentHtml`), both phases
 * switch to "modification" mode — the planner produces an evolution/fix plan and
 * the coder receives the history of previous exchanges plus the current HTML
 * (truncated when very large) with a TARGETED PATCH instruction (do not rewrite
 * the whole file, preserve the storage keys).
 *
 * Conventions imposed on the generated code (Alpine.js + Tailwind) for a clean
 * result.
 */

/** Context guard rail: high enough to let a whole app through. */
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
- MODIFYING AN EXISTING APP — do NOT return the whole file, return EDIT BLOCKS:
    - EXACT format, one block per change, and NOTHING else in your answer (no prose, no \`\`\`):
      <<<<<<< SEARCH
      (lines to replace, copied VERBATIM from the current code)
      =======
      (replacement lines)
      >>>>>>> REPLACE
    - The SEARCH part must be copied character for character from the current code, indentation included. It must appear EXACTLY ONCE in the file: add surrounding context lines if needed to make it unique.
    - Change the strict minimum. Anything not concerned appears in no block, so it stays intact.
    - Never touch the storage keys, the manifest or the storage comment, unless the request explicitly requires it.
    - To add code, SEARCH a neighbouring existing line and repeat it in the REPLACE followed by your addition.`
    : "";
  return `You are a front-end developer building small household web apps inside a single HTML page.
${iterationRules}
STRICT CONVENTIONS — follow them to the letter:
- Produce an HTML FRAGMENT, NOT a full document: no <!DOCTYPE>, <html>, <head> or <body>. The platform wraps your code in a document that already loads the libraries. Your code starts directly with the storage comment, then the markup.
- DO NOT include a Tailwind <link> or an Alpine <script>: the platform already injects Tailwind and Alpine.js. Just use the Tailwind classes and the Alpine attributes (x-data, x-for, x-model, x-on, x-text, x-show).
- ALPINE BOOTSTRAP — follow this pattern EXACTLY, it is the only reliable one:
     - Define ONE global function named \`app\` returning the state/actions object: \`function app() { return { ... } }\`.
     - Use \`x-data="app()"\` on the root element.
     - DO NOT use \`Alpine.data\`, \`document.addEventListener('alpine:init', ...)\`, or \`window.app\`. Strictly forbidden: it breaks the binding.
- PRELOADED LIBS — the platform already injects:
     - Tailwind CSS (utility classes) and Alpine.js 3.
     - Chart.js 4 (global \`Chart\`, UMD): available without importing. For a chart, add \`<canvas x-ref="myChart"></canvas>\` then in the JS: \`this._chart?.destroy(); this._chart = new Chart(this.$refs.myChart, { type: 'bar', data: { labels: [...], datasets: [{ label: '...', data: [...] }] }, options: { responsive: true } })\`. Call it inside \`$nextTick\` or after the data has loaded. DO NOT add a Chart.js <script>.
     - Dates: use the built-ins (\`new Date().toISOString().slice(0,10)\`, \`Intl.DateTimeFormat\` with the user's locale) — no external library needed.
     - Strict CSP: only \`cdn.jsdelivr.net\` is allowed for scripts/styles. Do not try to import from another CDN (blocked).
- Structure the JavaScript with separate, named functions. No spaghetti JS inside attributes.
- Careful design: responsive layout, clean spacing, coherent palette, readability.
- Any external data or persistence goes through the global \`homeSDK\` object (provided by the platform). No direct fetch to the outside. Available methods (all async, handle errors with try/catch):
     - \`homeSDK.storage.get(key)\`, \`.set(key, value)\`, \`.list()\`, \`.remove(key)\` — per-app persisted JSON KV.
      - \`homeSDK.storage.table.add("todos", {text: "..."} )\` → created row (auto-generated id), \`.update("todos", id, patch)\`, \`.remove("todos", id)\` → {ok, removed}, \`.toggle("todos", id, "done"?)\` — row-by-row CRUD on an array of objects, WITHOUT rewriting the whole list: prefer this for any collection (no read-modify-write of a whole get/set).
      - \`homeSDK.storage.global.get(key)\`, \`.set(key, value)\`, \`.list()\`, \`.remove(key)\` — global JSON KV shared across all of the user's apps (use only for genuinely shared data, e.g. a common household list).
- KEY CONVENTION — follow it so the assistant and MCP can find your data:
     - ONE key per collection, lowercase (kebab-case): e.g. \`todos\` = \`[{"id":"a","text":"...","done":false,"createdAt":1710000000}]\`, \`settings\` = object, \`counter\` = number.
     - No dynamic per-item keys (e.g. \`todo-1\`, \`todo-2\`): always group into ONE array key.
     - Add a \`<!-- storage: todos, settings -->\` comment at the top of the HTML listing the keys you use, to ease maintenance.
- MANIFEST (optional but recommended when the app handles data): declare what the app exposes to MCP and to the assistant. At the end of the <body>, add a script exactly in this shape:
     \`<script type="application/json" id="home-manifest">{"tools":[{"name":"add","description":"Add a task to the list","parameters":{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]},"storage":{"op":"append","key":"todos"}},{"name":"toggle","description":"Mark a task as done/not done","parameters":{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]},"storage":{"op":"toggle","key":"todos"}},{"name":"remove","description":"Remove a task","parameters":{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]},"storage":{"op":"remove","key":"todos"}}]}</script>\`
     - \`name\`: lowercase + underscores (e.g. \`add\`, \`toggle\`). \`description\`: a clear sentence. \`parameters\`: JSON Schema (\`type\` + \`properties\` + \`required\`).
     - \`storage.op\`: \`get\`/\`list\` (read), \`set\` (write the whole value, \`value\` parameter), \`append\` (add an element, the other parameters become its fields plus an auto-generated \`id\`), \`remove\` (delete by \`id\`), \`toggle\` (flip \`done\` by \`id\`, optional \`field\` parameter).
     - \`storage.key\`: the KV key managed by the tool (e.g. \`todos\`). Every element must have a unique \`id\` field.
     - Do not declare more than 5 tools. If the app has no persisted data, do NOT include this script.
- STRICTLY FORBIDDEN: NEVER use \`localStorage\`, \`sessionStorage\`, \`IndexedDB\` or \`document.cookie\`. The iframe is sandboxed (opaque origin): those APIs are unavailable or throwaway, and the data would be lost. All persistence = \`homeSDK.storage.*\`.
- Every \`homeSDK.*\` call returns a Promise: \`await\` is mandatory. Load persisted data initially inside an \`async init()\`, with a loading indicator and a try/catch.
- Persistence example to adapt (do not copy verbatim):
     async init() {
       this.loading = true;
       try {
         this.tasks = (await homeSDK.storage.get("tasks")) ?? [];
       } catch (e) {
         this.error = "Could not load the data.";
       }
       this.loading = false;
     },
     async saveTasks() {
       await homeSDK.storage.set("tasks", this.tasks);
     }
 ${sdkLines}
      - \`homeSDK.http.fetch(url, {method?, headers?, body?})\` → {status, body, headers} (generic public fetch, blocked for private IPs)
      - \`homeSDK.ai.chat(prompt, {system?, temperature?, maxTokens?})\` → string (text generated by the owner's LLM, "build" model); \`homeSDK.ai.messages([{role: "system"|"user"|"assistant", content}, ...], {temperature?, maxTokens?})\` → string (multi-turn)
      - \`homeSDK.ai.chatStream(prompt, {system?, temperature?, maxTokens?}, onToken)\` → string (same as chat but streamed: \`onToken\` is called for every token, ideal to display a live answer with \`onToken: (tok) => { this.reply += tok }\`); \`homeSDK.ai.messagesStream(messages, opts, onToken)\` likewise
      - \`homeSDK.scripts.list()\` → [{id, name, triggerKind, enabled, lastRunAt}] (triggerable scripts), \`homeSDK.scripts.run(nameOrId, payload?)\` → {runId, status:"running"} (starts the script WITHOUT waiting for it to finish), \`homeSDK.scripts.runStatus(runId)\` → {status, output, error, durationMs}, \`homeSDK.scripts.lastRun(nameOrId)\` → same shape or null
    Use these methods for external data; leave optional fields at their defaults. On failure (e.g. service not connected), show a clear message to the user.
- AI calls (\`homeSDK.ai.*\`) are slow (several seconds): show a loading state and handle errors with try/catch. Prefer \`chatStream\`/\`messagesStream\` for a live UX.
- Button that starts a script: \`run()\` returns immediately, so you must poll \`runStatus(runId)\` every second until \`status\` is no longer \`"running"\`. Disable the button while it runs (a script has real effects: double click = double send) and ask for confirmation before an irreversible action.
- Use \`async/await\` and surface errors clearly.
- Forms use @submit.prevent; alert/confirm() are available.

Answer ONLY with the complete HTML code, inside a code block marked \`\`\`html ... \`\`\`.`;
}

const PLANNER_SYSTEM = `You are a technical project manager. The user wants to create a small household web app.
Analyse the request and answer with ONLY a JSON object in this format:
{
  "summary": "one-sentence summary of what the app will do",
  "sections": ["short list of the screens/sections to plan for"],
  "data": ["data to display or manage"],
  "notes": ["any points needing attention"]
}
No text other than the JSON.`;

const PLANNER_ITERATION_SYSTEM = `You are modifying an existing household web app: the user wants to evolve or fix an app already in use.
Analyse the request (and the iteration context provided) and answer with ONLY a JSON object in this format:
{
  "summary": "one-sentence summary of the request (evolution or fix)",
  "changes": ["list of the modifications to make, point by point"],
  "keep": ["list of existing elements that must absolutely be kept (functions, storage keys, sections)"],
  "risks": ["regression risks or points to watch (e.g. storage keys not to break)"]
}
No text other than the JSON.`;

/** Planner system prompt: creation or iteration depending on whether a current HTML exists. */
function buildPlannerSystem(isIterating: boolean): string {
  return isIterating ? PLANNER_ITERATION_SYSTEM : PLANNER_SYSTEM;
}

/**
 * The stored format is a FRAGMENT (see the repo templates), so requiring a
 * trailing `</html>` flagged every correct template-based app as truncated.
 * We therefore look for the real signs of a cut mid-output.
 */
export function looksTruncatedHtml(
  html: string,
  finishReason: string | null,
): boolean {
  if (finishReason === "length") return true;
  const text = html.trim();
  if (!text) return true;
  // <script> opened and never closed: cut in the middle of the code.
  const opened = (text.match(/<script\b/gi) ?? []).length;
  const closed = (text.match(/<\/script\s*>/gi) ?? []).length;
  if (opened !== closed) return true;
  // Cut in the middle of a tag.
  if (/<[a-z][^>]*$/i.test(text)) return true;
  // A valid fragment ends on a closing tag; a cut mid-word ("…incomp") does not
  // end with ">".
  return !text.endsWith(">");
}

/** Detects use of browser storage, which is forbidden in the sandboxed iframe. */
export function containsForbiddenStorage(html: string): boolean {
  return /\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/.test(html);
}

/** Detects a forbidden Alpine pattern (Alpine.data / alpine:init / window.app). */
export function containsForbiddenAlpine(html: string): boolean {
  return (
    /\bAlpine\.data\s*\(/.test(html) ||
    /alpine:init/.test(html) ||
    /\bwindow\.app\s*=/.test(html) ||
    /document\.addEventListener\s*\(\s*['"]alpine:init['"]/.test(html)
  );
}

/** Extracts the HTML from a markdown \`\`\`html ... \`\`\` block, otherwise the whole text. */
const CLOSING_HTML = "</html>";

export function extractHtml(text: string): string {
  // Well-formed markdown block: ```html ... ```
  const m = text.match(/```html\s*([\s\S]*?)```/i);
  const raw = m && m[1]?.trim()
    ? m[1].trim()
    // Otherwise strip the ```html / ``` markers left at the start and end.
    : text
        .trim()
        .replace(/^```html\s*/i, "")
        .replace(/^```\s*/, "")
        .replace(/\s*```$/, "");

  // A chatty model comments on its work after the document. Without trimming,
  // the text no longer ends with </html> and `looksTruncatedHtml` reports a
  // truncation even though the HTML is complete.
  const end = raw.toLowerCase().lastIndexOf(CLOSING_HTML);
  return end === -1 ? raw : raw.slice(0, end + CLOSING_HTML.length);
}

function userContent(input: NewAppInput, prompt: string): string {
  return `App name: ${input.name}
Description: ${input.description ?? "—"}
Request: ${prompt}`;
}

/** Iteration context for the planner: storage keys, size, history. */
function plannerContext(
  previousHtml: string | null,
  history: GenerationHistoryEntry[],
): string {
  const lines: string[] = [];
  if (previousHtml) {
    const keys = extractStorageKeys(previousHtml);
    const summary = [`Context — the app already exists:`];
    if (keys.length) summary.push(`Storage keys in use: ${keys.join(", ")}.`);
    summary.push(`Current HTML size: ${previousHtml.length} characters.`);
    lines.push(summary.join("\n"));
  }
  const historyBlock = formatHistory(history);
  if (historyBlock) lines.push(historyBlock);
  return lines.join("\n\n");
}

/** Drops the latest iteration (current user + plan): already given to the coder explicitly. */
function trimCurrentTurn(history: GenerationHistoryEntry[]): GenerationHistoryEntry[] {
  if (history.length < 2) return history;
  if (history[history.length - 1]?.role !== "plan") return history;
  return history.slice(0, -2);
}

/** Phase 1: planning. Records the user + plan messages. */
export async function planApp(
  appId: string,
  input: NewAppInput,
  prompt: string,
  opts: GenerateOptions = {},
): Promise<{ plan: string; model: string }> {
  const plannerModel = opts.plannerModel ?? defaultModels.planner;

  const ownerId = await getAppOwnerId(appId);
  if (!ownerId) throw new Error("App not found.");

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
    throw new LlmError("The planner returned nothing (empty response). Retry with a more precise prompt.");
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

/** Phase 2: code implementation. Records the assistant message + version. */
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
  if (!ownerId) throw new Error("App not found.");

  const isIterating = Boolean(previousHtml);
  const history = await listAppMessages(appId);
  const historyBlock = formatHistory(trimCurrentTurn(history));

  // The coder must see the whole file: at 10k it only saw 46% of it (start +
  // end), with the middle — hence the code to change — replaced by a marker.
  // Input is cheap compared to output, so the guard rail stays very high.
  const truncated = previousHtml ? truncateHtml(previousHtml, CONTEXT_MAX_CHARS) : null;
  const contextBlock = truncated
    ? `Here is the app's current code. Apply the request as a TARGETED PATCH: keep everything unrelated, fix only what is needed.\n\`\`\`html\n${truncated}\n\`\`\``
    : "This is a new app: produce it in full.";

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

Proposed plan:
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
    // When iterating the response is made of edit blocks: the only sign of
    // a usable cut is finishReason, not the shape of the HTML.
    (text, finishReason) =>
      isIterating ? finishReason === "length" : looksTruncatedHtml(extractHtml(text), finishReason),
  );

  const coderSystem = buildCoderSystem(isIterating) + languageInstruction(opts.locale);
  const coderUser = `${userContent(input, prompt)}\n\nProposed plan:\n${plan}\n\n${historyBlock ? `${historyBlock}\n\n` : ""}${contextBlock}`;

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
    console.warn("[generation:edit-blocks] falling back to a full rewrite", {
      appId,
      reason: resolved.reason,
    });
    const rewrite = await chatWithTruncationRetry(
      [
        { role: "system", content: buildCoderSystem(false) + languageInstruction(opts.locale) },
        {
          role: "user",
          content: `${userContent(input, prompt)}\n\nProposed plan:\n${plan}\n\n${historyBlock ? `${historyBlock}\n\n` : ""}${contextBlock}`,
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

  // Extract + validate the manifest declared by the generated code (when present).
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
 * Repair pass: when the generated code uses browser storage forbidden in the
 * sandboxed iframe (localStorage…), we ask the coder to switch to
 * `homeSDK.storage.*`. Returns the fixed HTML, or null when nothing to fix.
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
        content: `The following code uses \`localStorage\` / \`sessionStorage\` / \`document.cookie\`, which are forbidden in the sandboxed iframe (the data is lost). Replace the whole persistence layer with \`homeSDK.storage.*\` (get/set/list/remove, all async — do not forget the \`await\`s). Leave the UI and the rest of the logic unchanged.\n\n\`\`\`html\n${html}\n\`\`\``,
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
      "The generated code still uses localStorage, which is forbidden in the sandboxed iframe. Fix it manually or run the generation again.",
    );
  }
  return fixedHtml;
}

/**
 * Repair pass: when the generated code uses a forbidden Alpine pattern
 * (Alpine.data / alpine:init / window.app), we ask the coder to switch to
 * `function app(){return{...}}` + `x-data="app()"`. Returns the fixed HTML, or null when nothing to fix.
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
        content: `The following code uses \`Alpine.data\` / \`alpine:init\` / \`window.app\`, which the platform forbids (it breaks the Alpine binding). You MUST replace them with the single supported pattern: a global \`function app() { return { ... } }\` and \`x-data="app()"\\ on the root. Remove every \`Alpine.data\`, \`document.addEventListener('alpine:init')\` and \`window.app = ...\`. Leave the UI and the logic unchanged.\n\n\`\`\`html\n${html}\n\`\`\``,
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
      "The generated code still uses Alpine.data / alpine:init, which the platform forbids. Fix it manually or run the generation again.",
    );
  }
  return fixedHtml;
}

export interface StreamCallbacks {
  onToken?: (token: string) => void;
  signal?: AbortSignal;
}

/** Streamed phase 1: same logic as planApp but pushes tokens through onToken. */
export async function planAppStream(
  appId: string,
  input: NewAppInput,
  prompt: string,
  opts: GenerateOptions & StreamCallbacks = {},
): Promise<{ plan: string; model: string }> {
  const plannerModel = opts.plannerModel ?? defaultModels.planner;
  const ownerId = await getAppOwnerId(appId);
  if (!ownerId) throw new Error("App not found.");
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
    throw new LlmError("The planner returned nothing (empty response). Retry with a more precise prompt.");
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
 * Resolves the coder's response into the final HTML.
 *
 * When iterating we expect edit blocks: the model's output drops from ~21 KB to
 * a few lines. If the blocks do not apply (SEARCH not found or ambiguous) we do
 * not guess: the caller falls back to a full rewrite.
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

/** 1 initial attempt + 2 retries before giving up on edit blocks. */
const MAX_EDIT_ATTEMPTS = 3;
/** The echo of the faulty response is capped: it may contain the whole file. */
const FAULTY_ECHO_MAX_CHARS = 2000;

export interface CoderAttempt {
  text: string;
  finishReason: string | null;
}

function editCorrectionPrompt(reason: string): string {
  return `Your answer could not be applied: ${reason}.

Return ONLY corrected SEARCH/REPLACE blocks, nothing else.
Rappels :
- the SEARCH part must be copied character for character from the current code given above, indentation included;
- it must appear EXACTLY ONCE in that code: add surrounding context lines to make it unique;
- do not rewrite the file, and do not comment on your work.`;
}

/**
 * Recovery loop: when the blocks do not apply we hand the coder its own output
 * plus the reason it failed, rather than asking for the whole file again. That
 * is what makes this reliable in practice — the model almost always fixes a
 * badly quoted SEARCH once it is told which one.
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
    // A cut response may hold complete blocks while having lost others: we
    // refuse to apply it partially.
    const outcome: { ok: true; html: string; edits: number } | { ok: false; reason: string } =
      attempt.finishReason === "length"
        ? { ok: false, reason: "response cut (finishReason=length), blocks may be incomplete" }
        : resolveCoderOutput(attempt.text, previousHtml);

    if (outcome.ok) {
      if (n > 1) {
        console.warn("[generation:edit-blocks] applied on retry", {
          appId: ctx.appId,
          attempt: n,
          edits: outcome.edits,
        });
      }
      return outcome;
    }
    if (n === MAX_EDIT_ATTEMPTS) return outcome;

    console.warn("[generation:edit-blocks] attempt rejected, asking again", {
      appId: ctx.appId,
      attempt: n,
      reason: outcome.reason,
    });
    extra.push({ role: "assistant", content: attempt.text.slice(0, FAULTY_ECHO_MAX_CHARS) });
    extra.push({ role: "user", content: editCorrectionPrompt(outcome.reason) });
    attempt = await askAgain([...extra]);
  }

  return { ok: false, reason: "retries exhausted" };
}

/** Streamed phase 2: same logic as codeApp but pushes tokens through onToken. */
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
  if (!ownerId) throw new Error("App not found.");
  const isIterating = Boolean(previousHtml);
  const history = await listAppMessages(appId);
  const historyBlock = formatHistory(trimCurrentTurn(history));
  const truncatedStream = previousHtml ? truncateHtml(previousHtml, CONTEXT_MAX_CHARS) : null;
  const contextBlock = truncatedStream
    ? `Here is the app's current code. Apply the request as a TARGETED PATCH: keep everything unrelated, fix only what is needed.\n\`\`\`html\n${truncatedStream}\n\`\`\``
    : "This is a new app: produce it in full.";
  const t = Date.now();
  // Streaming with a manual retry (no automatic budget doubling in stream mode, for simplicity)
  let fullText = "";
  let finishReason: string | null = null;
  const streamResult = await chatCompletionStream(
    [
      { role: "system", content: buildCoderSystem(isIterating) + languageInstruction(opts.locale) },
      {
        role: "user",
        content: `${userContent(input, prompt)}\n\nProposed plan:\n${plan}\n\n${historyBlock ? `${historyBlock}\n\n` : ""}${contextBlock}`,
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
  const coderUser = `${userContent(input, prompt)}\n\nProposed plan:\n${plan}\n\n${historyBlock ? `${historyBlock}\n\n` : ""}${contextBlock}`;

  // Normal iteration path: apply the blocks, retrying if needed.
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
    // The blocks could not be applied: we do not guess, we ask again for the
    // whole file. Slow but safe, and the log says what failed.
    console.warn("[generation:edit-blocks] falling back to a full rewrite", {
      appId,
      reason: resolved.reason,
    });
    const rewrite = await chatCompletionStream(
      [
        {
          role: "system",
          content: buildCoderSystem(false) + languageInstruction(opts.locale),
        },
        {
          role: "user",
          content: `${userContent(input, prompt)}\n\nProposed plan:\n${plan}\n\n${historyBlock ? `${historyBlock}\n\n` : ""}${contextBlock}`,
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
      throw new LlmError("Model response truncated (token limit reached). Please retry.");
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