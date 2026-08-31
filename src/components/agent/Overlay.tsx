"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bot, ExternalLink, X } from "lucide-react";
import type { UIMessage } from "ai";

import { scopeKey, scopeLabel, type AgentScope } from "./AgentContext";
import { ChatView } from "./ChatView";

interface Resolved {
  threadId: string;
  messages: UIMessage[];
}

/**
 * Résout le fil à ouvrir pour un scope : celui déjà lié à l'app/au script s'il
 * existe, sinon un id neuf que le serveur créera au premier message.
 */
async function resolveThread(scope: AgentScope | null | undefined): Promise<Resolved> {
  const kind = scope?.scriptId ? "script" : scope?.appId ? "app" : null;
  const contextId = scope?.scriptId ?? scope?.appId ?? null;
  if (!kind || !contextId) return { threadId: crypto.randomUUID(), messages: [] };

  try {
    const res = await fetch(
      `/api/assistant/threads?contextKind=${kind}&contextId=${encodeURIComponent(contextId)}`,
    );
    const rows = res.ok ? ((await res.json()) as { id: string }[]) : [];
    if (rows.length === 0) return { threadId: crypto.randomUUID(), messages: [] };

    const threadId = rows[0].id;
    const history = await fetch(`/api/assistant/threads/${threadId}`);
    const data = history.ok ? ((await history.json()) as { messages?: UIMessage[] }) : {};
    return { threadId, messages: data.messages ?? [] };
  } catch {
    return { threadId: crypto.randomUUID(), messages: [] };
  }
}

export function AssistantOverlay({
  open,
  onClose,
  initialQuery,
  onInitialQueryConsumed,
  scope,
  onScopeConsumed,
}: {
  open: boolean;
  onClose: () => void;
  initialQuery?: string | null;
  onInitialQueryConsumed?: () => void;
  scope?: AgentScope | null;
  onScopeConsumed?: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const label = scopeLabel(scope);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-ink/20 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="relative flex h-full w-full max-w-[440px] flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-accent text-white">
              <Bot className="size-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink">Assistant</p>
              <p className="text-xs text-muted">⌘J · partout</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Link
              href="/assistant"
              onClick={onClose}
              className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-canvas"
              title="Ouvrir en plein écran"
            >
              <ExternalLink className="size-4" />
            </Link>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer"
              className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-canvas"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {label && (
          <div className="flex items-center justify-between border-b border-line bg-brand-light px-3 py-2 text-xs">
            <span className="font-medium text-brand-dark">Contexte : {label}</span>
            <button
              type="button"
              onClick={() => onScopeConsumed?.()}
              className="rounded-full border border-line bg-white px-2 py-0.5 text-ink hover:bg-canvas"
            >
              Quitter le contexte
            </button>
          </div>
        )}

        <div className="flex flex-1 flex-col overflow-hidden">
          <OverlayChat
            key={scopeKey(scope)}
            scope={scope}
            initialQuery={initialQuery}
            onInitialQueryConsumed={onInitialQueryConsumed}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Remonté à chaque changement de scope (via `key`) : l'état part donc vide et
 * l'effet n'a qu'à charger, sans réinitialiser quoi que ce soit.
 */
function OverlayChat({
  scope,
  initialQuery,
  onInitialQueryConsumed,
}: {
  scope?: AgentScope | null;
  initialQuery?: string | null;
  onInitialQueryConsumed?: () => void;
}) {
  const [resolved, setResolved] = useState<Resolved | null>(null);

  useEffect(() => {
    let cancelled = false;
    void resolveThread(scope).then((r) => {
      if (!cancelled) setResolved(r);
    });
    return () => {
      cancelled = true;
    };
    // Le scope est figé pour ce montage : la clé du parent garantit le remontage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!resolved) {
    return <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted">Chargement…</div>;
  }

  return (
    <ChatView
      threadId={resolved.threadId}
      initialMessages={resolved.messages}
      scope={scope ?? null}
      autoSend={initialQuery}
      onAutoSendConsumed={onInitialQueryConsumed}
    />
  );
}
