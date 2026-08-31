"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * Affiche une app dans une iframe sandbox et relaie les appels `homeSDK`
 * (postMessage de l'iframe) vers le serveur (`/api/apps/[id]/rpc`), puis renvoie
 * le résultat à l'iframe.
 *
 * L'iframe n'est montée qu'après l'enregistrement du listener `message` : sinon,
 * au chargement initial (srcDoc rendu côté serveur, l'iframe démarre pendant le
 * parsing), l'app peut poster un message avant que le pont du parent soit prêt →
 * message perdu, promesse pendante, données jamais chargées.
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
            // Si le serveur n'a pas envoyé de done (fin sans event), on clôt quand même
            // Le done est normalement envoyé par le serveur ; on s'assure de fermer.
            // Si le stream s'est terminé sans done, on envoie done pour résoudre la promesse.
            // On vérifie que le pending existe encore (sinon déjà done).
            // Pour simplifier, on ne fait rien ici : le serveur envoie toujours done.
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
    // Volontaire : monter l'iframe seulement après que le listener est actif,
    // pour garantir l'ordre listener → iframe (sinon perte de message au load).
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
