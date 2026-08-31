"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Send, Square } from "lucide-react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isToolUIPart, type UIMessage } from "ai";

import { Button } from "@/components/ui";
import { Markdown } from "@/components/chat/Markdown";
import type { AgentScope } from "./AgentContext";
import { ReasoningPart } from "./parts/ReasoningPart";
import { ToolPart } from "./parts/ToolPart";
import { PlanCardPart, type PlanKind, type PlanTarget } from "./parts/PlanCardPart";

const PLAN_TOOLS = new Set(["tool-plan_app", "tool-plan_script"]);
const PLAN_VALIDATION_PREFIX = "Applique le plan validé";

function partText(part: UIMessage["parts"][number]): string {
  return part.type === "text" || part.type === "reasoning" ? part.text : "";
}

function messageText(message: UIMessage): string {
  return (message.parts ?? []).map(partText).join("");
}

/** A generate_* after this message means the plan has already been applied. */
function planAlreadyApplied(messages: UIMessage[], messageId: string): boolean {
  const idx = messages.findIndex((m) => m.id === messageId);
  if (idx === -1) return false;
  return messages.slice(idx + 1).some((m) =>
    (m.parts ?? []).some(
      (p) => isToolUIPart(p) && /^tool-(generate|code|update)_/.test(p.type),
    ),
  );
}

function isCodeDump(text: string): boolean {
  return text.includes("<html") || text.includes("<!DOCTYPE") || text.includes("```html");
}

export function ChatView({
  threadId,
  initialMessages,
  scope,
  autoSend,
  onAutoSendConsumed,
  onThreadTouched,
}: {
  /** Thread id, chosen by the caller. The server creates it on the first message. */
  threadId: string;
  initialMessages: UIMessage[];
  scope?: AgentScope | null;
  autoSend?: string | null;
  onAutoSendConsumed?: () => void;
  onThreadTouched?: (threadId: string) => void;
}) {
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const chat = useChat({
    id: threadId,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/assistant/chat",
      // The server holds the history: we only send the new message.
      prepareSendMessagesRequest: ({ id, messages }) => ({
        body: { id, message: messages[messages.length - 1], scope: scope ?? null, locale: "fr" },
      }),
    }),
    onFinish: () => {
      onThreadTouched?.(threadId);
      void loadSuggestions();
    },
  });

  const { messages, status, sendMessage, stop } = chat;
  const isBusy = status === "streaming" || status === "submitted";

  const loadSuggestions = useCallback(async () => {
    try {
      const res = await fetch("/api/assistant/suggestions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { suggestions?: string[] };
      setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
    } catch {
      // Follow-up suggestions are a bonus: a failure here shouldn't break anything.
    }
  }, [threadId]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isBusy) return;
      setSuggestions([]);
      void sendMessage({ text: trimmed });
    },
    [isBusy, sendMessage],
  );

  // Initial request coming from the overlay ("ask the assistant" from a page).
  const autoSentRef = useRef<string | null>(null);
  useEffect(() => {
    if (!autoSend?.trim() || autoSentRef.current === autoSend) return;
    autoSentRef.current = autoSend;
    send(autoSend);
    onAutoSendConsumed?.();
  }, [autoSend, send, onAutoSendConsumed]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isBusy]);

  function handleApplyPlan(planText: string, kind: PlanKind, target: PlanTarget) {
    const id = target.id || (kind === "app" ? scope?.appId : scope?.scriptId) || "";
    const origin = target.prompt ? ` (prompt d'origine : ${target.prompt})` : "";
    const label = kind === "app" ? "l'app" : "le script";
    send(`${PLAN_VALIDATION_PREFIX} pour ${label} ${id}${origin} :\n${planText}`);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(input);
    setInput("");
  }

  return (
    <div className="flex h-full flex-col bg-canvas">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-6">
          {messages.length === 0 && !isBusy ? (
            <EmptyState scope={scope} />
          ) : (
            messages.map((message) =>
              message.role === "user" ? (
                <UserMessage key={message.id} message={message} />
              ) : (
                <AssistantMessage
                  key={message.id}
                  message={message}
                  messages={messages}
                  isStreaming={isBusy && message.id === messages[messages.length - 1]?.id}
                  onApplyPlan={handleApplyPlan}
                />
              ),
            )
          )}
          {isBusy && messages[messages.length - 1]?.role === "user" && (
            <div className="flex items-center gap-2 px-4 py-2 text-xs text-muted">
              <span className="size-2 animate-pulse rounded-full bg-brand" />
              En réflexion…
            </div>
          )}
        </div>
      </div>

      {suggestions.length > 0 && !isBusy && (
        <div className="mx-auto flex w-full max-w-3xl flex-wrap gap-1.5 px-4 pb-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => send(s)}
              className="rounded-full border border-line bg-white px-3 py-1 text-xs text-ink hover:bg-brand-light"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="border-t border-line bg-white p-3">
        <form onSubmit={handleSubmit} className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
                setInput("");
              }
            }}
            placeholder={scope ? "Décris la modification…" : "Pose une question…"}
            rows={1}
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-line bg-white px-3 py-2.5 text-sm outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
          {isBusy ? (
            <Button type="button" variant="ghost" onClick={() => stop()} className="shrink-0">
              <Square className="size-4" />
              Arrêter
            </Button>
          ) : (
            <Button type="submit" disabled={!input.trim()} className="shrink-0">
              <Send className="size-4" />
            </Button>
          )}
        </form>
        <p className="mt-1.5 text-center text-[11px] text-muted">
          L’assistant peut se tromper. Vérifie les actions sensibles.
        </p>
      </div>
    </div>
  );
}

function EmptyState({ scope }: { scope?: AgentScope | null }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-accent text-white shadow-sm">
        <Bot className="size-7" />
      </span>
      <h2 className="text-lg font-semibold text-ink">Comment puis-je vous aider ?</h2>
      <p className="max-w-md text-sm text-muted">
        Je peux créer et modifier vos apps et scripts, organiser vos tableaux de bord et appeler vos
        services connectés.
      </p>
      <p className="max-w-md text-xs text-muted">
        Ex. « Crée une app qui affiche mes 5 prochains évènements Google Calendar avec la météo »
      </p>
      {scope?.appId && <ScopeBadge tone="violet">Contexte : app {scope.appId.slice(0, 8)}</ScopeBadge>}
      {scope?.scriptId && <ScopeBadge tone="amber">Contexte : script {scope.scriptId.slice(0, 8)}</ScopeBadge>}
      {scope?.storage && (
        <ScopeBadge tone="emerald">
          Contexte storage : {scope.storage.key} ({scope.storage.scope})
        </ScopeBadge>
      )}
    </div>
  );
}

const TONES = {
  violet: "border-violet-200 bg-violet-50 text-violet-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
} as const;

function ScopeBadge({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
  return <p className={`rounded-lg border px-3 py-1.5 text-xs ${TONES[tone]}`}>{children}</p>;
}

function UserMessage({ message }: { message: UIMessage }) {
  const text = messageText(message);

  // A validated plan is long: collapse it so it doesn't flood the conversation.
  if (text.startsWith(PLAN_VALIDATION_PREFIX)) {
    const body = text.includes(":\n") ? text.slice(text.indexOf(":\n") + 2) : text;
    return (
      <div className="flex justify-end">
        <details className="max-w-[80%] rounded-2xl border border-brand/20 bg-brand-light px-3 py-2 text-sm shadow-sm">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-brand-dark">
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-brand text-[10px] text-white">
              ✓
            </span>
            Plan validé
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-2 text-xs text-ink">
            {body}
          </pre>
        </details>
      </div>
    );
  }

  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-brand px-4 py-2.5 text-sm text-white shadow-sm">
        {text}
      </div>
    </div>
  );
}

function AssistantMessage({
  message,
  messages,
  isStreaming,
  onApplyPlan,
}: {
  message: UIMessage;
  messages: UIMessage[];
  isStreaming: boolean;
  onApplyPlan: (planText: string, kind: PlanKind, target: PlanTarget) => void;
}) {
  const parts = message.parts ?? [];
  const hasContent = parts.some(
    (p) => (p.type === "text" || p.type === "reasoning" ? !!p.text.trim() : isToolUIPart(p)),
  );

  return (
    <div className="flex justify-start">
      <div className="flex max-w-[85%] flex-col gap-2 rounded-2xl border border-line bg-white px-4 py-3 shadow-sm">
        {parts.map((part, idx) => {
          if (part.type === "text") {
            if (!part.text.trim()) return null;
            if (isCodeDump(part.text)) {
              return (
                <details key={idx} className="overflow-hidden rounded-lg border border-line bg-canvas">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-muted">
                    <span>Code généré</span>
                    <span className="ml-auto text-brand">Voir le code</span>
                  </summary>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t border-line bg-white p-3 font-mono text-xs">
                    {part.text}
                  </pre>
                </details>
              );
            }
            return (
              <div key={idx} className="text-sm leading-relaxed text-ink">
                <Markdown content={part.text} />
              </div>
            );
          }

          if (part.type === "reasoning") {
            if (!part.text.trim()) return null;
            return <ReasoningPart key={idx} text={part.text} isStreaming={isStreaming} />;
          }

          if (isToolUIPart(part)) {
            if (PLAN_TOOLS.has(part.type)) {
              return (
                <PlanCardPart
                  key={part.toolCallId ?? idx}
                  kind={part.type === "tool-plan_app" ? "app" : "script"}
                  state={part.state}
                  input={part.input}
                  output={part.output}
                  applied={planAlreadyApplied(messages, message.id)}
                  onApply={onApplyPlan}
                />
              );
            }
            return (
              <ToolPart
                key={part.toolCallId ?? idx}
                name={getToolName(part)}
                state={part.state}
                input={part.input}
                output={part.output}
                errorText={part.errorText}
              />
            );
          }

          return null;
        })}

        {!hasContent &&
          (isStreaming ? (
            <div className="flex items-center gap-2 py-1 text-xs text-muted">
              <span className="size-2 animate-pulse rounded-full bg-brand" />
              <span className="animate-pulse">En réflexion…</span>
            </div>
          ) : (
            <span className="text-xs text-muted">—</span>
          ))}
      </div>
    </div>
  );
}
