/**
 * Stable error codes returned by services and routes. They are translated when
 * building the HTTP response (see lib/api-helpers.ts), which keeps the business
 * layers language-agnostic.
 * Every code must have a matching key in `messages/*.json` → `errors`.
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
 * A zod validation message can carry an `ErrorCode` directly: the HTTP boundary
 * then recognises it and returns the usual translated response (see
 * `lib/route.ts`). Hence this runtime guard.
 */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Typed error carrying its own HTTP status — routes just rethrow it.
 * With a `code`, the message is translated at the HTTP boundary; without one the
 * raw message is returned as-is (service errors carrying dynamic detail: cron
 * expression, provider response, etc.).
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

/** Not signed in (401). */
export class UnauthenticatedError extends HttpError {
  constructor() {
    super("unauthenticated", 401, "unauthenticated");
    this.name = "UnauthenticatedError";
  }
}

/** Admin-only action (403). */
export class ForbiddenError extends HttpError {
  constructor() {
    super("forbidden", 403, "forbidden");
    this.name = "ForbiddenError";
  }
}

/** Concurrent write conflict: the key changed elsewhere since it was read
 * (409). The client must reload before retrying. */
export class StorageConflictError extends HttpError {
  constructor() {
    super("storageConflict", 409, "storageConflict");
    this.name = "StorageConflictError";
  }
}

/** Table operation on a non-table value (400), or row/key not found during a
 * row operation (404). */
export class StorageRowError extends HttpError {
  constructor(code: Extract<ErrorCode, "storageNotATable" | "rowNotFound" | "keyRequired">) {
    super(code, code === "storageNotATable" ? 400 : 404, code);
    this.name = "StorageRowError";
  }
}
