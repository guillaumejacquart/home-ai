import { redirect } from "next/navigation";

import { DashboardViewer } from "@/components/DashboardViewer";
import { buildAppDocument } from "@/lib/app-runtime";
import { requireUser } from "@/lib/session";
import { getApp } from "@/services/apps/apps";
import { currentHtml } from "@/services/apps/versions";
import { getDashboardBySlug, sanitizeLayoutForViewer } from "@/services/dashboards/dashboards";

export default async function DashboardRuntimePage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");

  const { slug } = await params;
  const dash = await getDashboardBySlug(user.id, slug);
  if (!dash) redirect("/dashboards");

  const sanitized = await sanitizeLayoutForViewer(dash.layout, user.id);

  const widgets = await Promise.all(
    sanitized.widgets.map(async (w) => {
      const app = await getApp(user.id, w.appId);
      if (!app) return null;
      const html = await currentHtml(w.appId);
      const doc = html ? buildAppDocument(html, w.appId) : null;
      return {
        widgetId: w.i,
        appId: w.appId,
        slug: app.slug,
        name: app.name,
        title: w.title ?? app.name,
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
        doc,
        hasUi: Boolean(html),
      };
    }),
  );

  return <DashboardViewer dashboardName={dash.name} slug={dash.slug} widgets={widgets.filter(Boolean) as never[]} />;
}
