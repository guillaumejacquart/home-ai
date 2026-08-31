import { NextRequest, NextResponse } from "next/server";

import { bridgeRpc } from "@/lib/app-runtime";
import { apiError, errorResponse } from "@/lib/api-helpers";
import { requireUser } from "@/lib/session";
import { getApp } from "@/services/apps/apps";

type Params = { params: Promise<{ id: string }> };

/** SDK bridge: the sandboxed app calls its methods through the parent page. */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const app = await getApp(user.id, id);
    if (!app) return errorResponse("appNotFound", 404);

    const body = await req.json();
    const value = await bridgeRpc.handle(body.method, body.args ?? [], {
      appId: id,
      ownerId: app.ownerId,
    });
    return NextResponse.json({ ok: true, value });
  } catch (err) {
    return await apiError(err);
  }
}
