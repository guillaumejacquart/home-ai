"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Menu, Sparkles, X } from "lucide-react";
import type { UIMessage } from "ai";

import { ChatView } from "@/components/agent/ChatView";
import { ThreadSidebar } from "@/components/agent/ThreadSidebar";
import type { ThreadRow } from "@/components/agent/types";
import { Button } from "@/components/ui";

export function AssistantPageClient({
  threadId,
  initialMessages,
  threads,
  isNew = false,
}: {
  threadId: string;
  initialMessages: UIMessage[];
  threads: ThreadRow[];
  /** Fil pas encore créé côté serveur : l'URL ne le porte pas encore. */
  isNew?: boolean;
}) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleSelect = useCallback(
    (id: string) => {
      setSidebarOpen(false);
      router.push(`/assistant/${id}`);
    },
    [router],
  );

  const handleNew = useCallback(() => {
    setSidebarOpen(false);
    router.push("/assistant");
  }, [router]);

  // Premier message d'un fil neuf : l'URL doit porter l'id sans remonter la vue
  // (un router.push remonterait ChatView et couperait le stream).
  const handleThreadTouched = useCallback(() => {
    if (isNew) window.history.replaceState(null, "", `/assistant/${threadId}`);
    router.refresh();
  }, [isNew, threadId, router]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm("Supprimer cette conversation ?")) return;
      await fetch(`/api/assistant/threads/${id}`, { method: "DELETE" });
      if (id === threadId) router.push("/assistant");
      else router.refresh();
    },
    [router, threadId],
  );

  return (
    <div className="flex h-screen flex-col bg-white">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-white px-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className="inline-flex size-9 items-center justify-center rounded-lg border border-line bg-white text-muted hover:bg-canvas lg:hidden"
            aria-label={sidebarOpen ? "Fermer le menu" : "Ouvrir le menu"}
          >
            {sidebarOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <Link href="/" className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-accent text-white shadow-sm">
              <Sparkles className="size-4" />
            </span>
            <span className="hidden font-bold tracking-tight text-brand-dark sm:inline">Home AI</span>
          </Link>
          <span className="hidden items-center gap-1.5 rounded-full border border-line bg-canvas px-2.5 py-1 text-xs font-medium text-muted sm:inline-flex">
            <Bot className="size-3.5" />
            Assistant
          </span>
        </div>
        <Link href="/" className="text-sm text-muted hover:text-ink">
          ← Accueil
        </Link>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="hidden w-72 shrink-0 flex-col border-r border-line bg-white lg:flex">
          <ThreadSidebar
            threads={threads}
            activeId={isNew ? null : threadId}
            onSelect={handleSelect}
            onNew={handleNew}
            onDelete={handleDelete}
          />
          <div className="border-t border-line p-3">
            <p className="text-center text-[11px] text-muted">Astuce : ⌘J ouvre l’assistant partout</p>
          </div>
        </aside>

        {sidebarOpen && (
          <>
            <div
              className="fixed inset-0 z-10 bg-ink/20 backdrop-blur-sm lg:hidden"
              onClick={() => setSidebarOpen(false)}
              aria-hidden="true"
            />
            <div className="fixed inset-y-0 left-0 z-20 flex w-72 flex-col border-r border-line bg-white shadow-xl lg:hidden">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <span className="text-sm font-semibold">Conversations</span>
                <Button variant="ghost" size="sm" onClick={() => setSidebarOpen(false)}>
                  <X className="size-4" />
                </Button>
              </div>
              <ThreadSidebar
                threads={threads}
                activeId={isNew ? null : threadId}
                onSelect={handleSelect}
                onNew={handleNew}
                onDelete={handleDelete}
              />
            </div>
          </>
        )}

        <main className="flex flex-1 flex-col overflow-hidden bg-canvas">
          <ChatView
            key={threadId}
            threadId={threadId}
            initialMessages={initialMessages}
            onThreadTouched={handleThreadTouched}
          />
        </main>
      </div>
    </div>
  );
}
