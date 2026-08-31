# Cron execution flow — `home.step` pragmas

Status: implemented (phase 1 + phase 2).

Both pragmas are live:
- `await home.step("Label", fn)` wrapper
- `// @step Label` comment with implicit scope until next `// @step` or end (`// @endstep` optional)

## Context

Today `cron_runs` (`src/db/schema.ts`) is a black box (`output/error/durationMs`).
`src/services/crons/runner.ts` runs `async function main(home)` from `crons.code`
in `node:vm` via `buildCronSdk`. No per-call trace. Goal: n8n-like flow without
turning crons into a rigid node graph.

Agreed approach:

- **Phase 1** — `await home.step("Label", fn)` wrapper + automatic
  `home.*` call tracing. Spans stored in `cron_run_spans`, rendered as a
  vertical timeline in `CronFlow.tsx`.
- **Phase 2** — `// @step Label` comment desugared to
  `home.__pushStep(...)` with **implicit scope until next `// @step` or EOF**
  (auto-pop in `__pushStep`, `closeImplicit` at end). `// @endstep` also
  supported as explicit `home.__popStep()`.

## Architecture

```
LLM / human writes code with optional home.step
        |
  [transformPragmas]  -- phase1 no-op, phase2: // @step -> __pushStep
        |
  createTracedHome() wraps home.* + home.step + __pushStep/__popStep
  activeStack + spans[] (step/call/log tree)
        |
  vm.runInContext (runner.ts)  60s timeout
        |
  runCron -> insert cron_runs row -> bulk insert cron_run_spans ordered by seq
        |
  GET /api/crons/[id]/runs/[runId] -> { run, spans }
        |
  CronFlow.tsx vertical timeline inside CronsManager runs tab
```

## DB

`cron_run_spans`:

| col | type |
|---|---|
| `id` PK TEXT |
| `runId` TEXT NOT NULL FK `cron_runs.id` CASCADE |
| `parentId` TEXT nullable FK self CASCADE |
| `seq` INTEGER NOT NULL |
| `kind` TEXT enum `step\|call\|log` |
| `origin` TEXT enum `explicit\|implicit` nullable |
| `label` TEXT nullable |
| `method` TEXT nullable |
| `args` TEXT nullable (JSON string, 4KB cap) |
| `result` TEXT nullable (JSON string, 4KB cap) |
| `status` TEXT enum `success\|error` |
| `error` TEXT nullable |
| `startedAt` INTEGER timestamp |
| `durationMs` INTEGER nullable |

Indexes `(runId, seq)`, `(runId, parentId)`.

## Files touched

- `src/db/schema.ts` — table
- `drizzle/*.sql` — migration
- `src/services/crons/traced-sdk.ts` — new: tracer, `home.step`, `__pushStep`/`__popStep`
- `src/services/crons/sdk.ts` — `CronSdk` interface + `home.step`
- `src/services/crons/runner.ts` — `transformPragmas` (`// @step` → `__pushStep`), traced home, span insert
- `src/app/api/crons/[id]/runs/[runId]/route.ts` — new: run + spans
- `src/components/CronFlow.tsx` — new: vertical timeline
- `src/components/CronsManager.tsx` — run expansion fetches spans
- `src/services/generation/cron.ts` — CRON_SYSTEM mentions `home.step`
- `src/services/crons/crons.test.ts` / `sdk.test.ts` — tests
- `docs/architecture.md` / `docs/key-flows.md`

## Phase 2 transform (enabled)

```ts
export function transformPragmas(code: string): string {
  let out = code.replace(/^[ \t]*\/\/[ \t]*@step[ \t]+(.+?)[ \t]*$/gm, (match, label) => {
    const indent = match.match(/^([ \t]*)/)?.[1] ?? "";
    let trimmed = label.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
      trimmed = trimmed.slice(1, -1);
    return `${indent}home.__pushStep(${JSON.stringify(trimmed)});`;
  });
  out = out.replace(/^[ \t]*\/\/[ \t]*@endstep[ \t]*$/gm, (match) => {
    const indent = match.match(/^([ \t]*)/)?.[1] ?? "";
    return `${indent}home.__popStep();`;
  });
  return out;
}
```

Implicit scope comes from `__pushStep` auto-pop (pop top if it was implicit),
not from injected pops. EOF auto-closes remaining implicit steps. No `await`
emitted — works inside both `async` and sync helpers.