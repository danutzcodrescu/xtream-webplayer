# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Install all deps (including dev)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Build the SvelteKit app
COPY . .
RUN pnpm build

# Remove dev dependencies from node_modules
RUN pnpm prune --prod

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

# Run as non-root for least-privilege
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy pruned node_modules (native .node files already compiled for alpine)
COPY --from=builder /app/node_modules ./node_modules
# Copy adapter-node server bundle
COPY --from=builder /app/build ./build
COPY package.json ./

# SQLite database lives here — mount a volume to persist data
RUN mkdir -p /app/data && chown appuser:appgroup /app/data
VOLUME /app/data

EXPOSE 3000

ENV NODE_ENV=production
ENV DATABASE_URL=/app/data/xtream.db
# Set ORIGIN to your public URL (required by SvelteKit for CSRF protection)
# Override at runtime: docker run -e ORIGIN=https://player.example.com ...
ENV ORIGIN=http://localhost:3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER appuser

CMD ["node", "build"]
