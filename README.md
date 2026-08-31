# home-ai

Mini-Lovable familial : connectez vos services externes (Google Drive/Calendar/Gmail/Sheets,
boîtes SMTP/IMAP) et créez de petites apps web (`/a/<slug>`) et des scripts à partir de prompts
en langage naturel, via un LLM. Privé, à usage familial.

## Stack

- Next.js 16 App Router · TypeScript strict · Tailwind 4
- Drizzle ORM + better-sqlite3 (SQLite)
- better-auth (1.7.1) · zod · vitest
- nodemailer · imapflow · googleapis · cron-parser

## Prérequis

- Node.js (version définie par `package.json` / `.nvmrc` si présent)
- npm

## Installation

```sh
npm install
cp .env.example .env   # puis renseigner les valeurs
npm run db:migrate
npm run browser:install # installe Lightpanda dans .local/bin
npm run dev
```

L'application est ensuite disponible sur `http://localhost:3000`.

## Variables d'environnement

Toutes sont documentées et validées dans `src/lib/env.ts`. `.env` est gitignoré.

| Variable | Description |
| --- | --- |
| `BETTER_AUTH_SECRET` | Secret de session better-auth (≥ 16 chars). |
| `BETTER_AUTH_URL` | URL publique de l'app (ex. `http://localhost:3000`). |
| `ENCRYPTION_KEY` | Clé AES-256-GCM de chiffrement des secrets de connexion (`openssl rand -base64 32`). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Credentials OAuth Google. |
| `OPENCODE_API_KEY` | Clé API provider LLM `opencode-go` (surchargeable en base). |
| `OPENCODE_BASE_URL` | Base URL opencode-go (défaut `https://opencode.ai/zen/go/v1`). |
| `OPENROUTER_API_KEY` | Clé API OpenRouter (optionnel, surchargeable en base). |
| `OPENROUTER_BASE_URL` | Base URL OpenRouter (défaut `https://openrouter.ai/api/v1`). |
| `LLM_PLANNER_MODEL` | Modèle planificateur (défaut `glm-5.3`). |
| `LLM_CODER_MODEL` | Modèle implémenteur (défaut `deepseek-v4-flash`). |
| `SQLITE_PATH` | Chemin du fichier SQLite (défaut `./local.db`). |
| `LIGHTPANDA_BIN` | Binaire Lightpanda (défaut `.local/bin/lightpanda` en local, `/usr/local/bin/lightpanda` dans Docker). |
| `LIGHTPANDA_URL` | Endpoint HTTP CDP Lightpanda (défaut `http://127.0.0.1:9222`). |
| `LIGHTPANDA_PORT` | Port CDP local (défaut `9222`). |

Notes Google :

- URI de callback OAuth : `/api/connections/google/callback`.
- Après avoir ajouté des scopes (ex. Google Sheets), reconnectez le compte Google.

Clés API LLM : les variables d'env ci-dessus sont les défauts serveur. Elles
peuvent être **surchargées par provider depuis la page Paramètres** (`/settings`)
— les clés saisies sont chiffrées (AES-256-GCM, `ENCRYPTION_KEY`) dans la table
`provider_keys`. La clé en base a priorité ; retirer la clé revient à l'env.

## Utilisation

1. Créez un compte.
2. Ajoutez des connexions (Google / SMTP / IMAP).
3. Dans l'éditeur, créez une app à partir d'un prompt (onglets Aperçu / Script / Versions / Paramètres).
4. Ouvrez l'app servie à `/a/<slug>`.
5. Créez des scripts dans l'onglet Script ; supervisez-les dans `/scripts`.

## Déploiement (VPS)

Recette concise, image Docker standalone :

- Image autonome : `BUILD_TARGET=docker`.
- Image `arm64` poussée sur GHCR : `ghcr.io/guillaumejacquart/home-ai`.
- Reverse proxy Traefik sur `<votre-domaine>`.
- Fichier SQLite dans `/app/data`.
- Les migrations SQLite sont exécutées au démarrage (docker-entrypoint).
- Lightpanda `0.3.5` est téléchargé automatiquement pendant le build Docker ;
  remplacer la version avec `docker build --build-arg LIGHTPANDA_VERSION=...`.

## Sécurité & limites

- Le iframe sandbox + CSP : `unsafe-eval` requis par Alpine, `form-action 'none'`, origine opaque,
  pas de cookies vers l'app.
- `node:vm` n'est **pas** une frontière de sécurité stricte : le code LLM généré s'exécute côté
  serveur. Risque accepté pour un usage familial.
- Secrets de connexion chiffrés en AES-256-GCM (`ENCRYPTION_KEY`).
- Scopes Google restreints ; refresh tokens en mode test limités (~7 jours).
- Visibilité « famille » : tous les comptes authentifiés de la famille peuvent voir/exécuter.
- Ne jamais committer `.env` ni `local.db`.
