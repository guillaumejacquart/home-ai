import { NextRequest, NextResponse } from "next/server";

import { buildAppDocument } from "@/lib/app-runtime";
import { apiError, errorResponse } from "@/lib/api-helpers";
import { requireUser } from "@/lib/session";
import { getApp } from "@/services/apps/apps";
import { currentHtml } from "@/services/apps/versions";
import { getDashboard, sanitizeLayoutForViewer } from "@/services/dashboards/dashboards";

type Params = { params: Promise<{ id: string }> };

/** Retourne les documents HTML prêts pour chaque widget visible du tableau. */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const dash = await getDashboard(user.id, id);
    if (!dash) return errorResponse("dashboardNotFound", 404);

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
    return NextResponse.json({ widgets: widgets.filter(Boolean) });
  } catch (err) {
    return await apiError(err);
  }
}
