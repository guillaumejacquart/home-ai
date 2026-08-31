import { z } from "zod";

/**
 * Log of tool failures.
 *
 * Two very different causes, and the distinction is the useful part:
 * - `invalid-args`: the LLM called the tool wrongly → fix the schema, its
 *   description, or the system prompt.
 * - `execution`: the underlying service failed → fix the service, or
 *   document the limit in the tool's description.
 *
 * Stable prefix so the server logs can be grepped.
 */

const PREFIX = "[agent:tool-error]";
const ARGS_MAX_CHARS = 500;
const MESSAGE_MAX_CHARS = 400;

export type ToolFailureKind = "invalid-args" | "execution";

export interface ToolFailure {
  kind: ToolFailureKind;
  tool: string;
  message: string;
  /** Zod paths at fault, only for `invalid-args`. */
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
    return "(not serialisable)";
  }
}

/** A user abort is not a tool failure. */
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
      issues: err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.code}`),
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
// Tool calls written out as text
// ---------------------------------------------------------------------------

const TEXTUAL_TOOL_CALL_PREFIX = "[agent:textual-tool-call]";

/**
 * Tool-call templates a model may emit as text instead of going through the tool
 * calling API. It happens when the model or the gateway mishandles
 * the tools: the turn ends without any tool running, and the user
 * sees the raw template. Nothing else reports it, hence this detection.
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
  /** Known tools named in the text: says what the model meant to call. */
  mentionedTools: string[];
}

/**
 * Detects a tool call left as text. Deliberately conservative: a
 * marker alone is not enough — we require a template, not just a mention of
 * a tool's name (the assistant is allowed to talk about its tools in prose).
 */
export function detectTextualToolCall(
  text: string,
  toolNames: string[],
): TextualToolCall | null {
  if (!text) return null;
  const marker = TEXTUAL_TOOL_CALL_MARKERS.find((m) => text.includes(m));
  // `<function name(`: GLM template, with no dedicated marker.
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
