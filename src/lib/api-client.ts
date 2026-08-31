/**
 * HTTP client for React components. Replaces hand-written `fetch` calls: it
 * reads the `{ error, code }` error shape the routes already return (see
 * `lib/api-helpers.ts`) and throws a typed `ApiError`.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError("network", 0);
  }

  // 204 or empty body: nothing to parse.
  const text = await res.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const shape = payload as { error?: string; code?: string } | null;
    throw new ApiError(shape?.error ?? `HTTP ${res.status}`, res.status, shape?.code);
  }
  return payload as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>("PUT", url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => request<T>("PATCH", url, body ?? {}),
  del: <T>(url: string) => request<T>("DELETE", url),
};

/** Message displayable to the user, with a fallback translated by the caller. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.message && err.message !== "network") return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
