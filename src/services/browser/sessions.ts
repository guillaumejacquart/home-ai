import { randomUUID } from "node:crypto";

import { assertPublicUrl } from "@/lib/ssrf";
import { createPage, type CdpPage } from "@/services/browser/cdp";
import { lightpandaWebSocketUrl } from "@/services/browser/lightpanda";

const MAX_SESSIONS = 5;
const SESSION_TTL_MS = 10 * 60_000;

type Session = { page: CdpPage; runId?: string; lastUsedAt: number };
const sessions = new Map<string, Session>();

function cleanupExpired(): void {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, session] of sessions) {
    if (session.lastUsedAt < cutoff) void closeBrowserSession(id);
  }
}

function getSession(id: string): Session {
  cleanupExpired();
  const session = sessions.get(id);
  if (!session) throw new Error("Browser session not found or expired.");
  session.lastUsedAt = Date.now();
  return session;
}

export async function openBrowserSession(
  url: string,
  options: { timeoutMs?: number; runId?: string } = {},
): Promise<{ sessionId: string; url: string; title: string; text: string }> {
  assertPublicUrl(url);
  cleanupExpired();
  if (sessions.size >= MAX_SESSIONS) throw new Error("Too many concurrent browser sessions.");
  const page = await createPage(await lightpandaWebSocketUrl(), options.timeoutMs ?? 30_000);
  const sessionId = randomUUID();
  try {
    await page.navigate(url, options.timeoutMs ?? 30_000);
    sessions.set(sessionId, { page, runId: options.runId, lastUsedAt: Date.now() });
    return {
      sessionId,
      url: await page.evaluate<string>("location.href"),
      title: await page.evaluate<string>("document.title"),
      text: await page.evaluate<string>("document.body ? document.body.innerText : ''"),
    };
  } catch (error) {
    page.disconnect();
    throw error;
  }
}

export async function clickBrowserSession(sessionId: string, selector: string): Promise<void> {
  const { page } = getSession(sessionId);
  await page.evaluate<void>(`(() => { const selector = ${JSON.stringify(selector)}; const el = document.querySelector(selector); if (!el) throw new Error("Element not found: " + selector); el.click(); })()`);
}

export async function fillBrowserSession(sessionId: string, selector: string, value: string): Promise<void> {
  const { page } = getSession(sessionId);
  await page.evaluate<void>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("Element not found"); el.focus(); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); })()`);
}

export async function waitBrowserSession(sessionId: string, selector: string, timeoutMs = 10_000): Promise<void> {
  const { page } = getSession(sessionId);
  await page.waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, timeoutMs);
}

export async function textBrowserSession(sessionId: string, selector?: string): Promise<string> {
  const { page } = getSession(sessionId);
  return page.evaluate<string>(selector
    ? `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("Element not found"); return el.innerText ?? el.textContent ?? ""; })()`
    : "document.body ? document.body.innerText : ''");
}

export async function htmlBrowserSession(sessionId: string, selector?: string): Promise<string> {
  const { page } = getSession(sessionId);
  return page.evaluate<string>(selector
    ? `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("Element not found"); return el.outerHTML; })()`
    : "document.documentElement.outerHTML");
}

export async function evaluateBrowserSession<T = unknown>(sessionId: string, expression: string): Promise<T> {
  return getSession(sessionId).page.evaluate<T>(expression);
}

export async function closeBrowserSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);
  try {
    await session.page.close();
  } finally {
    session.page.disconnect();
  }
}

export async function closeBrowserSessionsForRun(runId: string): Promise<void> {
  await Promise.all([...sessions].filter(([, session]) => session.runId === runId).map(([id]) => closeBrowserSession(id)));
}
