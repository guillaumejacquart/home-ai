/**
 * Codes d'erreur stables renvoyés par les services et les routes. Ils sont
 * traduits au moment de construire la réponse HTTP (cf. lib/api-helpers.ts),
 * ce qui garde les couches métier indépendantes de la langue.
 * Chaque code doit avoir une clé correspondante dans `messages/*.json` → `errors`.
 */
export const ERROR_CODES = [
  "serverError",
  "unauthenticated",
  "forbidden",
  "appNotFound",
  "scriptNotFound",
  "hookNotFound",
  "runNotFound",
  "connectionNotFound",
  "dashboardNotFound",
  "threadNotFound",
  "nameRequired",
  "keyRequired",
  "storageValueInvalid",
  "storageConflict",
  "storageNotATable",
  "rowNotFound",
  "invalidRowOp",
  "labelRequired",
  "promptRequired",
  "promptTooLong",
  "planRequired",
  "scriptFieldsRequired",
  "mailFieldsRequired",
  "unknownConnectionType",
  "invalidProvider",
  "invalidLocale",
  "providerNotConfigured",
  "contentRequired",
  "invalidContent",
  "invalidKind",
  "invalidPinned",
  "invalidBody",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Un message de validation zod peut porter directement un `ErrorCode` : la
 * frontière HTTP le reconnaît alors et renvoie la réponse traduite habituelle
 * (cf. `lib/route.ts`). D'où ce garde à l'exécution.
 */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Erreur typée portant son statut HTTP — les routes n'ont qu'à la propager.
 * Avec un `code`, le message est traduit à la frontière HTTP ; sans code, le
 * message brut est renvoyé tel quel (erreurs de service porteuses de détail
 * dynamique : expression cron, réponse du provider, etc.).
 */
export class HttpError extends Error {
  readonly code?: ErrorCode;

  constructor(message: string, status: number, code?: ErrorCode);
  constructor(
    message: string,
    readonly status: number,
    code?: ErrorCode,
  ) {
    super(message);
    this.name = "HttpError";
    this.code = code;
  }
}

/** Non connecté (401). */
export class UnauthenticatedError extends HttpError {
  constructor() {
    super("unauthenticated", 401, "unauthenticated");
    this.name = "UnauthenticatedError";
  }
}

/** Action réservée aux administrateurs (403). */
export class ForbiddenError extends HttpError {
  constructor() {
    super("forbidden", 403, "forbidden");
    this.name = "ForbiddenError";
  }
}

/** Conflit d'écriture concurrent : la clé a été modifiée ailleurs depuis sa
 * lecture (409). Le client doit recharger avant de réessayer. */
export class StorageConflictError extends HttpError {
  constructor() {
    super("storageConflict", 409, "storageConflict");
    this.name = "StorageConflictError";
  }
}

/** Opération table sur une valeur non-table (400), ou ligne/clé introuvable
 * lors d'une opération ligne (404). */
export class StorageRowError extends HttpError {
  constructor(code: Extract<ErrorCode, "storageNotATable" | "rowNotFound" | "keyRequired">) {
    super(code, code === "storageNotATable" ? 400 : 404, code);
    this.name = "StorageRowError";
  }
}
