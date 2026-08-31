"use client";

import { createContext, useContext } from "react";

export interface AgentScope {
  appId?: string | null;
  scriptId?: string | null;
  storage?: {
    scope: "app" | "global" | "script";
    key: string;
    appId?: string | null;
    scriptId?: string | null;
  } | null;
}

interface AgentContextValue {
  openAssistant: (scope?: AgentScope | null, query?: string | null) => void;
  closeAssistant: () => void;
}

const AgentContext = createContext<AgentContextValue | null>(null);

export function useAssistant() {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error("useAssistant doit être utilisé dans AppShell");
  return ctx;
}

export const AgentContextProvider = AgentContext.Provider;

export function scopeKey(scope?: AgentScope | null): string {
  if (scope?.scriptId) return `script:${scope.scriptId}`;
  if (scope?.appId) return `app:${scope.appId}`;
  if (scope?.storage) return `storage:${scope.storage.scope}:${scope.storage.key}`;
  return "none";
}

export function scopeLabel(scope?: AgentScope | null): string | null {
  if (scope?.scriptId) return `Script ${scope.scriptId.slice(0, 6)}`;
  if (scope?.appId) return `App ${scope.appId.slice(0, 6)}`;
  if (scope?.storage) return `Storage ${scope.storage.key}`;
  return null;
}
