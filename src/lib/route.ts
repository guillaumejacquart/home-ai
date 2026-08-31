import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { apiError, errorResponse } from "@/lib/api-helpers";
import { isErrorCode } from "@/lib/errors";
import type { Permission } from "@/lib/rbac";
import { requirePermission, requireUser, type AuthUser } from "@/lib/session";

/**
 * Enveloppe des routes API : fait une seule fois ce que chaque route refaisait
 * à la main (auth, lecture du corps, validation, try/catch → `apiError`).
 *
 * Compatibilité des codes d'erreur : un message zod peut porter directement un
 * `ErrorCode` (ex. `z.string().min(1, "keyRequired")`). La réponse est alors
 * exactement celle d'avant — même code, même traduction. Les échecs non
 * étiquetés retombent sur `invalidBody`.
 */

export interface RouteContext<B, Q, P> {
  user: AuthUser;
  body: B;
  query: Q;
  params: P;
  req: NextRequest;
}

export interface RouteConfig<B, Q, P> {
  /** Vérifie une permission RBAC en plus de l'authentification. */
  permission?: Permission;
  body?: z.ZodType<B>;
  query?: z.ZodType<Q>;
  params?: z.ZodType<P>;
  /** Statut quand le handler renvoie une valeur JSON (défaut 200). */
  status?: number;
  /**
   * Renvoyer une `Response` (SSE, flux, redirection) la transmet telle quelle ;
   * toute autre valeur est sérialisée en JSON.
   */
  handler: (ctx: RouteContext<B, Q, P>) => Promise<unknown>;
}

/** Première erreur zod → code d'erreur stable de l'application. */
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
        // Corps absent ou illisible → objet vide : c'est le schéma qui tranche
        // (champs tous optionnels = OK, champ requis = 400 avec son code).
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
