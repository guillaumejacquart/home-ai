const POLL_MS = 30_000;
let started = false;

export async function register() {
  // The scheduler only runs on the Node.js runtime. `NEXT_RUNTIME` is
  // resolved statically at build time: the edge branch is eliminated, so
  // runner.ts's `node:vm` never enters the edge bundle (otherwise it would
  // trigger a "node-module-in-edge-runtime" warning).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Avoids starting the scheduler multiple times (workers/dev/build).
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
  // First check delayed by 30s after startup
  setTimeout(() => {
    runDueBriefs().catch((err) => console.error("[brief-scheduler]", err));
  }, 30_000);

  console.log("[scheduler] started (every 30s) + brief (every 5min)");
}
