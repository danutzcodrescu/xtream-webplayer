# Web Player

A self-hosted web player pet project. Streams live TV through a built-in HLS proxy, shows an interactive EPG (TV guide), and supports multiple users with role-based access.

This project was built with AI assistance (Claude) and serves as a learning opportunity and test ground — not intended for production use.

## Features

- **HLS proxy** — all stream traffic is routed server-side; server credentials never reach the browser
- **EPG / TV guide** — scrollable programme grid with live progress indicators and a "now" indicator
- **Search** — search channels by name or current programme title across all categories
- **Multiple playlists** — add multiple stream sources, switch between them
- **Multi-user** — admin-managed accounts with `user` and `admin` roles
- **Encrypted credentials** — server URLs and credentials are stored AES-256-GCM encrypted at rest
- **Structured logging** — pino-based logs with configurable level (`LOG_LEVEL` env var)

## Tech stack

| Layer | Technology |
|---|---|
| Framework | [SvelteKit](https://kit.svelte.dev/) 2 + Svelte 5 (runes) |
| Adapter | `@sveltejs/adapter-node` |
| Database | SQLite via Node.js `node:sqlite` + [Drizzle ORM](https://orm.drizzle.team/) |
| Auth | [Better Auth](https://better-auth.com/) |
| HLS playback | [hls.js](https://github.com/video-dev/hls.js/) |
| Styling | Tailwind CSS |
| Logging | [pino](https://getpino.io/) |

## Requirements

- Node.js 22+
- pnpm 9

## Getting started

### 1. Install dependencies

```bash
pnpm install
```

### 2. Set environment variables

Create a `.env` file in the project root:

```env
# Required — used to derive the AES-256 encryption key and sign auth tokens
BETTER_AUTH_SECRET=your-random-secret-here

# Optional overrides
DATABASE_URL=./data/xtream.db  # SQLite file path (default: ./data/xtream.db)
LOG_LEVEL=debug                # trace | debug | info | warn | error (default: debug in dev, info in prod)
```

Generate a strong secret:

```bash
openssl rand -hex 32
```

### 3. Run in development

```bash
pnpm dev
```

Open `http://localhost:5173`. The first time you visit you will be redirected to `/setup` to create the initial admin account.

### 4. Build for production

```bash
pnpm build
node build
```

## Docker

### Build and run

```bash
docker build -t webplayer .

docker run -d \
  --name webplayer \
  -p 3000:3000 \
  -v webplayer-data:/app/data \
  -e BETTER_AUTH_SECRET=your-random-secret-here \
  -e ORIGIN=https://player.example.com \
  webplayer
```

### Docker Compose

```yaml
services:
  webplayer:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - webplayer-data:/app/data
    environment:
      BETTER_AUTH_SECRET: your-random-secret-here
      ORIGIN: https://player.example.com
      # LOG_LEVEL: info
    restart: unless-stopped

volumes:
  webplayer-data:
```

> [!IMPORTANT]
> `ORIGIN` must match the public URL you use to access the app. SvelteKit uses it for CSRF protection. Example: `https://player.example.com` or `http://192.168.1.10:3000`.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | Yes | — | Secret for auth token signing and AES encryption key derivation |
| `DATABASE_URL` | No | `./data/xtream.db` | Path to the SQLite database file |
| `ORIGIN` | No | `http://localhost:3000` | Public URL of the app (required in production) |
| `LOG_LEVEL` | No | `debug` (dev) / `info` (prod) | Pino log level |
| `NODE_ENV` | No | — | Set to `production` to enable JSON logs and info-level default |

## First-time setup

1. Navigate to the app — you will be redirected to `/setup`
2. Create your admin account
3. Go to **Settings → Playlists** and add your stream server details
4. Return to the watch page, select a playlist, and pick a channel

## User management

Admins can manage users at **Settings → Users**:

- Create additional accounts
- Assign `user` or `admin` roles
- Ban / unban accounts
- Delete accounts

## Logging

In development, logs are pretty-printed to the console with colours. In production, logs are emitted as newline-delimited JSON suitable for log aggregators.

```bash
# Verbose debug output
LOG_LEVEL=debug node build

# Filter stream proxy logs in production
node build | jq 'select(.module=="stream")'
```

Log modules: `db`, `hooks`, `stream`, `channels`, `categories`, `epg`, `playlists`, `users`, `setup`.

## Project structure

```
src/
├── hooks.server.ts          # Auth guard, security headers, request logging
├── lib/
│   ├── components/
│   │   ├── TvGuide.svelte   # EPG grid with virtual scrolling
│   │   └── VideoPlayer.svelte
│   └── server/
│       ├── auth.ts          # Better Auth configuration
│       ├── cache.ts         # In-memory TTL cache (categories, channels, EPG)
│       ├── crypto.ts        # AES-256-GCM helpers + proxy token encryption
│       ├── db/              # SQLite setup, schema, Drizzle client
│       ├── epg.ts           # EPG utilities
│       ├── logger.ts        # Pino root logger
│       ├── playlist.ts      # Playlist credential helper
│       └── xtream.ts        # Stream server API client
└── routes/
    ├── api/
    │   ├── stream/          # HLS proxy (manifest rewriting + segment proxying)
    │   ├── channels/        # Live stream list
    │   ├── categories/      # Category list + ordering
    │   ├── epg/             # Short EPG fetch
    │   ├── playlists/       # Playlist CRUD
    │   └── users/           # User management (admin only)
    ├── watch/               # Main player page
    ├── settings/            # Settings page
    ├── login/               # Login page
    └── setup/               # First-run setup
```

## Security notes

- Server credentials are encrypted at rest (AES-256-GCM) — the encryption key is derived from `BETTER_AUTH_SECRET`
- The HLS proxy rewrites segment URLs into signed tokens so credentials never leave the server
- All proxied requests are validated against a host allowlist to prevent SSRF
- A strict Content Security Policy is applied to all responses

## License

MIT
