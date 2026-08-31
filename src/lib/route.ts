import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { apiError, errorResponse } from "@/lib/api-helpers";
import { isErrorCode } from "@/lib/errors";
import type { Permission } from "@/lib/rbac";
import { requirePermission, requireUser, type AuthUser } from "@/lib/session";

/**
 * API route wrapper: does once what every route used to redo by hand (auth,
 * body parsing, validation, try/catch → `apiError`).
 *
 * Error-code compatibility: a zod message can carry an `ErrorCode` directly
 * (e.g. `z.string().min(1, "keyRequired")`). The response is then exactly the
 * previous one — same code, same translation. Unlabelled failures fall back to
 * `invalidBody`.
 */

export interface RouteContext<B, Q, P> {
  user: AuthUser;
  body: B;
  query: Q;
  params: P;
  req: NextRequest;
}

export interface RouteConfig<B, Q, P> {
  /** Checks an RBAC permission on top of authentication. */
  permission?: Permission;
  body?: z.ZodType<B>;
  query?: z.ZodType<Q>;
  params?: z.ZodType<P>;
  /** Status used when the handler returns a JSON value (defaults to 200). */
  status?: number;
  /**
   * Returning a `Response` (SSE, stream, redirect) passes it through as-is;
   * any other value is serialised to JSON.
   */
  handler: (ctx: RouteContext<B, Q, P>) => Promise<unknown>;
}

/** First zod issue → stable application error code. */
function zodResponse(err: z.ZodError) {
  const message = err.issues[0]?.message;
  return errorResponse(isErrorCode(message) ? message : "invalidBody", 400);
}

export function route<B = undefined, Q = undefined, P = Record<string, string>>(
  config: RouteConfig<B, Q, P>,
) {
  return async (
    req: NextRequest,
    ctx?: { params?: Promise<Record<string, string>> },
  ): Promise<Response> => {
    try {
      const user = config.permission
        ? await requirePermission(config.permission)
        : await requireUser();

      const rawParams = (await ctx?.params) ?? {};
      let params = rawParams as P;
      if (config.params) {
        const parsed = config.params.safeParse(rawParams);
        if (!parsed.success) return await zodResponse(parsed.error);
        params = parsed.data;
      }

      let query = undefined as Q;
      if (config.query) {
        const raw = Object.fromEntries(new URL(req.url).searchParams);
        const parsed = config.query.safeParse(raw);
        if (!parsed.success) return await zodResponse(parsed.error);
        query = parsed.data;
      }

      let body = undefined as B;
      if (config.body) {
        // Missing or unreadable body → empty object: the schema decides
        // (all-optional fields = OK, required field = 400 with its code).
        const raw = await req.json().catch(() => ({}));
        const parsed = config.body.safeParse(raw);
        if (!parsed.success) return await zodResponse(parsed.error);
        body = parsed.data;
      }

      const result = await config.handler({ user, body, query, params, req });
      if (result instanceof Response) return result;
      return NextResponse.json(result, { status: config.status ?? 200 });
    } catch (err) {
      return await apiError(err);
    }
  };
}
