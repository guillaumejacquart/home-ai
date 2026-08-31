# Home AI — Project plan

Personal mini-Lovable: connect external services (Google, mailboxes) and build
small web apps / scripts from prompts. Deployed on the VPS
(`<your-domain>`), for family use.

---

## Vision

Two blocks:

1. **Connections**: external services attached to a user account —
   Google (Drive, Calendar, Gmail, Sheets) via OAuth, and SMTP/IMAP mailboxes
   (Hostinger…) via encrypted credentials.
2. **Apps & scripts**: small web apps generated from a prompt, served at
   `/a/<slug>`, and scripts (scheduled jobs) attached to apps, with run
   history (output, errors).

---

## Stack

- **Language**: TypeScript (strict)
- **Framework**: Next.js 16 (App Router), Tailwind CSS 4
- **Database**: SQLite (better-sqlite3, WAL) + Drizzle ORM
- **Auth**: better-auth (email + password, one account per family member)
- **External services**: googleapis, nodemailer (SMTP), imapflow (IMAP)
- **LLM**: in-house OpenAI-compatible client, multi-provider
  (opencode-go, OpenRouter) — GLM planner / DeepSeek coder by default
- **Deployment**: VPS recipe (arm64 image → GHCR → Traefik), migrations at boot

## App execution architecture

- Each web app = **a single HTML file** stored in the DB, generated under
  fixed conventions: Alpine.js (state + actions), Tailwind, French UI,
  data access only via `homeSDK`.
- Served in a **sandboxed iframe** (`allow-scripts allow-forms allow-modals`,
  opaque origin, CSP `unsafe-eval` required by Alpine) → no access to cookies /
  same-origin data.
- **`homeSDK`** bridge: postMessage iframe → parent page → `POST /api/apps/[id]/rpc`
  → server services (resolved as the **app's owner**).
- **Scripts**: server-side code, `async function main(home)` executed in `node:vm`
  (60s timeout), same `home` SDK, resolved as the owner. Internal scheduler
  (`instrumentation.ts`) runs every 30s. *`node:vm` is not a hard security
  boundary — accepted risk for family use.*

## Data model (SQLite)

- better-auth: `user`, `session`, `account`, `verification`
- `connections` — type (`google`/`smtp`/`imap`), **encrypted** config (AES-256-GCM,
  `ENCRYPTION_KEY`), encrypted OAuth tokens, status
- `apps` — slug, name, owner, visibility (private/family), current version
- `app_versions` — HTML generation history (prompt, model)
- `generation_messages` — generic generation chat: app **or** script (`appId`/`scriptId`), `ownerId` always set
- `app_storage` — per-app JSON KV (SDK)
- `scripts` — linked to an app (optional: standalone), owner + visibility, schedule (5-field cron expression), code, enabled, next/last run
- `script_storage` — per-standalone-script JSON KV (SDK)
- `script_versions` — history of a script's states (restorable)
- `script_runs` — runs: status (success/error/timeout), output, error, duration

## SDK surface (`homeSDK` / `home`)

- `storage`: `get` / `set` / `list` / `remove` (per-app JSON KV)
- `google.drive`: `list` / `read` / `upload`
- `google.calendar`: `list` / `create`
- `google.gmail`: `send` / `search` / `read`
- `google.sheets`: `read` / `append`
- `mail` (SMTP/IMAP): `send` / `search` / `read`
- `ai` (owner's LLM, "build" model): `chat` / `messages`

---

## Milestones

### Milestone 1 — Foundation ✅
Repo, stack (Next/TS/Tailwind/Drizzle/SQLite), better-auth, full schema,
Docker + CI + VPS deployment.

### Milestone 2 — Connections ✅
AES-256-GCM encryption, connections service (CRUD + test), Google OAuth
(read + send scopes, refresh token), SMTP/IMAP (nodemailer/imapflow), UI
`/connections`.

### Milestone 3 — App generation ✅
Multi-provider LLM client, **plan then code** flow (2 routes), versions + chat,
sandboxed runtime `/a/[slug]`, `homeSDK` bridge + KV storage.

### Milestone 4 — SDK services ✅
Google (Drive/Calendar/Gmail/Sheets) + mail exposed in the SDK (iframe bridge
and script SDK), connection resolution as the owner, prompts up to date.

### Milestone 5 — Scripts ✅
Scripts service (CRUD, `node:vm` execution, runs), internal scheduler, script
generation by prompt, `/scripts` UI + editor's Script tab.

### Milestone 6 — Polish ✅
- Consistent error surfaces
- Project `AGENTS.md` (conventions)
- `README.md` (install, deployment, required keys)
- Security audit / limits doc (sandbox, Google permissions)

### Milestone 7 — Catalog & dashboard ✅
- **App catalog**: search, filters (type / visibility / tag),
  auto-generated thumbnails (gradient + initial, derived from the slug), relative
  timestamps, empty state / loading skeleton.
- **App tags**: `tags` column (JSON array), chip editor in the
  Settings tab, tag filtering in the catalog.
- **Connections catalog**: unified searchable + filterable list (type /
  status), picker for available services, inline rename (PATCH API that was
  unused until now).
- **Dashboard** (`/`): recent apps, connection health, latest script
  runs.
- New UI components: `Select`, `EmptyState`; libs `tags`, `thumbnail`,
  `format` (relative time).

---

## Improvements beyond the original plan

- Tabbed app editor (Preview / Script / Versions / Settings), version timeline
- Scripts: manual editing + **prompt-based edits**, restorable versions,
  generation chat shown in the Script tab, inline run result
- View split: Script tab = **authoring**, `/scripts` page = **monitoring**
- App and connection catalogs (search, filters, tags, thumbnails) —
  Milestone 7

---

## User-side TODO (prerequisites)

1. Google Cloud project + OAuth client (redirect
   `/api/connections/google/callback`); family members as testers. Reconnect Google
   when a scope is added.
2. DNS `<your-domain>` → VPS.
3. Secrets (compose / `.env`): `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`,
   `GOOGLE_CLIENT_ID/SECRET`, `OPENCODE_API_KEY`, `OPENROUTER_API_KEY`.

## Risks & limits

- `node:vm` and the iframe sandbox: mitigation, not a guarantee (family use)
- Restricted Google scopes; in *testing* mode, refresh tokens are limited (7 days)
  → switch to unverified production if needed
- Generated code: constrained by the prompt's conventions; versions + rollback
  to revert if needed
