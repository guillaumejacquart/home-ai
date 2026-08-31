import { NextRequest, NextResponse } from "next/server";

import { buildAppDocument } from "@/lib/app-runtime";
import { apiError, errorResponse } from "@/lib/api-helpers";
import { requireUser } from "@/lib/session";
import { getApp } from "@/services/apps/apps";
import { currentHtml } from "@/services/apps/versions";

type Params = { params: Promise<{ id: string }> };

/** Full HTML document (CDN + bridge) of the current version, for the preview. */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const app = await getApp(user.id, id);
    if (!app) return errorResponse("appNotFound", 404);
    const html = await currentHtml(id);
    if (!html) return NextResponse.json({ document: null });
    return NextResponse.json({ document: buildAppDocument(html, id) });
  } catch (err) {
    return await apiError(err);
  }
}
