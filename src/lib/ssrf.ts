const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const PRIVATE_RE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|fc00:|fe80:)/i;

/** Returns why a URL must not be called from the server. */
export function isBlockedUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return "protocole non http(s)";
    if (BLOCKED_HOSTS.has(url.hostname)) return "blocked host";
    if (PRIVATE_RE.test(url.hostname)) return "blocked private IP";
    if (url.hostname === "169.254.169.254") return "blocked metadata endpoint";
    return null;
  } catch {
    return "invalid URL";
  }
}

export function assertPublicUrl(raw: string): void {
  const reason = isBlockedUrl(raw);
  if (reason) throw new Error(`Blocked URL: ${reason}`);
}
