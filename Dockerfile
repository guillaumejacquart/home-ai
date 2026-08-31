# syntax=docker/dockerfile:1
# Image autonome Next.js (output: "standalone") — arm64 compatible (Oracle Ampere).

# ---- deps : installe les modules (better-sqlite3 = build natif) ----
FROM node:24-bookworm-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder : build Next en mode standalone ----
FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Aucune variable runtime n'est inlinée au build : l'image est agnostique du
# domaine et réutilisable telle quelle (auth-client cible l'origine courante).
ENV BUILD_TARGET=docker
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Lightpanda publie des binaires Linux glibc pour les deux architectures Docker.
FROM node:24-bookworm-slim AS lightpanda
ARG TARGETARCH
ARG LIGHTPANDA_VERSION=0.3.5
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN case "$TARGETARCH" in \
      arm64) asset="lightpanda-aarch64-linux" ;; \
      amd64) asset="lightpanda-x86_64-linux" ;; \
      *) echo "Architecture Docker non supportée: $TARGETARCH" >&2; exit 1 ;; \
    esac && \
    curl --fail --location --silent --show-error \
      "https://github.com/lightpanda-io/browser/releases/download/${LIGHTPANDA_VERSION}/${asset}" \
      --output /usr/local/bin/lightpanda && chmod 755 /usr/local/bin/lightpanda

# ---- runner : image finale minimale ----
FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV LIGHTPANDA_BIN=/usr/local/bin/lightpanda
ENV LIGHTPANDA_URL=http://127.0.0.1:9222
ENV LIGHTPANDA_PORT=9222

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs --home-dir /app --shell /usr/sbin/nologin nextjs

# Serveur autonome + assets statiques.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# Migrations SQLite + runner. drizzle-orm est bundlé dans les chunks serveur
# (absent de node_modules du standalone) : on le recopie pour migrate.ts.
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/src/db/migrate.ts ./src/db/migrate.ts
COPY --from=deps /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh
COPY --from=lightpanda /usr/local/bin/lightpanda /usr/local/bin/lightpanda

RUN mkdir -p /app/data && chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
