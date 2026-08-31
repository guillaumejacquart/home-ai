"use client";

import { useCallback, useState } from "react";

import { api } from "@/lib/api-client";
import { useResource } from "@/lib/use-resource";
import type { Locale } from "@/i18n/config";

/** Types partagés par les onglets de Paramètres (réponse de `/api/settings`). */

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

/** Charge `/api/settings`. Chaque onglet ne demande que ce dont il a besoin. */
export function useSettings() {
  return useResource<SettingsData>("/api/settings");
}

/**
 * Recopie une valeur venue du serveur dans l'état local d'un formulaire, une
 * fois par valeur reçue. Fait *pendant le rendu* (pattern React « ajuster
 * l'état pendant le rendu ») plutôt que dans un `useEffect`, qui provoquerait
 * un rendu en cascade.
 */
export function useSyncFrom<T>(value: T | null | undefined, apply: (v: T) => void) {
  const [seen, setSeen] = useState<T | null | undefined>(null);
  if (value != null && value !== seen) {
    setSeen(value);
    apply(value);
  }
}

/**
 * Petit utilitaire d'action : gère le drapeau « en cours » et le message
 * d'erreur, que chaque onglet réécrivait à la main autour de chaque `fetch`.
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

/** PUT partiel sur `/api/settings` (tous les onglets écrivent au même endroit). */
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
