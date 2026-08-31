"use client";

import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api-client";

/**
 * Chargement d'une ressource GET : remplace le trio
 * `useState(data)` / `useState(loading)` / `useState(error)` répété partout.
 * `reload()` relance la requête ; `setData` permet une mise à jour optimiste.
 */
export function useResource<T>(url: string | null, initial: T | null = null) {
  const [data, setData] = useState<T | null>(initial);
  const [loading, setLoading] = useState(url !== null);
  const [error, setError] = useState<Error | null>(null);

  // Changement d'URL : on repasse en chargement *pendant le rendu* (pattern
  // React « ajuster l'état pendant le rendu ») plutôt que dans l'effet, qui
  // déclencherait un rendu en cascade.
  const [currentUrl, setCurrentUrl] = useState(url);
  if (url !== currentUrl) {
    setCurrentUrl(url);
    setLoading(url !== null);
    setError(null);
  }

  const reload = useCallback(async () => {
    if (url === null) return;
    setLoading(true);
    try {
      setData(await api.get<T>(url));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("unknown"));
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    if (url === null) return;
    let active = true;
    api
      .get<T>(url)
      .then((d) => {
        if (active) {
          setData(d);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err : new Error("unknown"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [url]);

  return { data, loading, error, reload, setData };
}
