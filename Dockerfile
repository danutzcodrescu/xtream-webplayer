# ── Stage 1: build on the builder's native CPU, not under QEMU ────────────────
# SvelteKit emits portable JavaScript; native Vite/Rolldown tooling must run
# on BUILDPLATFORM to avoid ARM64 illegal-instruction crashes under emulation.
FROM --platform=$BUILDPLATFORM node:alpine AS builder

WORKDIR /app

RUN npm install --global pnpm@latest

# Install all deps (including dev)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Build the SvelteKit app
COPY . .
RUN pnpm build

# ── Stage 2: install runtime dependencies for the target CPU ──────────────────
FROM node:alpine AS production-deps

WORKDIR /app

RUN npm install --global pnpm@latest
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

# ── Stage 3: runtime ──────────────────────────────────────────────────────────
FROM node:alpine

WORKDIR /app

# su-exec for privilege dropping in entrypoint
RUN apk add --no-cache su-exec

# Run as non-root for least-privilege
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Never copy native build-time dependencies across CPU architectures.
COPY --from=production-deps /app/node_modules ./node_modules
# Copy adapter-node server bundle
COPY --from=builder /app/build ./build
COPY --from=builder /app/drizzle ./drizzle
COPY package.json ./

# SQLite database lives here — mount a volume to persist data
RUN mkdir -p /app/data && chown appuser:appgroup /app/data
VOLUME /app/data

EXPOSE 3000

ENV NODE_ENV=production
ENV DATABASE_URL=/app/data/db.sqlite
# Set ORIGIN to your public URL (required by SvelteKit for CSRF protection)
# Override at runtime: docker run -e ORIGIN=https://player.example.com ...
ENV ORIGIN=http://localhost:3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "build"]
