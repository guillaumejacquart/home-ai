import { chatCompletion, chatCompletionStream, defaultModels } from "@/services/llm/llm";
import {
  chatWithTruncationRetry,
  languageInstruction,
  truncateCode,
  type GenerateOptions,
} from "@/services/generation/shared";
import { getSdkPromptLines } from "@/services/connections/registry";

type TriggerKind = "schedule" | "manual" | "webhook";

const TRIGGER_DEFAULT_SCHEDULE = "0 8 * * *";

/** Planification par défaut selon le trigger ("" pour un script non planifié). */
function scheduleFallback(triggerKind: TriggerKind): string {
  return triggerKind === "schedule" ? TRIGGER_DEFAULT_SCHEDULE : "";
}

function buildScriptSystem(triggerKind: TriggerKind): string {
  const sdkLines = getSdkPromptLines("home").join("\n    ");
  const scheduling =
    triggerKind === "schedule"
      ? `- Le job est \`async function main(home)\` exécuté côté serveur selon une expression cron 5 champs.\n- Tu DOIS fournir le champ \`schedule\` dans le JSON de sortie (expression cron 5 champs : minute heure jour-du-mois mois jour-de-la-semaine, ex. 0 8 * * 1 = chaque lundi à 8h).`
      : triggerKind === "manual"
        ? `- Le job est \`async function main(home)\` exécuté côté serveur à la demande (déclenchement manuel, ex. bouton dans une app). Pas de planification : le JSON de sortie ne contient PAS de champ \`schedule\`.`
        : `- Le job est \`async function main(home)\` exécuté côté serveur quand un webhook entrant est reçu (POST public). Le corps JSON du webhook est disponible via \`home.webhook.payload\` (null si absent). Pas de planification : le JSON de sortie ne contient PAS de champ \`schedule\`.`;
  const jsonContract =
    triggerKind === "schedule"
      ? `{
  "schedule": "expression cron 5 champs (ex: 0 8 * * 1)",
  "name": "nom court du job",
  "code": "le code JS complet de async function main(home) { ... }"
}`
      : `{
  "name": "nom court du job",
  "code": "le code JS complet de async function main(home) { ... }"
}`;
  return `Tu es un développeur qui crée un job (script serveur) pour une petite app familiale.

CONTRAT :
${scheduling}
- Le job est une fonction JavaScript \`async function main(home)\` exécutée côté serveur.
- \`home\` est le SDK fourni par la plateforme. Utilise UNIQUEMENT ces méthodes, avec EXACTEMENT ces signatures (ne jamais inventer de méthode ou de paramètre) :
    - \`home.storage.get(key)\`, \`home.storage.set(key, value)\`, \`home.storage.list()\`, \`home.storage.remove(key)\` (KV JSON propre au script)
    - \`home.app(appId).storage.*\` — même API (get/set/list/remove/table) mais sur le stockage d'une app existante. À utiliser dès que le job doit alimenter ou lire une app ; l'appId doit être fourni par l'utilisateur, ne jamais l'inventer.
    - \`home.storage.global.get(key)\`, \`.set(key, value)\`, \`.list()\`, \`.remove(key)\` (KV partagé au niveau du foyer)
    - \`home.storage.table.add(key, row)\` → ligne créée (id auto-généré), \`home.storage.table.update(key, id, patch)\` → ligne modifiée, \`home.storage.table.remove(key, id)\` → {ok, removed}, \`home.storage.table.toggle(key, id, field?)\` → ligne — CRUD atomique sur un tableau d'objets stocké sous \`key\`, sans réécrire la liste entière (privilégier au get/set entier pour les collections)
${sdkLines}
     - \`home.http.fetch(url, {method?, headers?, body?})\` → {status, body, headers} (fetch public, IPs privées bloquées)
     - \`home.browser.open(url, {timeoutMs?})\` → {sessionId, url, title, text} (page web publique, Lightpanda)
     - \`home.browser.click(sessionId, selector)\`, \`home.browser.fill(sessionId, selector, value)\`, \`home.browser.wait(sessionId, selector, timeoutMs?)\`
     - \`home.browser.text(sessionId, selector?)\`, \`home.browser.html(sessionId, selector?)\`, \`home.browser.evaluate(sessionId, expression)\`, \`home.browser.close(sessionId)\`
     - \`home.ai.chat(prompt, {system?, temperature?, maxTokens?})\` → string (texte généré par le LLM du propriétaire) ; \`home.ai.messages([{role: "system"|"user"|"assistant", content}, ...], opts?)\` → string (multi-tours)
     - \`home.ai.chatStream(prompt, opts, onToken)\` / \`home.ai.messagesStream(messages, opts, onToken)\` → string (même que ci-dessus mais streamé : \`onToken\` appelée par token, utile pour le live)
    Toute donnée externe passe par \`home\`. Gère les erreurs avec try/catch et console.log pour tracer.
- IMPORTANT : les appels IA (\`home.ai.*\`) prennent plusieurs secondes — utilise-les avec parcimonie (le run est limité à 60 s).
- OPTIONNEL : tu peux structurer le code en phases pour le flow d'exécution — deux syntaxes, 2-5 groupes max. Si tu n'utilises rien, le moteur trace quand même automatiquement chaque appel :
  1. Wrapper \`await home.step("Libellé", async () => { ... })\` — les appels \`home.*\` faits à l'intérieur deviennent ses enfants.
  2. Pragma commentaire \`// @step Libellé\` — portée implicite jusqu'au prochain \`// @step\` ou fin de \`main\` (le plus concis) :
    \`\`\`js
    // @step Lire les mails non lus
    const mails = await home.google.gmail.search("is:unread", 10);
    // @step Résumer et envoyer
    const summary = await home.ai.chat("Résume : " + JSON.stringify(mails));
    await home.mail.send({ to: "moi@exemple.fr", subject: "Résumé", text: summary });
    \`\`\`
    Équivalent wrapper :
    \`\`\`js
    const mails = await home.step("Lire les mails non lus", () => home.google.gmail.search("is:unread", 10));
    await home.step("Résumer et envoyer", async () => {
      const summary = await home.ai.chat("Résume : " + JSON.stringify(mails));
      await home.mail.send({ to: "moi@exemple.fr", subject: "Résumé", text: summary });
    });
    \`\`\`
- IMPORTANT : utilise uniquement les méthodes listées ci-dessus, avec leurs signatures exactes. Ne déclare jamais une méthode que \`home\` n'a pas (pas d'appels à \`drive.upload\` avec un id/range, pas de \`.values\`).

Réponds UNIQUEMENT avec un JSON de ce format (pas de texte autour) :
${jsonContract}`;
}

const SCRIPT_SYSTEM_SCHEDULE = buildScriptSystem("schedule");

function scriptSystem(triggerKind: TriggerKind): string {
  return triggerKind === "schedule" ? SCRIPT_SYSTEM_SCHEDULE : buildScriptSystem(triggerKind);
}

const SCRIPT_PLANNER_SYSTEM = `Tu es un chef de projet technique. L'utilisateur veut créer un job planifié (script) familial.
Analyse la demande et réponds avec UNIQUEMENT un JSON de ce format :
{
  "summary": "résumé en 1 phrase du job",
  "steps": ["étapes que le job exécutera, point par point"],
  "data": ["données à lire ou écrire (stockage, services connectés)"],
  "scheduleIntent": "planification en langage naturel (ex. tous les lundis à 8h, toutes les 30 minutes)",
  "risks": ["points d'attention (ex. service non connecté, limite du runner à 60 s)"]
}
Pas d'autre texte que le JSON.`;

const SCRIPT_PLANNER_ITERATION_SYSTEM = `Tu modifies un job planifié (script) familial existant : l'utilisateur veut faire évoluer ou corriger un script déjà en service.
Analyse la demande (et le contexte fourni) et réponds avec UNIQUEMENT un JSON de ce format :
{
  "summary": "résumé en 1 phrase de la demande",
  "steps": ["modifications à apporter, point par point"],
  "keep": ["éléments existants à conserver (clés de stockage, comportement, planification)"],
  "scheduleIntent": "planification en langage naturel (ex. tous les lundis à 8h), ou « inchangée » si elle ne change pas",
  "risks": ["risques de régression ou points de vigilance"]
}
Pas d'autre texte que le JSON.`;

const SCRIPT_PLANNER_SYSTEM_MANUAL = `Tu es un chef de projet technique. L'utilisateur veut créer un job serveur familial déclenché à la demande (manuellement).
Analyse la demande et réponds avec UNIQUEMENT un JSON de ce format :
{
  "summary": "résumé en 1 phrase du job",
  "steps": ["étapes que le job exécutera, point par point"],
  "data": ["données à lire ou écrire (stockage, services connectés)"],
  "risks": ["points d'attention (ex. service non connecté, limite du runner à 60 s)"]
}
Pas d'autre texte que le JSON.`;

const SCRIPT_PLANNER_SYSTEM_WEBHOOK = `Tu es un chef de projet technique. L'utilisateur veut créer un job serveur familial déclenché par un webhook entrant (POST public sur une URL).
Analyse la demande et réponds avec UNIQUEMENT un JSON de ce format :
{
  "summary": "résumé en 1 phrase du job",
  "steps": ["étapes que le job exécutera à chaque appel du webhook, point par point"],
  "data": ["données à lire ou écrire (dont le corps du webhook, exposé via home.webhook.payload)"],
  "risks": ["points d'attention (ex. service non connecté, limite du runner à 60 s)"]
}
Pas d'autre texte que le JSON.`;

const SCRIPT_PLANNER_ITERATION_SYSTEM_MANUAL = `Tu modifies un job serveur familial existant déclenché à la demande (manuel).
Analyse la demande (et le contexte fourni) et réponds avec UNIQUEMENT un JSON de ce format :
{
  "summary": "résumé en 1 phrase de la demande",
  "steps": ["modifications à apporter, point par point"],
  "keep": ["éléments existants à conserver (clés de stockage, comportement)"],
  "risks": ["risques de régression ou points de vigilance"]
}
Pas d'autre texte que le JSON.`;

const SCRIPT_PLANNER_ITERATION_SYSTEM_WEBHOOK = `Tu modifies un job serveur familial existant déclenché par un webhook entrant.
Analyse la demande (et le contexte fourni) et réponds avec UNIQUEMENT un JSON de ce format :
{
  "summary": "résumé en 1 phrase de la demande",
  "steps": ["modifications à apporter, point par point"],
  "keep": ["éléments existants à conserver (clés de stockage, comportement, usage de home.webhook.payload)"],
  "risks": ["risques de régression ou points de vigilance"]
}
Pas d'autre texte que le JSON.`;

/**
 * Sans la liste réelle du SDK, le planner invente des méthodes plausibles que le
 * coder implémente ensuite fidèlement (ex. `webhook.call` pour écrire sur Drive).
 */
function plannerCapabilities(): string {
  return `\n\nCAPACITÉS RÉELLES DU SDK \`home\` — un job ne peut faire QUE ça :
    - \`home.storage.*\` (KV du script), \`home.app(appId).storage.*\` (KV d'une app), \`home.storage.global.*\`
    - \`home.http.fetch(url, init?)\`, \`home.browser.*\`, \`home.ai.chat/messages\`
${getSdkPromptLines("home").join("\n    ")}
Une étape ne doit jamais citer une méthode absente de cette liste, ni détourner une méthode de son rôle (\`webhook.call\` appelle un webhook sortant, il n'écrit pas dans Drive ni ailleurs). Si la demande dépasse ces capacités, dis-le dans \`risks\` plutôt que d'inventer une étape.\n\nPas d'autre texte que le JSON.`;
}

function buildPlannerSystem(isIterating: boolean, triggerKind: TriggerKind): string {
  const base = () => {
    if (isIterating) {
      if (triggerKind === "manual") return SCRIPT_PLANNER_ITERATION_SYSTEM_MANUAL;
      if (triggerKind === "webhook") return SCRIPT_PLANNER_ITERATION_SYSTEM_WEBHOOK;
      return SCRIPT_PLANNER_ITERATION_SYSTEM;
    }
    if (triggerKind === "manual") return SCRIPT_PLANNER_SYSTEM_MANUAL;
    if (triggerKind === "webhook") return SCRIPT_PLANNER_SYSTEM_WEBHOOK;
    return SCRIPT_PLANNER_SYSTEM;
  };
  return base() + plannerCapabilities();
}

type GeneratedScript = {
  name: string;
  schedule: string;
  code: string;
  durationMs: number;
  coderModel: string;
};

/** Extrait le JSON {name, schedule, code} de la réponse du coder, avec des valeurs par défaut sûres. */
function parseGeneratedScript(
  text: string,
  fallback?: { name?: string; schedule?: string; code?: string },
  defaultSchedule = "",
): { name: string; schedule: string; code: string } {
  let parsed: { name?: string; schedule?: string; code?: string } = {};
  const json = text.match(/\{[\s\S]*\}/);
  if (json) {
    try {
      parsed = JSON.parse(json[0]);
    } catch {
      parsed = {};
    }
  }
  return {
    name: parsed.name ?? fallback?.name ?? "Script",
    schedule: parsed.schedule ?? fallback?.schedule ?? defaultSchedule,
    code: parsed.code ?? fallback?.code ?? `async function main(home) {\n  console.log("ok");\n}`,
  };
}

/**
 * Génère un script complet (schedule + code) à partir d'un prompt, en une passe.
 * Surtout utilisé par l'assistant et le MCP ; l'UI passe par planScript + codeScript.
 */
export async function generateScript(
  prompt: string,
  opts: GenerateOptions = {},
): Promise<GeneratedScript> {
  const coderModel = opts.coderModel ?? defaultModels.coder;
  const triggerKind = opts.triggerKind ?? "schedule";

  const t = Date.now();
  const chat = await chatWithTruncationRetry(
    [
      { role: "system", content: scriptSystem(triggerKind) + languageInstruction(opts.locale) },
      { role: "user", content: prompt },
    ],
    {
      provider: opts.provider,
      model: coderModel,
      maxTokens: 4096,
      userId: opts.userId,
      feature: opts.feature ?? "script_generate",
      appId: null,
      scriptId: opts.scriptId ?? null,
    },
    (_text, finishReason) => finishReason === "length",
  );
  const { name, schedule, code } = parseGeneratedScript(chat.text, undefined, scheduleFallback(triggerKind));

  return { name, schedule, code, durationMs: Date.now() - t, coderModel };
}

export interface StreamCallbacks {
  onToken?: (token: string) => void;
  signal?: AbortSignal;
}

/** Version streamée de generateScript : pousse les tokens via onToken. */
export async function generateScriptStream(
  prompt: string,
  opts: GenerateOptions & StreamCallbacks = {},
): Promise<GeneratedScript> {
  const coderModel = opts.coderModel ?? defaultModels.coder;
  const triggerKind = opts.triggerKind ?? "schedule";
  const t = Date.now();
  const { text } = await chatCompletionStream(
    [
      { role: "system", content: scriptSystem(triggerKind) + languageInstruction(opts.locale) },
      { role: "user", content: prompt },
    ],
    {
      provider: opts.provider,
      model: coderModel,
      maxTokens: 4096,
      signal: opts.signal,
      onToken: opts.onToken,
      userId: opts.userId,
      feature: opts.feature ?? "script_generate",
      appId: null,
      scriptId: opts.scriptId ?? null,
    },
  );
  const { name, schedule, code } = parseGeneratedScript(text, undefined, scheduleFallback(triggerKind));
  return { name, schedule, code, durationMs: Date.now() - t, coderModel };
}

/**
 * Modifie un script existant à partir d'un nouveau prompt : injecte le code
 * actuel en contexte et retourne les champs mis à jour.
 */
export async function refineScript(
  current: { name: string; schedule: string; code: string },
  prompt: string,
  opts: GenerateOptions = {},
): Promise<GeneratedScript> {
  const coderModel = opts.coderModel ?? defaultModels.coder;
  const triggerKind = opts.triggerKind ?? "schedule";
  const jsonFields = triggerKind === "schedule" ? " (name, schedule, code)" : " (name, code)";

  const t = Date.now();
  const chat = await chatWithTruncationRetry(
    [
      { role: "system", content: scriptSystem(triggerKind) + languageInstruction(opts.locale) },
      {
        role: "user",
        content: `Voici le script actuel :
Nom : ${current.name}
Schedule : ${current.schedule || "—"}
\`\`\`js
${current.code}
\`\`\`

Demande de modification :
${prompt}

Réponds avec le JSON complet${jsonFields} reflétant le script modifié.`,
      },
    ],
    {
      provider: opts.provider,
      model: coderModel,
      maxTokens: 4096,
      userId: opts.userId,
      feature: opts.feature ?? "script_code",
      appId: null,
      scriptId: opts.scriptId ?? null,
    },
    (_text, finishReason) => finishReason === "length",
  );
  const text = chat.text;

  const result = parseGeneratedScript(text, current, scheduleFallback(triggerKind));

  return { ...result, durationMs: Date.now() - t, coderModel };
}

/** Version streamée de refineScript. */
export async function refineScriptStream(
  current: { name: string; schedule: string; code: string },
  prompt: string,
  opts: GenerateOptions & StreamCallbacks = {},
): Promise<GeneratedScript> {
  const coderModel = opts.coderModel ?? defaultModels.coder;
  const triggerKind = opts.triggerKind ?? "schedule";
  const jsonFields = triggerKind === "schedule" ? " (name, schedule, code)" : " (name, code)";
  const t = Date.now();
  const { text } = await chatCompletionStream(
    [
      { role: "system", content: scriptSystem(triggerKind) + languageInstruction(opts.locale) },
      {
        role: "user",
        content: `Voici le script actuel :
Nom : ${current.name}
Schedule : ${current.schedule || "—"}
\`\`\`js
${current.code}
\`\`\`

Demande de modification :
${prompt}

Réponds avec le JSON complet${jsonFields} reflétant le script modifié.`,
      },
    ],
    {
      provider: opts.provider,
      model: coderModel,
      maxTokens: 4096,
      signal: opts.signal,
      onToken: opts.onToken,
      userId: opts.userId,
      feature: opts.feature ?? "script_code",
      appId: null,
      scriptId: opts.scriptId ?? null,
    },
  );
  const result = parseGeneratedScript(text, current, scheduleFallback(triggerKind));
  return { ...result, durationMs: Date.now() - t, coderModel };
}

// ---------------------------------------------------------------------------
// Génération en deux phases (plan → code), même modèle que les apps.
// La phase « plan » s'arrête sur un plan éditable que l'utilisateur valide ;
// la phase « code » produit le JSON {name, schedule, code} à partir de ce plan.
// ---------------------------------------------------------------------------

export interface ScriptPlanResult {
  plan: string;
  model: string;
}

/** Contexte d'itération pour le planificateur : script actuel (tronqué) + historique. */
function plannerContext(
  current: { name: string; schedule: string; code: string } | null,
  historyBlock: string,
): string {
  const lines: string[] = [];
  if (current) {
    lines.push(
      [
        "Contexte — le script existe déjà :",
        `Nom : ${current.name}`,
        `Schedule : ${current.schedule}`,
        `Code actuel (tronqué) :\n\`\`\`js\n${truncateCode(current.code)}\n\`\`\``,
      ].join("\n"),
    );
  }
  if (historyBlock) lines.push(historyBlock);
  return lines.join("\n\n");
}

/** Phase 1 : planification d'un script (création ou itération). */
export async function planScript(
  prompt: string,
  opts: GenerateOptions & {
    isIterating?: boolean;
    current?: { name: string; schedule: string; code: string } | null;
    historyBlock?: string;
  } = {},
): Promise<ScriptPlanResult> {
  const plannerModel = opts.plannerModel ?? defaultModels.planner;
  const triggerKind = opts.triggerKind ?? "schedule";
  const isIterating = opts.isIterating ?? Boolean(opts.current);
  const context = plannerContext(opts.current ?? null, opts.historyBlock ?? "");

  const planText = await chatCompletion(
    [
      {
        role: "system",
        content: buildPlannerSystem(isIterating, triggerKind) + languageInstruction(opts.locale),
      },
      {
        role: "user",
        content: context ? `${prompt}\n\n${context}` : prompt,
      },
    ],
    {
      provider: opts.provider,
      model: plannerModel,
      maxTokens: 1024,
      userId: opts.userId,
      feature: opts.feature ?? "script_plan",
      appId: null,
      scriptId: opts.scriptId ?? null,
    },
  );
  return { plan: planText, model: plannerModel };
}

/** Phase 1 streamée : pousse les tokens via onToken. */
export async function planScriptStream(
  prompt: string,
  opts: GenerateOptions &
    StreamCallbacks & {
      isIterating?: boolean;
      current?: { name: string; schedule: string; code: string } | null;
      historyBlock?: string;
    } = {},
): Promise<ScriptPlanResult> {
  const plannerModel = opts.plannerModel ?? defaultModels.planner;
  const triggerKind = opts.triggerKind ?? "schedule";
  const isIterating = opts.isIterating ?? Boolean(opts.current);
  const context = plannerContext(opts.current ?? null, opts.historyBlock ?? "");
  const planText = await chatCompletionStream(
    [
      {
        role: "system",
        content: buildPlannerSystem(isIterating, triggerKind) + languageInstruction(opts.locale),
      },
      {
        role: "user",
        content: context ? `${prompt}\n\n${context}` : prompt,
      },
    ],
    {
      provider: opts.provider,
      model: plannerModel,
      maxTokens: 1024,
      signal: opts.signal,
      onToken: opts.onToken,
      userId: opts.userId,
      feature: opts.feature ?? "script_plan",
      appId: null,
      scriptId: opts.scriptId ?? null,
    },
  ).then((r) => r.text);
  return { plan: planText, model: plannerModel };
}

/** Phase 2 : implémentation du code à partir du plan validé. */
export async function codeScript(
  prompt: string,
  plan: string,
  opts: GenerateOptions & {
    current?: { name: string; schedule: string; code: string } | null;
  } = {},
): Promise<GeneratedScript> {
  const coderModel = opts.coderModel ?? defaultModels.coder;
  const triggerKind = opts.triggerKind ?? "schedule";
  const t = Date.now();
  const chat = await chatWithTruncationRetry(
    [
      { role: "system", content: scriptSystem(triggerKind) + languageInstruction(opts.locale) },
      {
        role: "user",
        content: `Voici le script actuel :
Nom : ${opts.current?.name ?? "—"}
Schedule : ${opts.current?.schedule || "—"}
${opts.current ? `\`\`\`js\n${opts.current.code}\n\`\`\`` : "—"}

Demande : ${prompt}

Plan proposé :
${plan}

Le plan est indicatif : si une étape cite une méthode absente du SDK ci-dessus, ignore-la (ne la remplace pas par un appel approximatif) et signale-le dans le code par un commentaire.
Réponds avec le JSON complet reflétant le script (modifié si itération).`,
      },
    ],
    {
      provider: opts.provider,
      model: coderModel,
      maxTokens: 4096,
      userId: opts.userId,
      feature: opts.feature ?? "script_code",
      appId: null,
      scriptId: opts.scriptId ?? null,
    },
    (_text, finishReason) => finishReason === "length",
  );
  const result = parseGeneratedScript(chat.text, opts.current ?? undefined, scheduleFallback(triggerKind));
  return { ...result, durationMs: Date.now() - t, coderModel };
}

/** Phase 2 streamée : pousse les tokens via onToken. */
export async function codeScriptStream(
  prompt: string,
  plan: string,
  opts: GenerateOptions &
    StreamCallbacks & {
      current?: { name: string; schedule: string; code: string } | null;
    } = {},
): Promise<GeneratedScript> {
  const coderModel = opts.coderModel ?? defaultModels.coder;
  const triggerKind = opts.triggerKind ?? "schedule";
  const t = Date.now();
  const { text } = await chatCompletionStream(
    [
      { role: "system", content: scriptSystem(triggerKind) + languageInstruction(opts.locale) },
      {
        role: "user",
        content: `Voici le script actuel :
Nom : ${opts.current?.name ?? "—"}
Schedule : ${opts.current?.schedule || "—"}
${opts.current ? `\`\`\`js\n${opts.current.code}\n\`\`\`` : "—"}

Demande : ${prompt}

Plan proposé :
${plan}

Le plan est indicatif : si une étape cite une méthode absente du SDK ci-dessus, ignore-la (ne la remplace pas par un appel approximatif) et signale-le dans le code par un commentaire.
Réponds avec le JSON complet reflétant le script (modifié si itération).`,
      },
    ],
    {
      provider: opts.provider,
      model: coderModel,
      maxTokens: 4096,
      signal: opts.signal,
      onToken: opts.onToken,
      userId: opts.userId,
      feature: opts.feature ?? "script_code",
      appId: null,
      scriptId: opts.scriptId ?? null,
    },
  );
  const result = parseGeneratedScript(text, opts.current ?? undefined, scheduleFallback(triggerKind));
  return { ...result, durationMs: Date.now() - t, coderModel };
}
