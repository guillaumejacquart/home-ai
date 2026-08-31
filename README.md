# home-ai

A family "mini-Lovable": connect your external services (Google Drive/Calendar/Gmail/Sheets,
SMTP/IMAP mailboxes) and build small web apps (`/a/<slug>`) and scripts from natural-language
prompts, via an LLM. Private, for family use.

## Stack

- Next.js 16 App Router · TypeScript strict · Tailwind 4
- Drizzle ORM + better-sqlite3 (SQLite)
- better-auth (1.7.1) · zod · vitest
- nodemailer · imapflow · googleapis · cron-parser

## Prerequisites

- Node.js (version set by `package.json` / `.nvmrc` if present)
- npm

## Installation

```sh
npm install
cp .env.example .env   # then fill in the values
npm run db:migrate
npm run browser:install # installs Lightpanda into .local/bin
npm run dev
```

The app is then available at `http://localhost:3000`.

## Environment variables

All of them are documented and validated in `src/lib/env.ts`. `.env` is gitignored.

| Variable | Description |
| --- | --- |
| `BETTER_AUTH_SECRET` | better-auth session secret (≥ 16 chars). |
| `BETTER_AUTH_URL` | Public URL of the app (e.g. `http://localhost:3000`). |
| `ENCRYPTION_KEY` | AES-256-GCM key used to encrypt connection secrets (`openssl rand -base64 32`). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials. |
| `OPENCODE_API_KEY` | API key for the `opencode-go` LLM provider (overridable in the DB). |
| `OPENCODE_BASE_URL` | opencode-go base URL (default `https://opencode.ai/zen/go/v1`). |
| `OPENROUTER_API_KEY` | OpenRouter API key (optional, overridable in the DB). |
| `OPENROUTER_BASE_URL` | OpenRouter base URL (default `https://openrouter.ai/api/v1`). |
| `LLM_PLANNER_MODEL` | Planner model (default `glm-5.3`). |
| `LLM_CODER_MODEL` | Coder model (default `deepseek-v4-flash`). |
| `SQLITE_PATH` | Path to the SQLite file (default `./local.db`). |
| `LIGHTPANDA_BIN` | Lightpanda binary (default `.local/bin/lightpanda` locally, `/usr/local/bin/lightpanda` in Docker). |
| `LIGHTPANDA_URL` | Lightpanda CDP HTTP endpoint (default `http://127.0.0.1:9222`). |
| `LIGHTPANDA_PORT` | Local CDP port (default `9222`). |

Google notes:

- OAuth callback URI: `/api/connections/google/callback`.
- After adding scopes (e.g. Google Sheets), reconnect the Google account.

LLM API keys: the env vars above are the server defaults. They can be
**overridden per provider from the Settings page** (`/settings`) — keys entered
there are encrypted (AES-256-GCM, `ENCRYPTION_KEY`) in the `provider_keys` table.
The DB key takes priority; removing it falls back to the env value.

## Usage

1. Create an account.
2. Add connections (Google / SMTP / IMAP).
3. In the editor, create an app from a prompt (Preview / Script / Versions / Settings tabs).
4. Open the app served at `/a/<slug>`.
5. Create scripts in the Script tab; monitor them in `/scripts`.

## Deployment (VPS)

Short recipe, standalone Docker image:

- Standalone image: `BUILD_TARGET=docker`.
- `arm64` image pushed to GHCR: `ghcr.io/guillaumejacquart/home-ai`.
- Traefik reverse proxy on `<your-domain>`.
- SQLite file in `/app/data`.
- SQLite migrations run at startup (docker-entrypoint).
- Lightpanda `0.3.5` is downloaded automatically during the Docker build;
  override the version with `docker build --build-arg LIGHTPANDA_VERSION=...`.

## Documentation

Public site at `/docs` (integrated Fumadocs). Source in `content/docs/*.mdx` — see [Architecture](/docs/architecture), [Key flows](/docs/flows), [homeSDK](/docs/sdk). Search at `/api/search`.

## Security & limits

- Iframe sandbox + CSP: `unsafe-eval` required by Alpine, `form-action 'none'`, opaque origin,
  no cookies sent to the app.
- `node:vm` is **not** a hard security boundary: LLM-generated code runs server-side.
  Accepted risk for family use.
- Connection secrets encrypted with AES-256-GCM (`ENCRYPTION_KEY`).
- Restricted Google scopes; refresh tokens are limited in test mode (~7 days).
- "Family" visibility: any authenticated family account can see/run it.
- Never commit `.env` or `local.db`.
