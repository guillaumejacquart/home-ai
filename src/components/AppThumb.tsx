"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useRef, useState } from "react";

import { injectedLibTags } from "@/lib/app-libs";

interface Props {
  appId: string;
  slug: string;
  name: string;
}

// Same libs as the served document: a preview must render like the app.
function buildThumbDoc(html: string): string {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />${injectedLibTags()}</head><body>${html}</body></html>`;
}

export function AppThumb({ appId, slug: _slug, name }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  // Lazy: only observes and fetches once visible
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: "200px", threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetch(`/api/apps/${appId}/html`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error("html fetch failed");
        const data = (await r.json()) as { document?: string | null };
        if (cancelled) return;
        const html = data.document;
        if (!html) throw new Error("no html");
        setSrcDoc(buildThumbDoc(html));
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, appId]);

  if (!visible) {
    return <div ref={containerRef} className="h-32 bg-canvas" aria-hidden="true" />;
  }

  if (loading) {
    return (
      <div ref={containerRef} className="flex h-32 items-center justify-center bg-canvas">
        <div className="h-6 w-6 animate-pulse rounded bg-line" />
      </div>
    );
  }

  if (error || !srcDoc) {
    return (
      <div ref={containerRef} className="flex h-8 items-center justify-center bg-canvas text-xs text-muted">
        Aperçu indisponible
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-32 overflow-hidden bg-white">
      <iframe
        title={name}
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        loading="lazy"
        className="border-0"
        style={{
          width: "286%",
          height: "286%",
          transform: "scale(0.35)",
          transformOrigin: "top left",
          pointerEvents: "none",
        }}
      />
      <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-line/50" />
    </div>
  );
}
