import { NextRequest, NextResponse } from "next/server";

import { bridgeRpc } from "@/lib/app-runtime";
import { apiError, errorResponse } from "@/lib/api-helpers";
import { requireUser } from "@/lib/session";
import { getApp } from "@/services/apps/apps";

type Params = { params: Promise<{ id: string }> };

/** Pont SDK : l'app sandboxée appelle ses méthodes via la page parente. */
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
