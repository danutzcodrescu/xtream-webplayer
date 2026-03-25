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

# Copy pruned node_modules (native .node files already compiled for alpine)
COPY --from=builder /app/node_modules ./node_modules
# Copy adapter-node server bundle
COPY --from=builder /app/build ./build
COPY package.json ./

# SQLite database lives here — mount a volume to persist data
VOLUME /app/data

EXPOSE 3000

ENV NODE_ENV=production
ENV DATABASE_URL=/app/data/iptv.db
# Set ORIGIN to your public URL (required by SvelteKit for CSRF protection)
# Override at runtime: docker run -e ORIGIN=https://iptv.example.com ...
ENV ORIGIN=http://localhost:3000

CMD ["node", "build"]
