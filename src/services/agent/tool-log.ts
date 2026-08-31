import { z } from "zod";

/**
 * Journal des échecs d'outil.
 *
 * Deux causes très différentes, et c'est la distinction qui est utile :
 * - `invalid-args` : le LLM a mal appelé l'outil → corriger le schéma, sa
 *   description, ou le prompt système.
 * - `execution` : le service sous-jacent a échoué → corriger le service, ou
 *   documenter la limite dans la description de l'outil.
 *
 * Préfixe stable pour pouvoir grepper les logs du serveur.
 */

const PREFIX = "[agent:tool-error]";
const ARGS_MAX_CHARS = 500;
const MESSAGE_MAX_CHARS = 400;

export type ToolFailureKind = "invalid-args" | "execution";

export interface ToolFailure {
  kind: ToolFailureKind;
  tool: string;
  message: string;
  /** Chemins zod fautifs, seulement pour `invalid-args`. */
  issues?: string[];
  args?: string;
  durationMs: number;
  userId: string;
  threadId?: string;
  toolCallId?: string;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…(${text.length}c)` : text;
}

function serializeArgs(args: unknown): string | undefined {
  if (args === undefined) return undefined;
  try {
    return truncate(JSON.stringify(args), ARGS_MAX_CHARS);
  } catch {
    return "(non sérialisable)";
  }
}

/** Un abort utilisateur n'est pas un échec d'outil. */
export function isAbort(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  return err instanceof Error && err.name === "AbortError";
}

export function describeToolFailure(input: {
  tool: string;
  err: unknown;
  args: unknown;
  durationMs: number;
  userId: string;
  threadId?: string;
  toolCallId?: string;
}): ToolFailure {
  const { tool, err, args, durationMs, userId, threadId, toolCallId } = input;

  if (err instanceof z.ZodError) {
    return {
      kind: "invalid-args",
      tool,
      message: truncate(err.issues.map((i) => i.message).join("; "), MESSAGE_MAX_CHARS),
      issues: err.issues.map((i) => `${i.path.join(".") || "(racine)"}: ${i.code}`),
      args: serializeArgs(args),
      durationMs,
      userId,
      threadId,
      toolCallId,
    };
  }

  return {
    kind: "execution",
    tool,
    message: truncate(err instanceof Error ? err.message : String(err), MESSAGE_MAX_CHARS),
    args: serializeArgs(args),
    durationMs,
    userId,
    threadId,
    toolCallId,
  };
}

export function logToolFailure(failure: ToolFailure): void {
  console.warn(`${PREFIX} ${failure.kind} ${failure.tool}`, failure);
}

// ---------------------------------------------------------------------------
// Appels d'outil écrits en texte
// ---------------------------------------------------------------------------

const TEXTUAL_TOOL_CALL_PREFIX = "[agent:textual-tool-call]";

/**
 * Gabarits d'appel d'outil qu'un modèle peut émettre en texte au lieu de passer
 * par l'API de tool calling. Ça arrive quand le modèle ou la passerelle gère mal
 * les outils : le tour se termine sans qu'aucun outil ne tourne, et l'utilisateur
 * voit le gabarit brut. Rien ne le signale autrement, d'où cette détection.
 */
const TEXTUAL_TOOL_CALL_MARKERS = [
  "<tool_call>",
  "</tool_call>",
  "<|tool_calls_begin|>",
  "<|tool_call_begin|>",
  "<invoke name=",
  "<function=",
] as const;

export interface TextualToolCall {
  marker: string;
  /** Outils connus nommés dans le texte : dit ce que le modèle voulait appeler. */
  mentionedTools: string[];
}

/**
 * Détecte un appel d'outil resté en texte. Volontairement conservateur : un
 * marqueur seul suffit, mais on exige un gabarit, pas une simple mention du nom
 * d'un outil (l'assistant a le droit de parler de ses outils en prose).
 */
export function detectTextualToolCall(
  text: string,
  toolNames: string[],
): TextualToolCall | null {
  if (!text) return null;
  const marker = TEXTUAL_TOOL_CALL_MARKERS.find((m) => text.includes(m));
  // `<function nom(` : gabarit GLM, sans marqueur dédié.
  const glm = /<function\s+([a-z][a-z0-9_]*)\s*\(/i.exec(text);
  if (!marker && !glm) return null;

  return {
    marker: marker ?? "<function name(",
    mentionedTools: toolNames.filter((name) => text.includes(name)),
  };
}

export function logTextualToolCall(input: {
  detected: TextualToolCall;
  model: string;
  userId: string;
  threadId: string;
  textPreview: string;
}): void {
  console.warn(
    `${TEXTUAL_TOOL_CALL_PREFIX} ${input.model} ${input.detected.mentionedTools.join(",") || "?"}`,
    { ...input, textPreview: truncate(input.textPreview, MESSAGE_MAX_CHARS) },
  );
}
