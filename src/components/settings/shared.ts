"use client";

import { useCallback, useState } from "react";

import { api } from "@/lib/api-client";
import { useResource } from "@/lib/use-resource";
import type { Locale } from "@/i18n/config";

/** Types shared by the Settings tabs (response of `/api/settings`). */

export type ProviderId = "opencode-go" | "openrouter";

export interface ProviderInfo {
  id: ProviderId;
  source: "db" | "env" | null;
  baseUrl: string;
}

export interface SettingsData {
  defaults: {
    provider: ProviderId;
    plannerModel: string;
    coderModel: string;
    assistantModel: string;
  };
  providers: ProviderInfo[];
  locale: Locale | null;
  brief: { enabled: boolean; hour: number };
  quotas: { daily: number | null; weekly: number | null; monthly: number | null };
}

export interface TestResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

/** Loads `/api/settings`. Each tab only asks for what it needs. */
export function useSettings() {
  return useResource<SettingsData>("/api/settings");
}

/**
 * Copies a value from the server into a form's local state, once per value
 * received. Done *during render* (the React "adjust state during render"
 * pattern) instead of in a `useEffect`, which would trigger a cascading render.
 */
export function useSyncFrom<T>(value: T | null | undefined, apply: (v: T) => void) {
  const [seen, setSeen] = useState<T | null | undefined>(null);
  if (value != null && value !== seen) {
    setSeen(value);
    apply(value);
  }
}

/**
 * Small action helper: manages the "pending" flag and error message that
 * each tab used to hand-roll around every `fetch`.
 */
export function useAction() {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (key: string, fn: () => Promise<void>, fallbackMessage: string) => {
      setPending(key);
      setError(null);
      try {
        await fn();
      } catch (err) {
        setError(err instanceof Error && err.message ? err.message : fallbackMessage);
      } finally {
        setPending(null);
      }
    },
    [],
  );

  return { pending, error, setError, run };
}

/** Partial PUT to `/api/settings` (all tabs write to the same place). */
export function putSettings(patch: Record<string, unknown>) {
  return api.put<{ ok: true; defaults: SettingsData["defaults"] }>("/api/settings", patch);
}

export function formatMicros(v: number | null | undefined): string {
  if (v == null || v === 0) return "—";
  const d = v / 1_000_000;
  return d < 0.01 ? `$${d.toFixed(4)}` : `$${d.toFixed(2)}`;
}

export function formatTokens(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString("fr-FR");
}
