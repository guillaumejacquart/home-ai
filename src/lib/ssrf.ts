const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const PRIVATE_RE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|fc00:|fe80:)/i;

/** Retourne la raison pour laquelle une URL ne doit pas être appelée côté serveur. */
export function isBlockedUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return "protocole non http(s)";
    if (BLOCKED_HOSTS.has(url.hostname)) return "hôte bloqué";
    if (PRIVATE_RE.test(url.hostname)) return "IP privée bloquée";
    if (url.hostname === "169.254.169.254") return "metadata bloqué";
    return null;
  } catch {
    return "URL invalide";
  }
}

export function assertPublicUrl(raw: string): void {
  const reason = isBlockedUrl(raw);
  if (reason) throw new Error(`URL bloquée : ${reason}`);
}
