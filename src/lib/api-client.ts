/**
 * Client HTTP des composants React. Remplace les `fetch` à la main :
 * il lit la forme d'erreur `{ error, code }` que renvoient déjà les routes
 * (cf. `lib/api-helpers.ts`) et lève une `ApiError` typée.
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

  // 204 ou corps vide : pas de JSON à lire.
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

/** Message affichable pour l'utilisateur, avec repli traduit par l'appelant. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.message && err.message !== "network") return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
