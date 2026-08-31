# Project conventions (home-ai)

Project-specific conventions for AI agents working in this repo. Read this before
editing code.

## Project

Private family "mini-Lovable" (home-ai). One-liner: a small platform that lets the
family connect external services (Google, SMTP/IMAP) and generate tiny web apps and
scripts from natural-language prompts via an LLM.

Key flows:
- Apps are generated from a prompt and served at `/a/<slug>`.
- Scripts run scheduled scripts against the app's storage and the SDK.
- External connections: Google (Drive/Calendar/Gmail/Sheets), SMTP, IMAP.

## Codebase map

- `src/app/` — pages + API routes (generated apps served at `src/app/a/[slug]`)
- `src/components/` — React UI; primitives in `ui/`
- `src/db/schema.ts` — all tables (SQLite only)
- `src/lib/` — helpers; `app-runtime.ts` is the heart (iframe doc builder, homeSDK bridge, RPC dispatcher)
- `src/services/` — business logic grouped by domain folders (`apps/`, `scripts/`, `connections/`, `generation/`, `llm/`); API routes stay thin and delegate here

## Docs map

Don't re-explore the repo — read the focused doc for your task:

| Task | Read |
|---|---|
| Find where a module/table lives | `content/docs/architecture.mdx` (mirrored in `docs/architecture.md`) |
| Understand generation / serving / script execution flows | `content/docs/flows.mdx` (mirrored in `docs/key-flows.md`) |
| Decide native vs app (product principles) | `content/docs/product-principles.mdx` |
| Extend `homeSDK`, add a route or DB column | `content/docs/flows.mdx` § Common tasks |

The public docs site lives at `/docs` (Fumadocs, integrated). Source is `content/docs/*.mdx` with `meta.json` for nav; `src/app/docs/[[...slug]]/page.tsx` + `src/lib/source.ts` (macro `defineDocs`) render them. Search is `src/app/api/search/route.ts`.

## Keeping docs current

If you add/rename/move a service, lib file, table, or route group, or change a
core flow (generation, serving, homeSDK bridge, script execution), update the
matching page in `content/docs/*.mdx` **and** the plain mirror in `docs/*.md`
**in the same change**. Stale docs are worse than no docs.

## Stack

- Next.js 16 App Router
- TypeScript strict
- Tailwind 4
- better-auth pinned at `1.7.1`
- Drizzle + better-sqlite3 (SQLite ONLY — never add another DB)
- zod, vitest, nodemailer, imapflow, googleapis, cron-parser

## Commands

```sh
npm run dev          # dev server
npm run build        # production build
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm run test         # vitest run
npm run db:generate  # drizzle-kit generate
npm run db:migrate   # tsx src/db/migrate.ts
```

Always run `typecheck` + `lint` + `test` after changing code.

## DB gotchas / conventions

- Drizzle `.where()` must precede `.orderBy()`.
- Do NOT bind `Date` objects inside raw `sql` fragments — use `unixepoch()` for
  time comparisons.
- `app_storage` has NO `id` column; its composite key is `(appId, key)`.
- Scripts can be standalone (`scripts.appId` nullable). Ownership/visibility live on
  the script (`scripts.ownerId` + `scripts.visibility` private/family). Standalone scripts
  use the `script_storage` KV table (key `(scriptId, key)`); app-linked scripts use the
  app's storage. `scripts.triggerKind` (`schedule`|`manual`|`webhook`, default
  `schedule`): an unscheduled trigger has an **empty** `schedule` and a null
  `nextRunAt`. `webhook` = public POST `/api/hooks/<webhookSlug>` + `x-webhook-secret`, body
  exposed via `home.webhook.payload`. `runDueScripts` only picks up `triggerKind='schedule'`.
- Generation chat lives in `generation_messages` (appId **or** scriptId, `ownerId`
  always set), via `src/services/messages/chat.ts`
  (`addGenerationMessage`, `listScriptMessages`).

## LLM

OpenAI-compatible client. Providers:
- `opencode-go`: base `https://opencode.ai/zen/go/v1`, key `OPENCODE_API_KEY`
- `openrouter`: key `OPENROUTER_API_KEY`

API keys resolve via `resolveApiKey(provider)` in `src/services/llm/llm.ts`: the
encrypted `provider_keys` row wins, else the env var. Use `setApiKey` /
`clearApiKey` / `keySource` — never read `env.OPEN*_API_KEY` directly for
runtime calls.

Default models from env (see `src/lib/env.ts`): planner `glm-5.3`, coder
`deepseek-v4-flash`.

## cron-parser v5

Use the named import `{ CronExpressionParser }` and the static
`CronExpressionParser.parse(...)`. The default export has a type/identity
mismatch and must not be used.

## UI conventions

- French UI strings.
- Components in `src/components/ui` (Button/Badge/Card/Field/Input).
- `AppShell` layout.
- "client" components via `"use client"`.

## Generated app HTML conventions

- Alpine.js + Tailwind injected by the platform.
- Use a global `function app()` + `x-data="app()"`.
- No `Alpine.data` / `alpine:init`.
- Only `homeSDK` for external data.
- JSON responses.

## Error handling

Server routes use `apiError(err)` from `@/lib/api-helpers`. Friendly 400s for
`AppError` / `ConnectionError` / `LlmError` / `ScriptError`.

## Security notes

`node:vm` and the iframe sandbox are mitigations, not hard security boundaries
(family use). Never commit `.env` or `local.db`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
