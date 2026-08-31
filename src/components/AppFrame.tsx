"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * Displays an app in a sandboxed iframe and relays `homeSDK` calls
 * (postMessage from the iframe) to the server (`/api/apps/[id]/rpc`), then
 * sends the result back to the iframe.
 *
 * The iframe only mounts after the `message` listener is registered: otherwise,
 * on initial load (srcDoc rendered server side, the iframe starts during
 * parsing), the app could post a message before the parent bridge is ready →
 * lost message, pending promise, data never loaded.
 */
export function AppFrame({
  appId,
  document: doc,
  height = "100%",
}: {
  appId: string;
  document: string;
  height?: string;
}) {
  const t = useTranslations("appFrame");
  const tCommon = useTranslations("common");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const msg = e.data;
      if (!msg || !iframeRef.current) return;
      if (e.source !== iframeRef.current.contentWindow) return;

      if (msg.type === "homesdk") {
        (async () => {
          const res = await fetch(`/api/apps/${appId}/rpc`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ method: msg.method, args: msg.args }),
          });
          const data = await res.json().catch(() => ({ error: t("invalidResponse") }));
          iframeRef.current?.contentWindow?.postMessage(
            {
              type: "homesdk-result",
              id: msg.id,
              ok: data.ok === true,
              value: data.value,
              error: data.error,
            },
            "*",
          );
        })();
        return;
      }

      if (msg.type === "homesdk-stream") {
        (async () => {
          try {
            const res = await fetch(`/api/apps/${appId}/rpc/stream`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ method: msg.method, args: msg.args }),
            });
            if (!res.ok || !res.body) {
              const data = await res.json().catch(() => ({ error: t("invalidResponse") }));
              iframeRef.current?.contentWindow?.postMessage(
                { type: "homesdk-stream-error", id: msg.id, error: data.error ?? "Erreur" },
                "*",
              );
              return;
            }
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let event = "message";
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";
              for (const raw of lines) {
                const line = raw.trimEnd();
                if (line.startsWith(":")) continue;
                if (line.startsWith("event:")) {
                  event = line.slice(6).trim();
                  continue;
                }
                if (line.startsWith("data:")) {
                  const dataStr = line.slice(5).trim();
                  if (!dataStr) continue;
                  let data: unknown;
                  try {
                    data = JSON.parse(dataStr);
                  } catch {
                    continue;
                  }
                  if (event === "token") {
                    const token = (data as { token?: string }).token ?? "";
                    if (token)
                      iframeRef.current?.contentWindow?.postMessage(
                        { type: "homesdk-stream-token", id: msg.id, token },
                        "*",
                      );
                  } else if (event === "done") {
                    iframeRef.current?.contentWindow?.postMessage(
                      { type: "homesdk-stream-done", id: msg.id },
                      "*",
                    );
                  } else if (event === "error") {
                    const err = (data as { error?: string }).error ?? "Erreur";
                    iframeRef.current?.contentWindow?.postMessage(
                      { type: "homesdk-stream-error", id: msg.id, error: err },
                      "*",
                    );
                  }
                  event = "message";
                }
              }
            }
            // The server always sends a "done" event, so nothing to do here
            // if the stream ends without one — this is just a safety comment.
          } catch (err) {
            iframeRef.current?.contentWindow?.postMessage(
              { type: "homesdk-stream-error", id: msg.id, error: err instanceof Error ? err.message : "Erreur" },
              "*",
            );
          }
        })();
        return;
      }
    }
    window.addEventListener("message", onMessage);
    // Intentional: mount the iframe only after the listener is active, to
    // guarantee listener → iframe ordering (otherwise a message can be lost on load).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(true);
    return () => window.removeEventListener("message", onMessage);
  }, [appId, t]);

  if (!ready) {
    return (
      <div
        style={{ height, width: "100%" }}
        className="flex items-center justify-center text-sm text-muted"
      >
        {tCommon("loading")}
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      srcDoc={doc}
      sandbox="allow-scripts allow-forms allow-modals"
      style={{ height, width: "100%", border: "none" }}
      title="app"
    />
  );
}
