# syntax=docker/dockerfile:1
# Standalone Next.js image (output: "standalone") — arm64 compatible (Oracle Ampere).

# ---- deps: install modules (better-sqlite3 = native build) ----
FROM node:24-bookworm-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: build Next in standalone mode ----
FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No runtime variable is inlined at build time: the image is domain-agnostic
# and reusable as-is (auth-client targets the current origin).
ENV BUILD_TARGET=docker
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Lightpanda publishes Linux glibc binaries for both Docker architectures.
FROM node:24-bookworm-slim AS lightpanda
ARG TARGETARCH
ARG LIGHTPANDA_VERSION=0.3.5
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN case "$TARGETARCH" in \
      arm64) asset="lightpanda-aarch64-linux" ;; \
      amd64) asset="lightpanda-x86_64-linux" ;; \
      *) echo "Unsupported Docker architecture: $TARGETARCH" >&2; exit 1 ;; \
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

# Standalone server + static assets.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# SQLite migrations + runner. drizzle-orm is bundled into the server chunks
# (absent from the standalone's node_modules): copy it back in for migrate.ts.
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/src/db/migrate.ts ./src/db/migrate.ts
COPY --from=deps /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh
COPY --from=lightpanda /usr/local/bin/lightpanda /usr/local/bin/lightpanda

RUN mkdir -p /app/data && chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
