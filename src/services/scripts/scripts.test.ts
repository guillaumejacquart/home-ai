import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir: string;
let dbPath: string;
let appId: string;
let ownerId: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "homeai-script-"));
  dbPath = join(dir, "test.db");
  process.env.SQLITE_PATH = dbPath;
  process.env.ENCRYPTION_KEY = "test-encryption-key-12345678901234567890";

  const { createRequire } = await import("node:module");
  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const Database = createRequire(import.meta.url)("better-sqlite3");
  const sqlite = new Database(dbPath);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  sqlite.close();

  const { db, tables } = await import("@/db/client");
  ownerId = "user-script-1";
  await db.insert(tables.user).values({
    id: ownerId,
    name: "Test",
    email: "script@test.com",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const { createApp } = await import("@/services/apps/apps");
  appId = (await createApp(ownerId, { name: "Script App" })).id;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.SQLITE_PATH;
});

describe("scripts", () => {
  it("computes the next run of a cron expression", async () => {
    const { computeNextRun } = await import("@/services/scripts/scripts");
    const from = new Date("2026-01-05T00:00:00"); // Monday (local time)
    const next = computeNextRun("0 8 * * 1", from); // every Monday at 8am
    expect(next.getHours()).toBe(8);
    expect(next.getDay()).toBe(1); // Monday
  });

  it("rejects an invalid schedule without creating the script", async () => {
    const { createScript, ScriptError, listScripts } = await import("@/services/scripts/scripts");

    await expect(
      createScript({
        ownerId,
        name: "bad-schedule",
        schedule: "0 99 * * *",
        code: `async function main(home) {}`,
      }),
    ).rejects.toThrow(ScriptError);

    const scripts = await listScripts(ownerId);
    expect(scripts.some((c) => c.name === "bad-schedule")).toBe(false);
  });

  it("rejects an invalid schedule on update without changing the script", async () => {
    const { createScript, updateScript, ScriptError, getScript } = await import("@/services/scripts/scripts");

    const scriptId = await createScript({
      ownerId,
      name: "valid-schedule",
      schedule: "0 8 * * *",
      code: `async function main(home) {}`,
    });

    await expect(
      updateScript(ownerId, scriptId, { schedule: "0 99 * * *" }),
    ).rejects.toThrow(ScriptError);

    const script = await getScript(scriptId);
    expect(script?.schedule).toBe("0 8 * * *");
  });

  it("creates and runs a script that writes to storage", async () => {
    const { createScript } = await import("@/services/scripts/scripts");
    const { runScript } = await import("@/services/scripts/runner");
    const { scriptScope, storageGet } = await import("@/services/storage/storage");

    const scriptId = await createScript({
      ownerId,
      name: "test-job",
      schedule: "0 8 * * *",
      code: `async function main(home) {
        const n = await home.storage.get("count");
        const next = (Number(n) || 0) + 1;
        await home.storage.set("count", next);
        console.log("count=" + next);
        return next;
      }`,
    });

    const { status } = await runScript(scriptId);
    expect(status).toBe("success");
    expect(await storageGet(scriptScope(scriptId), "count")).toBe(1);

    await runScript(scriptId);
    expect(await storageGet(scriptScope(scriptId), "count")).toBe(2);
  });

  it("records a failed run when the code throws", async () => {
    const { createScript } = await import("@/services/scripts/scripts");
    const { runScript, listScriptRuns } = await import("@/services/scripts/runner");
    const scriptId = await createScript({
      ownerId,
      name: "fail-job",
      schedule: "0 9 * * *",
      code: `async function main(home) { throw new Error("boom"); }`,
    });
    const { status } = await runScript(scriptId);
    expect(status).toBe("error");
    const runs = await listScriptRuns(scriptId);
    expect(runs[0].status).toBe("error");
    expect(runs[0].error).toContain("boom");
  });

  it("runs due scripts via runDueScripts (Date bind regression)", async () => {
    const { createScript } = await import("@/services/scripts/scripts");
    const { runDueScripts, listScriptRuns } = await import("@/services/scripts/runner");
    const { db, tables } = await import("@/db/client");
    const scriptId = await createScript({
      ownerId,
      name: "due-job",
      schedule: "0 8 * * *",
      code: `async function main(home) { console.log("ran"); }`,
    });
    // Makes the script due (next run in the past).
    const past = Math.floor(Date.now() / 1000) - 60;
    await db
      .update(tables.scripts)
      .set({ nextRunAt: new Date(past * 1000) })
      .where(eq(tables.scripts.id, scriptId));

    await expect(runDueScripts()).resolves.toBeGreaterThanOrEqual(1);
    const runs = await listScriptRuns(scriptId);
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs[0].status).toBe("success");
  });

  it("versions the script: v1 on creation, v2 after update, restore adds a snapshot", async () => {
    const { createScript, updateScript, listScriptVersions, restoreScriptVersion } =
      await import("@/services/scripts/scripts");

    const scriptId = await createScript({
      ownerId,
      name: "ver-job",
      schedule: "0 8 * * *",
      code: `async function main(home) { console.log("v1"); }`,
    });

    let versions = await listScriptVersions(scriptId);
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe(1);
    expect(versions[0].code).toContain("v1");

    await updateScript(ownerId, scriptId, {
      name: "ver-job",
      schedule: "0 9 * * *",
      code: `async function main(home) { console.log("v2"); }`,
    });

    versions = await listScriptVersions(scriptId);
    expect(versions).toHaveLength(2);
    expect(versions[0].version).toBe(2);
    expect(versions[0].code).toContain("v2");

    const v1 = versions.find((v) => v.version === 1)!;
    await restoreScriptVersion(ownerId, scriptId, v1.id);

    versions = await listScriptVersions(scriptId);
    expect(versions).toHaveLength(3);
    const latest = versions[0];
    expect(latest.version).toBe(3);
    expect(latest.code).toContain("v1");
    // scripts.ts still generates this restore-snapshot label in French.
    expect(latest.prompt).toContain("Restauration de v1");
  });

  it("persists the run's trace (step/call/log spans) in script_run_spans", async () => {
    const { createScript } = await import("@/services/scripts/scripts");
    const { runScript, listScriptRuns, getScriptRunWithSpans } =
      await import("@/services/scripts/runner");

    const scriptId = await createScript({
      ownerId,
      name: "flow-job",
      schedule: "0 8 * * *",
      code: `async function main(home) {
        await home.step("Count", async () => {
          const n = await home.storage.get("count");
          await home.storage.set("count", Number(n || 0) + 1);
        });
        await home.step("Log", async () => {
          console.log("done");
        });
      }`,
    });

    const { status } = await runScript(scriptId);
    expect(status).toBe("success");

    const runs = await listScriptRuns(scriptId);
    const detail = await getScriptRunWithSpans(runs[0].id);
    expect(detail).not.toBeNull();
    const { spans } = detail!;

    const steps = spans.filter((s) => s.kind === "step");
    expect(steps).toHaveLength(2);
    expect(steps[0].label).toBe("Count");
    expect(steps[0].parentId).toBeNull();
    expect(steps[1].label).toBe("Log");
    expect(steps[1].parentId).toBeNull();

    const calls = spans.filter((s) => s.kind === "call");
    expect(calls.map((c) => c.method)).toEqual(["storage.get", "storage.set"]);
    expect(calls[0].parentId).toBe(steps[0].id);
    expect(calls[1].parentId).toBe(steps[0].id);

    const logs = spans.filter((s) => s.kind === "log");
    expect(logs).toHaveLength(1);
    expect(logs[0].parentId).toBe(steps[1].id);

    const seqs = spans.map((s) => s.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  });

  it("marks a step as failed when its code throws", async () => {
    const { createScript } = await import("@/services/scripts/scripts");
    const { runScript, listScriptRuns, getScriptRunWithSpans } =
      await import("@/services/scripts/runner");

    const scriptId = await createScript({
      ownerId,
      name: "flow-fail",
      schedule: "0 8 * * *",
      code: `async function main(home) {
        await home.step("Bad", async () => {
          await home.storage.get("x");
          throw new Error("boom-in-step");
        });
      }`,
    });

    const { status } = await runScript(scriptId);
    expect(status).toBe("error");
    const runs = await listScriptRuns(scriptId);
    const detail = await getScriptRunWithSpans(runs[0].id);
    const step = detail!.spans.find((s) => s.kind === "step")!;
    expect(step.status).toBe("error");
    expect(step.error).toContain("boom-in-step");
  });

  it("transformPragmas converts // @step to home.__pushStep (implicit scope)", async () => {
    const { transformPragmas } = await import("@/services/scripts/runner");
    const code = `async function main(home) {
  // @step Fetch mails
  const a = 1;
  // @step Summarize
  const b = 2;
}`;
    const out = transformPragmas(code);
    expect(out).toContain('home.__pushStep("Fetch mails")');
    expect(out).toContain('home.__pushStep("Summarize")');
    expect(out).not.toContain("// @step");
    // Implicit scope: no __popStep injected between the two.
    const pushCount = (out.match(/__pushStep/g) ?? []).length;
    expect(pushCount).toBe(2);
  });

  it("transformPragmas handles quotes and // @endstep", async () => {
    const { transformPragmas } = await import("@/services/scripts/runner");
    expect(transformPragmas('// @step "My label"')).toContain('home.__pushStep("My label")');
    expect(transformPragmas("  // @step 'Other'")).toContain('home.__pushStep("Other")');
    expect(transformPragmas("// @endstep")).toContain("home.__popStep()");
    expect(transformPragmas("  // @endstep  ")).toContain("home.__popStep()");
  });

  it("persists the trace via // @step pragmas (implicit scope until the next one)", async () => {
    const { createScript } = await import("@/services/scripts/scripts");
    const { runScript, listScriptRuns, getScriptRunWithSpans } =
      await import("@/services/scripts/runner");

    const scriptId = await createScript({
      ownerId,
      name: "pragma-job",
      schedule: "0 8 * * *",
      code: `async function main(home) {
  // @step Fetch
  await home.storage.get("x");
  await home.storage.set("x", 1);
  // @step Done
  console.log("ok");
}`,
    });

    const { status } = await runScript(scriptId);
    expect(status).toBe("success");
    const runs = await listScriptRuns(scriptId);
    const detail = await getScriptRunWithSpans(runs[0].id);
    const steps = detail!.spans.filter((s) => s.kind === "step");
    expect(steps).toHaveLength(2);
    expect(steps[0].label).toBe("Fetch");
    expect(steps[1].label).toBe("Done");
    const calls = detail!.spans.filter((s) => s.kind === "call");
    expect(calls[0].parentId).toBe(steps[0].id);
    expect(calls[1].parentId).toBe(steps[0].id);
    const logs = detail!.spans.filter((s) => s.kind === "log");
    expect(logs[0].parentId).toBe(steps[1].id);
  });

  it("deletes a script and its related data (runs, versions, messages)", async () => {
    const { createScript, deleteScript, getScript, listScriptVersions } =
      await import("@/services/scripts/scripts");
    const { runScript, listScriptRuns } = await import("@/services/scripts/runner");
    const { addGenerationMessage } = await import("@/services/messages/chat");
    const { db, tables } = await import("@/db/client");

    const scriptId = await createScript({
      ownerId,
      name: "delete-job",
      schedule: "0 8 * * *",
      code: `async function main(home) { console.log("run"); }`,
    });
    await runScript(scriptId); // creates a run
    await addGenerationMessage({ ownerId, scriptId, role: "user", content: "prompt" });

    expect((await listScriptRuns(scriptId)).length).toBeGreaterThanOrEqual(1);
    expect(await listScriptVersions(scriptId)).not.toHaveLength(0);

    await expect(deleteScript(ownerId, scriptId)).resolves.toBeUndefined();

    expect(await getScript(scriptId)).toBeUndefined();
    const orphans = db
      .select({ count: sql`count(*)` })
      .from(tables.scriptRuns)
      .where(eq(tables.scriptRuns.scriptId, scriptId))
      .get();
    expect(orphans?.count).toBe(0);
  });

  it("creates and runs a standalone script (no app) with isolated storage", async () => {
    const { createScript } = await import("@/services/scripts/scripts");
    const { runScript } = await import("@/services/scripts/runner");
    const { scriptScope, storageGet } = await import("@/services/storage/storage");

    const scriptId = await createScript({
      ownerId,
      name: "standalone-job",
      schedule: "0 8 * * *",
      code: `async function main(home) {
        const n = await home.storage.get("count");
        await home.storage.set("count", (Number(n) || 0) + 1);
        return (Number(n) || 0) + 1;
      }`,
    });

    const { status } = await runScript(scriptId);
    expect(status).toBe("success");
    expect(await storageGet(scriptScope(scriptId), "count")).toBe(1);

    await runScript(scriptId);
    expect(await storageGet(scriptScope(scriptId), "count")).toBe(2);
  });

  it("home.app(id).storage writes to the app's storage, home.storage to the script's", async () => {
    const { createScript } = await import("@/services/scripts/scripts");
    const { runScript } = await import("@/services/scripts/runner");
    const { appScope, scriptScope, storageGet } = await import("@/services/storage/storage");

    const scriptId = await createScript({
      ownerId,
      name: "cross-storage",
      schedule: "0 8 * * *",
      code: `async function main(home) {
        await home.app("${appId}").storage.set("k", "app");
        await home.storage.set("k", "script");
      }`,
    });

    expect((await runScript(scriptId)).status).toBe("success");
    expect(await storageGet(appScope(appId), "k")).toBe("app");
    expect(await storageGet(scriptScope(scriptId), "k")).toBe("script");
  });

  it("home.app(id) fails if the app belongs to someone else", async () => {
    const { createScript } = await import("@/services/scripts/scripts");
    const { runScript, listScriptRuns } = await import("@/services/scripts/runner");
    const { createApp } = await import("@/services/apps/apps");
    const { db, tables } = await import("@/db/client");

    const strangerId = "user-script-stranger";
    await db.insert(tables.user).values({
      id: strangerId,
      name: "Stranger",
      email: "stranger@test.com",
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const foreignApp = (await createApp(strangerId, { name: "Someone else's private app" })).id;

    const scriptId = await createScript({
      ownerId,
      name: "cross-owner",
      schedule: "0 8 * * *",
      code: `async function main(home) {
        await home.app("${foreignApp}").storage.set("k", "nope");
      }`,
    });

    expect((await runScript(scriptId)).status).toBe("error");
    expect((await listScriptRuns(scriptId))[0].error).toContain("not found");
  });

  it("is visible to another member when visibility is family, but read-only", async () => {
    const { createScript, listScripts, updateScript, deleteScript, ScriptError, getScript, canWriteScript } =
      await import("@/services/scripts/scripts");
    const { db, tables } = await import("@/db/client");
    const memberId = "user-script-member";
    await db.insert(tables.user).values({
      id: memberId,
      name: "Member",
      email: "member@test.com",
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const scriptId = await createScript({
      ownerId,
      visibility: "family",
      name: "shared-job",
      schedule: "0 8 * * *",
      code: `async function main(home) {}`,
    });

    // Readable by the member.
    const visible = await listScripts(memberId);
    expect(visible.some((c) => c.id === scriptId)).toBe(true);

    const row = await getScript(scriptId, memberId);
    expect(row).toBeTruthy();
    expect(canWriteScript(memberId, row!)).toBe(false);

    // The member can't write.
    await expect(updateScript(memberId, scriptId, { name: "hacked" })).rejects.toThrow(ScriptError);
    await expect(deleteScript(memberId, scriptId)).rejects.toThrow(ScriptError);

    // A private script isn't visible to the member.
    const privateId = await createScript({
      ownerId,
      visibility: "private",
      name: "private-job",
      schedule: "0 8 * * *",
      code: `async function main(home) {}`,
    });
    const visible2 = await listScripts(memberId);
    expect(visible2.some((c) => c.id === privateId)).toBe(false);
  });

  it("creates a manual script with no schedule and never runs it via runDueScripts", async () => {
    const { createScript, listScripts, getScript } = await import("@/services/scripts/scripts");
    const { runDueScripts, listScriptRuns } = await import("@/services/scripts/runner");

    const scriptId = await createScript({
      ownerId,
      triggerKind: "manual",
      name: "manual-job",
      schedule: "",
      code: `async function main(home) { console.log("ran"); }`,
    });

    const script = await getScript(scriptId);
    expect(script?.triggerKind).toBe("manual");
    expect(script?.schedule).toBe("");
    expect(script?.nextRunAt).toBeNull();
    expect(script?.webhookSlug).toBeNull();

    const listed = await listScripts(ownerId);
    expect(listed.find((c) => c.id === scriptId)?.triggerKind).toBe("manual");

    // runDueScripts must never pick up an unscheduled script.
    await runDueScripts();
    expect(await listScriptRuns(scriptId)).toHaveLength(0);
  });

  it("creates a webhook script with slug + secret, and exposes the payload to the code", async () => {
    const { createScript } = await import("@/services/scripts/scripts");
    const { runScript } = await import("@/services/scripts/runner");
    const { scriptScope, storageGet } = await import("@/services/storage/storage");

    const scriptId = await createScript({
      ownerId,
      triggerKind: "webhook",
      name: "webhook-job",
      schedule: "",
      code: `async function main(home) {
        await home.storage.set("last", home.webhook.payload);
      }`,
    });

    // The slug and secret are generated.
    const byId = await (await import("@/services/scripts/scripts")).getScript(scriptId);
    expect(byId?.webhookSlug).toBeTruthy();
    expect(byId?.webhookSecret).toBeTruthy();
    expect(byId?.schedule).toBe("");
    expect(byId?.nextRunAt).toBeNull();

    // The webhook triggers the script with the payload exposed via home.webhook.payload.
    const { status } = await runScript(scriptId, { payload: { event: "n8n", data: 42 } });
    expect(status).toBe("success");
    expect(await storageGet(scriptScope(scriptId), "last")).toEqual({ event: "n8n", data: 42 });

    // With no payload, home.webhook.payload is null.
    await runScript(scriptId);
    expect(await storageGet(scriptScope(scriptId), "last")).toBeNull();
  });

  it("getScriptByWebhookSlug finds the script by its slug", async () => {
    const { createScript, getScript, getScriptByWebhookSlug } = await import("@/services/scripts/scripts");

    const scriptId = await createScript({
      ownerId,
      triggerKind: "webhook",
      name: "webhook-lookup",
      schedule: "",
      code: `async function main(home) {}`,
    });

    const script = await getScript(scriptId);
    const found = await getScriptByWebhookSlug(script!.webhookSlug!);
    expect(found?.id).toBe(scriptId);
  });

  it("allows switching a trigger from schedule to webhook and back", async () => {
    const { createScript, getScript, updateScript } = await import("@/services/scripts/scripts");

    const scriptId = await createScript({
      ownerId,
      name: "switch-trigger",
      schedule: "0 8 * * *",
      code: `async function main(home) {}`,
    });

    // schedule → webhook: the schedule is cleared, a slug+secret appear.
    await updateScript(ownerId, scriptId, { triggerKind: "webhook" });
    let script = await getScript(scriptId);
    expect(script?.triggerKind).toBe("webhook");
    expect(script?.schedule).toBe("");
    expect(script?.nextRunAt).toBeNull();
    expect(script?.webhookSlug).toBeTruthy();
    expect(script?.webhookSecret).toBeTruthy();

    // webhook → manual: slug and secret removed.
    await updateScript(ownerId, scriptId, { triggerKind: "manual" });
    script = await getScript(scriptId);
    expect(script?.triggerKind).toBe("manual");
    expect(script?.webhookSlug).toBeNull();
    expect(script?.webhookSecret).toBeNull();

    // manual → schedule: a schedule is required, otherwise it errors.
    await expect(updateScript(ownerId, scriptId, { triggerKind: "schedule" })).rejects.toThrow();
    await updateScript(ownerId, scriptId, { triggerKind: "schedule", schedule: "0 6 * * *" });
    script = await getScript(scriptId);
    expect(script?.triggerKind).toBe("schedule");
    expect(script?.schedule).toBe("0 6 * * *");
    expect(script?.nextRunAt).toBeTruthy();
  });

  it("deletes the standalone script and its storage (cascade)", async () => {
    const { createScript, deleteScript, getScript } = await import("@/services/scripts/scripts");
    const { runScript } = await import("@/services/scripts/runner");
    const { scriptScope, storageGet } = await import("@/services/storage/storage");
    const { db, tables } = await import("@/db/client");
    const { sql } = await import("drizzle-orm");

    const scriptId = await createScript({
      ownerId,
      name: "del-standalone",
      schedule: "0 8 * * *",
      code: `async function main(home) { await home.storage.set("k", 1); }`,
    });
    await runScript(scriptId);
    expect(await storageGet(scriptScope(scriptId), "k")).toBe(1);

    await deleteScript(ownerId, scriptId);
    expect(await getScript(scriptId)).toBeUndefined();

    const orphans = db
      .select({ count: sql`count(*)` })
      .from(tables.scriptStorage)
      .where(eq(tables.scriptStorage.scriptId, scriptId))
      .get();
    expect(orphans?.count).toBe(0);
  });
});

describe("startScriptRun", () => {
  it("returns control with a \"running\" run before execution finishes", async () => {
    const { createScript } = await import("@/services/scripts/scripts");
    const { startScriptRun, getScriptRun } = await import("@/services/scripts/runner");

    const scriptId = await createScript({
      ownerId,
      name: "async-run",
      schedule: "0 8 * * *",
      code: `async function main(home) {
        await new Promise((r) => setTimeout(r, 60));
        return "done";
      }`,
    });

    const { runId, done } = await startScriptRun(scriptId);
    expect((await getScriptRun(runId))?.status).toBe("running");

    const { status } = await done;
    expect(status).toBe("success");

    const finished = await getScriptRun(runId);
    expect(finished?.status).toBe("success");
    expect(finished?.output).toContain("done");
    expect(finished?.finishedAt).toBeTruthy();
  });

  it("exposes the script's last run", async () => {
    const { createScript } = await import("@/services/scripts/scripts");
    const { runScript, lastScriptRun } = await import("@/services/scripts/runner");

    const scriptId = await createScript({
      ownerId,
      name: "last-run",
      schedule: "0 8 * * *",
      code: `async function main(home) { return "ok"; }`,
    });
    expect(await lastScriptRun(scriptId)).toBeUndefined();

    await runScript(scriptId);
    expect((await lastScriptRun(scriptId))?.status).toBe("success");
  });
});

describe("findOwnedScript", () => {
  it("resolves by id or by name, but not for another user", async () => {
    const { createScript, findOwnedScript, listOwnedScripts } = await import(
      "@/services/scripts/scripts"
    );

    const scriptId = await createScript({
      ownerId,
      name: "Garden Watering",
      schedule: "0 8 * * *",
      code: `async function main(home) {}`,
    });

    expect((await findOwnedScript(ownerId, scriptId))?.id).toBe(scriptId);
    expect((await findOwnedScript(ownerId, "garden watering"))?.id).toBe(scriptId);
    expect(await findOwnedScript("someone-else", scriptId)).toBeUndefined();
    expect(await findOwnedScript(ownerId, "  ")).toBeUndefined();

    const owned = await listOwnedScripts(ownerId);
    expect(owned.some((s) => s.id === scriptId)).toBe(true);
    expect(await listOwnedScripts("someone-else")).toHaveLength(0);
  });
});
