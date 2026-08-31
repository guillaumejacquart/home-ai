type CdpMessage = {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message?: string };
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
};

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

const DEFAULT_TIMEOUT_MS = 30_000;

/** Minimal CDP client, with no Playwright or browser dependency. */
export class CdpConnection {
  private readonly socket: WebSocket;
  private nextId = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<string, Set<(params: Record<string, unknown>) => void>>();
  private closed = false;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => this.onMessage(String(event.data)));
    socket.addEventListener("close", () => this.failAll(new Error("Lightpanda connection closed.")));
    socket.addEventListener("error", () => this.failAll(new Error("Connexion Lightpanda interrompue.")));
  }

  static connect(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<CdpConnection> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          socket.close();
          reject(new Error("Connexion CDP timeout."));
        }
      }, timeoutMs);
      socket.addEventListener("open", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(new CdpConnection(socket));
      });
      socket.addEventListener("error", () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error("Could not reach Lightpanda."));
        }
      });
    });
  }

  async send<T extends Record<string, unknown> = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Connexion CDP indisponible.");
    }
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout (${method}).`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(method: string, listener: (params: Record<string, unknown>) => void): () => void {
    let listeners = this.listeners.get(method);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(method, listeners);
    }
    listeners.add(listener);
    return () => listeners?.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.failAll(new Error("CDP connection closed."));
    this.socket.close();
  }

  private onMessage(raw: string): void {
    let message: CdpMessage;
    try {
      message = JSON.parse(raw) as CdpMessage;
    } catch {
      return;
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message ?? "CDP error."));
      else pending.resolve(message.result ?? {});
      return;
    }
    if (message.method) {
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {});
    }
  }

  private failAll(error: Error): void {
    if (this.closed && this.pending.size === 0) return;
    this.closed = true;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

export class CdpPage {
  constructor(
    private readonly connection: CdpConnection,
    readonly targetId: string,
    private readonly sessionId: string,
  ) {}

  async navigate(url: string, timeoutMs: number): Promise<void> {
    await this.command("Page.enable");
    await this.command("Runtime.enable");
    await this.command("Page.navigate", { url }, timeoutMs);
    await this.waitFor("document.readyState === 'complete' || document.readyState === 'interactive'", timeoutMs);
  }

  async evaluate<T>(expression: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    const result = await this.command<{ result?: { value?: T; description?: string; type?: string } }>(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      timeoutMs,
    );
    const remote = result.result;
    if (!remote) throw new Error("Invalid Runtime.evaluate response.");
    if (remote.type === "undefined") return undefined as T;
    if (remote.value !== undefined) return remote.value;
    throw new Error(remote.description ?? "JavaScript evaluation failed.");
  }

  async waitFor(expression: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.evaluate<boolean>(expression, Math.min(2_000, timeoutMs))) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Attente timeout (${timeoutMs} ms).`);
  }

  async captureScreenshot(opts: { format?: string; quality?: number; clip?: { x: number; y: number; width: number; height: number; scale?: number } } = {}): Promise<string> {
    const result = await this.command<{ data: string }>("Page.captureScreenshot", {
      format: opts.format ?? "png",
      quality: opts.quality,
      clip: opts.clip,
      captureBeyondViewport: Boolean(opts.clip),
    });
    if (!result.data) throw new Error("Empty screenshot.");
    return result.data;
  }

  async close(): Promise<void> {
    await this.connection.send("Target.closeTarget", { targetId: this.targetId });
  }

  disconnect(): void {
    this.connection.close();
  }

  private command<T extends Record<string, unknown> = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    return this.connection.send<T>(method, params, this.sessionId, timeoutMs);
  }
}

export async function createPage(cdpUrl: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<CdpPage> {
  const connection = await CdpConnection.connect(cdpUrl, timeoutMs);
  try {
    const target = await connection.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" }, undefined, timeoutMs);
    const attached = await connection.send<{ sessionId: string }>("Target.attachToTarget", { targetId: target.targetId, flatten: true }, undefined, timeoutMs);
    return new CdpPage(connection, target.targetId, attached.sessionId);
  } catch (error) {
    connection.close();
    throw error;
  }
}
