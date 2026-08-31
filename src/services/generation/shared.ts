import type { Locale } from "@/i18n/config";
import {
  chatCompletionDetailed,
  chatCompletionStream,
  LlmError,
  type ChatMessage,
  type LlmOptions,
  type LlmProvider,
} from "@/services/llm/llm";

/** Options communes à la génération (app et script). */
export interface GenerateOptions {
  provider?: LlmProvider;
  plannerModel?: string;
  coderModel?: string;
  /** Langue attendue pour les textes produits (UI générée, résumés, noms). */
  locale?: Locale;
  /** Trigger du script généré : schedule (défaut), manual ou webhook. */
  triggerKind?: "schedule" | "manual" | "webhook";
  /** Suivi d'usage LLM */
  userId?: string;
  feature?: string;
  appId?: string | null;
  scriptId?: string | null;
  threadId?: string | null;
}

const LANGUAGE_NAMES: Record<Locale, string> = {
  fr: "FRANÇAIS",
  en: "ANGLAIS",
};

/** Consigne de langue à ajouter aux prompts système. */
export function languageInstruction(locale: Locale = "fr"): string {
  return `\n\nLANGUE : tous les textes destinés à l'utilisateur (libellés d'interface, titres, messages, noms, résumés) doivent être en ${LANGUAGE_NAMES[locale]}.`;
}

/** Entrée de l'historique de génération (user/assistant/plan). */
export interface GenerationHistoryEntry {
  role: "user" | "assistant" | "plan";
  content: string | null;
}

/**
 * Met en forme l'historique des itérations précédentes pour le contexte LLM.
 * Les messages `assistant` sont ignorés : leur contenu est le HTML généré, déjà
 * fourni au modèle via `previousHtml`. Chaque ligne est tronquée puis l'ensemble
 * est borné pour tenir le budget de tokens.
 */
export function formatHistory(
  entries: GenerationHistoryEntry[],
  maxChars = 3000,
): string {
  const parts = entries
    .filter((e) => e.role !== "assistant" && !!e.content)
    .map((e) => {
      const label = e.role === "user" ? "Utilisateur" : "Plan";
      const content = (e.content as string).replace(/\s+/g, " ").trim().slice(0, 500);
      return `- ${label} : ${content}`;
    });
  if (!parts.length) return "";
  let block = `Historique des échanges précédents :\n${parts.join("\n")}`;
  if (block.length > maxChars) {
    block = `… (début de l'historique tronqué)\n${block.slice(-maxChars)}`;
  }
  return block;
}

/**
 * Tronque un HTML trop long pour le contexte en gardant le début (head + structure)
 * et la fin (scripts + balises fermantes). Le modèle voit ainsi la structure
 * complète sans payer le coût d'un très gros fichier à chaque itération.
 */
export function truncateHtml(html: string, maxChars = 15000): string {
  if (html.length <= maxChars) return html;
  const half = Math.floor(maxChars / 2);
  return `${html.slice(0, half)}\n<!-- … code tronqué (limite de contexte) … -->\n${html.slice(-half)}`;
}

/** Tronque du code JS (script) en gardant le début — le planificateur n'a besoin que du contexte global. */
export function truncateCode(code: string, maxChars = 8000): string {
  if (code.length <= maxChars) return code;
  return `${code.slice(0, maxChars)}\n// … code tronqué (limite de contexte) …`;
}

/** Sépare la réflexion `<think>` du texte final (gère aussi le cas stream sans fermeture). */
export function extractReasoning(text: string): { reasoning: string | null; cleanText: string } {
  const m = text.match(/<think>([\s\S]*?)<\/think>/i);
  if (m) {
    const reasoning = m[1].trim() || null;
    const cleanText = text.replace(m[0], "").trim();
    return { reasoning, cleanText };
  }
  // Cas stream : <think> ouvert sans fermeture
  const open = text.match(/<think>([\s\S]*)$/i);
  if (open) {
    return { reasoning: open[1].trim() || null, cleanText: text.slice(0, open.index).trim() };
  }
  return { reasoning: null, cleanText: text };
}

/** Extrait les clés de stockage déclarées dans le commentaire `<!-- storage: ... -->`. */
export function extractStorageKeys(html: string): string[] {
  const m = html.match(/<!--\s*storage:\s*([\s\S]*?)-->/i);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/-+\s*$/, ""))
    .filter(Boolean);
}

/**
 * Appelle le chat completions ; si la réponse est tronquée (limite de tokens),
 * réessaie une fois avec un budget doublé. Jette une LlmError si toujours tronquée.
 * Utilise le streaming interne pour éviter les timeouts sur les gros appels coder.
 */
export async function chatWithTruncationRetry(
  messages: ChatMessage[],
  opts: LlmOptions & { maxTokens: number },
  isTruncated: (text: string, finishReason: string | null) => boolean,
): Promise<{ text: string; finishReason: string | null }> {
  // Préfère le streaming (même résultat, mais évite les blocages HTTP longs)
  let first: { text: string; finishReason: string | null } | null = null;
  try {
    const r = await chatCompletionStream(messages, opts);
    if (r && typeof r.text === "string") first = r;
    else throw new Error("invalid stream");
  } catch {
    first = await chatCompletionDetailed(messages, opts);
  }
  if (!first) first = await chatCompletionDetailed(messages, opts);
  if (!isTruncated(first.text, first.finishReason)) return first;

  let retry: { text: string; finishReason: string | null } | null = null;
  try {
    const r = await chatCompletionStream(messages, {
      ...opts,
      maxTokens: opts.maxTokens * 2,
    });
    if (r && typeof r.text === "string") retry = r;
    else throw new Error("invalid stream");
  } catch {
    retry = await chatCompletionDetailed(messages, {
      ...opts,
      maxTokens: opts.maxTokens * 2,
    });
  }
  if (!retry) retry = await chatCompletionDetailed(messages, { ...opts, maxTokens: opts.maxTokens * 2 });
  if (isTruncated(retry.text, retry.finishReason)) {
    throw new LlmError(
      "Réponse du modèle tronquée (limite de tokens atteinte). Réessayez.",
    );
  }
  return retry;
}