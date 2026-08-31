"use client";

import { BookOpen, MessageSquare, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui";
import { isJournalRow, type ThreadRow } from "./types";

/** Purement présentationnel : la liste vient du serveur. */
export function ThreadSidebar({
  threads,
  activeId,
  onSelect,
  onNew,
  onDelete,
}: {
  threads: ThreadRow[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <Button onClick={onNew} className="w-full justify-center gap-2">
          <Plus className="size-4" />
          Nouvelle conversation
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <p className="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
          Conversations
        </p>
        {threads.length === 0 ? (
          <p className="px-2 py-4 text-sm text-muted">Aucune conversation.</p>
        ) : (
          <ul className="space-y-1">
            {threads.map((thread) => (
              <ThreadItem
                key={thread.id}
                thread={thread}
                isActive={thread.id === activeId}
                onSelect={onSelect}
                onDelete={onDelete}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ThreadItem({
  thread,
  isActive,
  onSelect,
  onDelete,
}: {
  thread: ThreadRow;
  isActive: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const isJournal = isJournalRow(thread);

  return (
    <li>
      <div
        className={`group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
          isActive ? "bg-brand-light text-brand-dark" : "text-ink hover:bg-brand-light/70"
        } ${isJournal ? "border border-brand/20 bg-brand-light/50" : ""}`}
      >
        <button
          type="button"
          onClick={() => onSelect(thread.id)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {isJournal ? (
            <BookOpen className="size-4 shrink-0 text-brand" />
          ) : thread.contextKind === "app" ? (
            <span className="shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-700">
              APP
            </span>
          ) : thread.contextKind === "script" ? (
            <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
              SCRIPT
            </span>
          ) : (
            <MessageSquare className="size-4 shrink-0 text-muted" />
          )}
          <span className="min-w-0 flex-1 truncate">{thread.title || "Conversation"}</span>
        </button>
        {!isJournal && (
          <button
            type="button"
            onClick={() => onDelete(thread.id)}
            className="hidden shrink-0 rounded p-1 text-muted hover:bg-white hover:text-danger group-hover:inline-flex"
            aria-label="Supprimer la conversation"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
    </li>
  );
}
