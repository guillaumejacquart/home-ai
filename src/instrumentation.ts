const POLL_MS = 30_000;
let started = false;

export async function register() {
  // Le scheduler tourne uniquement en runtime Node.js. `NEXT_RUNTIME` est
  // résolu statiquement au build : la branche edge est éliminée, et le
  // `node:vm` de runner.ts n'entre pas dans le bundle edge (sinon warning
  // « node-module-in-edge-runtime »).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Évite de démarrer le scheduler plusieurs fois (workers/dev/build).
  if (started) return;
  started = true;

  const { runDueScripts } = await import("@/services/scripts/runner");
  const { runDueBriefs } = await import("@/services/agent/brief");

  setInterval(() => {
    runDueScripts().catch((err) => {
      console.error("[scheduler]", err);
    });
  }, POLL_MS);

  const BRIEF_POLL_MS = 5 * 60 * 1000;
  setInterval(() => {
    runDueBriefs().catch((err) => {
      console.error("[brief-scheduler]", err);
    });
  }, BRIEF_POLL_MS);
  // Premier check différé de 30s après le démarrage
  setTimeout(() => {
    runDueBriefs().catch((err) => console.error("[brief-scheduler]", err));
  }, 30_000);

  console.log("[scheduler] démarré (toutes les 30s) + brief (toutes les 5min)");
}
