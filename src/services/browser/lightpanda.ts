import { spawn, type ChildProcess } from "node:child_process";

import { env } from "@/lib/env";

let processHandle: ChildProcess | undefined;
let startup: Promise<void> | undefined;

function httpUrl(): string {
  return env.LIGHTPANDA_URL.replace(/^ws/, "http").replace(/\/$/, "");
}

async function healthCheck(): Promise<boolean> {
  try {
    const response = await fetch(`${httpUrl()}/json/version`, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

export async function ensureLightpanda(): Promise<void> {
  if (await healthCheck()) return;
  if (startup) return startup;
  startup = (async () => {
    if (await healthCheck()) return;
    const child = spawn(env.LIGHTPANDA_BIN, ["serve", "--host", "127.0.0.1", "--port", String(env.LIGHTPANDA_PORT)], {
      stdio: "ignore",
      detached: false,
    });
    processHandle = child;
    child.once("exit", () => {
      if (processHandle === child) processHandle = undefined;
    });
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (await healthCheck()) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("Lightpanda ne répond pas sur le port configuré.");
  })().finally(() => {
    startup = undefined;
  });
  return startup;
}

export async function lightpandaWebSocketUrl(): Promise<string> {
  await ensureLightpanda();
  const response = await fetch(`${httpUrl()}/json/version`);
  if (!response.ok) throw new Error(`Lightpanda health check échoué (${response.status}).`);
  const data = (await response.json()) as { webSocketDebuggerUrl?: string };
  if (!data.webSocketDebuggerUrl) throw new Error("Lightpanda ne fournit pas d'endpoint CDP.");
  return data.webSocketDebuggerUrl;
}

export function stopLightpanda(): void {
  processHandle?.kill();
  processHandle = undefined;
}
