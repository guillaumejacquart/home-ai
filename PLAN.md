# Home AI — Plan du projet

Mini-Lovable personnel : connecter des services externes (Google, boîtes mail) et
créer de petites apps web / scripts à partir de prompts. Déployé sur le VPS
(`<votre-domaine>`), usage familial.

---

## Vision

Deux blocs :

1. **Connexions** : services externes rattachés à un compte utilisateur —
   Google (Drive, Calendar, Gmail, Sheets) en OAuth, et boîtes SMTP/IMAP
   (Hostinger…) en identifiants chiffrés.
2. **Apps & scripts** : des petites apps web générées par prompt, servies sous
   `/a/<slug>`, et des scripts (jobs planifiés) attachés aux apps, avec historique
   des exécutions (output, erreurs).

---

## Stack

- **Langage** : TypeScript (strict)
- **Framework** : Next.js 16 (App Router), Tailwind CSS 4
- **Base de données** : SQLite (better-sqlite3, WAL) + Drizzle ORM
- **Auth** : better-auth (email + mot de passe, compte par membre)
- **Services externes** : googleapis, nodemailer (SMTP), imapflow (IMAP)
- **LLM** : client maison OpenAI-compatible, multi-providers
  (opencode-go, OpenRouter) — planificateur GLM / implémenteur DeepSeek par défaut
- **Déploiement** : recette VPS (image arm64 → GHCR → Traefik), migrations au boot

## Architecture d'exécution des apps

- Chaque app web = **un fichier HTML unique** stocké en base, généré avec des
  conventions imposées : Alpine.js (state + actions), Tailwind, UI en français,
  accès aux données uniquement via `homeSDK`.
- Servie dans une **iframe sandbox** (`allow-scripts allow-forms allow-modals`,
  origine opaque, CSP `unsafe-eval` requis par Alpine) → aucun accès aux cookies /
  au même-origine.
- Pont **`homeSDK`** : postMessage iframe → page parente → `POST /api/apps/[id]/rpc`
  → services serveur (résolus par le **propriétaire de l'app**).
- **Scripts** : code serveur `async function main(home)` exécuté en `node:vm`
  (timeout 60 s), même SDK `home`, résolu par le propriétaire. Scheduler interne
  (`instrumentation.ts`) toutes les 30 s. *`node:vm` n'est pas une frontière de
  sécurité dure — risque accepté pour un usage familial.*

## Modèle de données (SQLite)

- better-auth : `user`, `session`, `account`, `verification`
- `connections` — type (`google`/`smtp`/`imap`), config **chiffrée** (AES-256-GCM,
  clé `ENCRYPTION_KEY`), tokens OAuth chiffrés, statut
- `apps` — slug, nom, owner, visibilité (privée/famille), version courante
- `app_versions` — historique des générations HTML (prompt, modèle)
- `generation_messages` — chat de génération générique : app **ou** script (`appId`/`scriptId`), `ownerId` toujours renseigné
- `app_storage` — KV JSON par app (SDK)
- `scripts` — liés à une app (optionnel : autonomes), owner + visibilité, schedule (expression cron 5 champs), code, enabled, next/last run
- `script_storage` — KV JSON par script autonome (SDK)
- `script_versions` — historique des états d'un script (restauration possible)
- `script_runs` — exécutions : statut (success/error/timeout), output, erreur, durée

## Surface du SDK (`homeSDK` / `home`)

- `storage` : `get` / `set` / `list` / `remove` (KV JSON par app)
- `google.drive` : `list` / `read` / `upload`
- `google.calendar` : `list` / `create`
- `google.gmail` : `send` / `search` / `read`
- `google.sheets` : `read` / `append`
- `mail` (SMTP/IMAP) : `send` / `search` / `read`
- `ai` (LLM du propriétaire, modèle « build ») : `chat` / `messages`

---

## Jalons

### Jalon 1 — Socle ✅
Repo, stack (Next/TS/Tailwind/Drizzle/SQLite), better-auth, schéma complet,
Docker + CI + déploiement VPS.

### Jalon 2 — Connexions ✅
Chiffrement AES-256-GCM, service connexions (CRUD + test), Google OAuth
(scopes lecture + envoi, refresh token), SMTP/IMAP (nodemailer/imapflow), UI
`/connections`.

### Jalon 3 — Génération d'apps ✅
Client LLM multi-providers, flux **plan puis code** (2 routes), versions + chat,
runtime sandboxé `/a/[slug]`, bridge `homeSDK` + KV storage.

### Jalon 4 — SDK services ✅
Google (Drive/Calendar/Gmail/Sheets) + mail exposés dans le SDK (bridge iframe
et SDK script), résolution des connexions par le propriétaire, prompts à jour.

### Jalon 5 — Scripts ✅
Service scripts (CRUD, exécution `node:vm`, runs), scheduler interne, génération
de script par prompt, UI `/scripts` + onglet Script de l'éditeur.

### Jalon 6 — Finitions ✅
- Surfaces d'erreur cohérentes
- `AGENTS.md` du projet (conventions)
- `README.md` (installation, déploiement, clés requises)
- Audit de sécurité / doc des limites (sandbox, permissions Google)

### Jalon 7 — Catalogue & tableau de bord ✅
- **Catalogue d'apps** : recherche, filtres (type / visibilité / étiquette),
  vignettes auto-générées (dégradé + initiale, dérivées du slug), horodatage
  relatif, état vide / squelette de chargement.
- **Étiquettes d'apps** : colonne `tags` (JSON array), éditeur en chips dans
  l'onglet Paramètres, filtrage par étiquette dans le catalogue.
- **Catalogue de connexions** : liste unifiée recherchable + filtrable (type /
  statut), picker des services disponibles, renommage inline (API PATCH jusque-là
  inutilisée).
- **Tableau de bord** (`/`) : apps récentes, santé des connexions, derniers runs
  de scripts.
- Nouveaux composants UI : `Select`, `EmptyState` ; libs `tags`, `thumbnail`,
  `format` (temps relatif).

---

## Améliorations au-delà du plan initial

- Éditeur d'app en onglets (Aperçu / Script / Versions / Paramètres), timeline des versions
- Scripts : édition manuelle + **modification par prompt**, versions restaurables,
  chat de génération affiché dans l'onglet Script, résultat d'exécution inline
- Répartition des vues : onglet Script = **authoring**, page `/scripts` = **supervision**
- Catalogue d'apps et de connexions (recherche, filtres, étiquettes, vignettes) —
  Jalon 7

---

## À faire côté utilisateur (prérequis)

1. Projet Google Cloud + client OAuth (redirect
   `/api/connections/google/callback`) ; famille en testeurs. Reconnecter Google
   quand un scope est ajouté.
2. DNS `<votre-domaine>` → VPS.
3. Secrets (compose / `.env`) : `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`,
   `GOOGLE_CLIENT_ID/SECRET`, `OPENCODE_API_KEY`, `OPENROUTER_API_KEY`.

## Risques & limites

- `node:vm` et iframe sandbox : atténuation, pas garantie (usage familial)
- Scopes Google restreints ; en mode *testing*, refresh tokens limités (7 jours)
  → passer en production non vérifiée si besoin
- Code généré : contraint par les conventions du prompt ; versions + rollback
  pour revenir en arrière