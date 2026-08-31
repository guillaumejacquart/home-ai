"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink, Grid3X3 } from "lucide-react";
import { useTranslations } from "next-intl";

import { AppFrame } from "@/components/AppFrame";

function LazyFrame({ appId, doc, height }: { appId: string; doc: string; height: string }) {
  const tCommon = useTranslations("common");
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visible || !ref.current) return;
    const el = ref.current;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [visible]);

  return (
    <div ref={ref} className="h-full w-full" style={{ height }}>
      {visible ? (
        <AppFrame appId={appId} document={doc} height={height} />
      ) : (
        <div className="flex h-full items-center justify-center text-xs text-muted">{tCommon("loading")}</div>
      )}
    </div>
  );
}

type WidgetHtml = {
  widgetId: string;
  appId: string;
  slug: string;
  name: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  doc: string | null;
  hasUi: boolean;
};

import dynamic from "next/dynamic";
const ResponsiveGridLayout = dynamic(
  () =>
    import("react-grid-layout/legacy").then((m) => {
      const R = m.Responsive as unknown as React.ComponentType<Record<string, unknown>>;
      const W = m.WidthProvider as unknown as (
        c: React.ComponentType<Record<string, unknown>>,
      ) => React.ComponentType<Record<string, unknown>>;
      return W(R);
    }),
  { ssr: false },
);

const ROW_HEIGHT = 70;

export function DashboardViewer({
  dashboardName,
  slug,
  widgets,
}: {
  dashboardName: string;
  slug: string;
  widgets: WidgetHtml[];
}) {
  const t = useTranslations("dashboards");

  if (widgets.length === 0) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/dashboards" className="text-sm text-brand hover:underline">
            {t("backToList")}
          </Link>
          <h1 className="text-xl font-bold text-brand-dark">{dashboardName}</h1>
        </div>
        <div className="flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line bg-white py-16 text-sm text-muted">
          <Grid3X3 className="size-8 opacity-40" />
          <p>{t("emptyBoard")}</p>
          <Link href={`/dashboards`} className="text-brand underline">
            {t("emptyBoardCta")}
          </Link>
        </div>
      </div>
    );
  }

  const layouts = {
    lg: widgets.map((w) => ({ i: w.widgetId, x: w.x, y: w.y, w: w.w, h: w.h })),
    md: widgets.map((w) => ({ i: w.widgetId, x: Math.min(w.x, 7), y: w.y, w: Math.min(w.w, 8), h: w.h })),
    sm: widgets.map((w) => ({ i: w.widgetId, x: Math.min(w.x, 3), y: w.y, w: Math.min(w.w, 4), h: w.h })),
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-line bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link href="/dashboards" className="text-sm text-muted hover:text-brand-dark">
            {t("backToList")}
          </Link>
          <h1 className="truncate font-bold text-brand-dark">{dashboardName}</h1>
          <span className="text-xs text-muted">/d/{slug}</span>
          <Link href={`/dashboards`} className="ml-auto text-sm text-brand hover:underline">
            {t("edit")}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-2 py-4 sm:px-4">
        <ResponsiveGridLayout
          className="layout"
          layouts={layouts}
          breakpoints={{ lg: 1100, md: 700, sm: 0 }}
          cols={{ lg: 12, md: 8, sm: 4 }}
          rowHeight={ROW_HEIGHT}
          margin={[8, 8]}
          containerPadding={[4, 4]}
          isDraggable={false}
          isResizable={false}
        >
          {widgets.map((w) => (
            <div key={w.widgetId} className="relative overflow-hidden rounded-lg border border-line bg-card shadow-card">
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between gap-2 border-b border-line bg-brand-light/30 px-2 py-1.5">
                  <span className="truncate text-xs font-semibold text-brand-dark">{w.title}</span>
                  <Link href={`/a/${w.slug}`} target="_blank" className="rounded p-1 hover:bg-white" title={t("openApp")}>
                    <ExternalLink className="size-3.5" />
                  </Link>
                </div>
                <div className="min-h-0 flex-1 bg-white">
                  {w.doc ? (
                    <LazyFrame appId={w.appId} doc={w.doc} height="100%" />
                  ) : (
                    <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted">
                      {t("appHasNoUi")}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </ResponsiveGridLayout>
      </main>
    </div>
  );
}
