"use client";

import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api-client";

/**
 * Loads a GET resource: replaces the trio of
 * `useState(data)` / `useState(loading)` / `useState(error)` repeated everywhere.
 * `reload()` re-runs the request; `setData` allows an optimistic update.
 */
export function useResource<T>(url: string | null, initial: T | null = null) {
  const [data, setData] = useState<T | null>(initial);
  const [loading, setLoading] = useState(url !== null);
  const [error, setError] = useState<Error | null>(null);

  // URL change: go back to loading *during render* (React's "adjusting state
  // during render") rather than in the effect, which would cascade a re-render.
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
