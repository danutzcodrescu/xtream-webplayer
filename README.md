# Web Player

A self-hosted web player pet project. Streams live TV through a built-in HLS proxy, shows an interactive EPG (TV guide), and supports multiple users with role-based access.

This project was built with AI assistance and serves as a learning opportunity and test ground — not intended for production use.

## Features

- **HLS proxy** — all stream traffic is routed server-side; server credentials never reach the browser
- **EPG / TV guide** — scrollable programme grid with live progress indicators and a "now" indicator
- **Search** — search Channel names across all Categories, plus currently airing Programme titles in already-loaded EPG (coverage is labelled in the search view)
- **Multiple playlists** — add multiple stream sources, switch between them
- **Multi-user** — admin-managed accounts with `user` and `admin` roles
- **Encrypted credentials** — server URLs and credentials are stored AES-256-GCM encrypted at rest
- **Structured logging** — pino-based logs with configurable level (`LOG_LEVEL` env var)

## Tech stack

| Layer        | Technology                                                                  |
| ------------ | --------------------------------------------------------------------------- |
| Framework    | [SvelteKit](https://kit.svelte.dev/) 3 + Svelte 5 (runes)                   |
| Adapter      | `@sveltejs/adapter-node`                                                    |
| Database     | SQLite via Node.js `node:sqlite` + [Drizzle ORM](https://orm.drizzle.team/) |
| Auth         | [Better Auth](https://better-auth.com/)                                     |
| HLS playback | [hls.js](https://github.com/video-dev/hls.js/)                              |
| Styling      | Tailwind CSS                                                                |
| Logging      | [pino](https://getpino.io/)                                                 |

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
DATABASE_URL=./data/db.sqlite  # SQLite file path (default: ./data/db.sqlite)
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

| Variable             | Required | Default                                                   | Description                                                                             |
| -------------------- | -------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET` | Yes      | —                                                         | Secret for auth token signing and AES encryption key derivation                         |
| `DATABASE_URL`       | No       | `./data/db.sqlite`                                        | Path to the SQLite database file                                                        |
| `ORIGIN`             | No       | `http://localhost:3000`                                   | Public URL used for SvelteKit and authentication origin checks (required in production) |
| `BETTER_AUTH_URL`    | No       | `ORIGIN`, or `http://localhost:5173` in local development | Optional explicit authentication URL override                                           |
| `LOG_LEVEL`          | No       | `debug` (dev) / `info` (prod)                             | Pino log level                                                                          |
| `NODE_ENV`           | No       | —                                                         | Set to `production` to enable JSON logs and info-level default                          |

## First-time setup

1. Navigate to the app — you will be redirected to `/setup`
2. Create your admin account
3. Go to **Settings → Playlists** and add your stream server details
4. Return to the watch page, select a playlist, and pick a channel

Public registration is available only while the database has no users. Once the first account exists, only administrators can create further accounts. Initial signup requests are serialized within the app process so simultaneous setup requests cannot create multiple initial accounts.

## User management

Admins can manage users at **Settings → Users**:

- Create additional accounts
- Assign `user` or `admin` roles
- Ban / unban accounts
- Delete accounts

Banning an account revokes its existing sessions. Unbanning permits a fresh login; it does not restore old sessions. The request guard also rejects pre-existing sessions belonging to accounts marked banned by older versions, including access through the authentication module's administrative endpoints.

## Database migrations

`src/lib/server/db/schema.ts` is the schema source. After changing it, run `pnpm db:generate` and commit the generated SQL and metadata in `drizzle/`. Do not hand-edit an already-applied migration.

Startup applies pending migrations automatically in a transaction; no separate deployment migration command is required. Existing installations without a migration journal are adopted once using the generated initial schema, preserving their records and adding missing legacy columns. Plaintext legacy server URLs are encrypted during the same transaction; migration failures stop startup instead of being silently ignored. Back up the database before schema upgrades.

Run `node build` from the project root so the `drizzle/` directory is available. The Docker image includes this directory.

## Logging

In development, logs are pretty-printed to the console with colours. In production, logs are emitted as newline-delimited JSON suitable for log aggregators.

```bash
# Verbose debug output
LOG_LEVEL=debug node build

# Filter stream proxy logs in production
node build | jq 'select(.module=="stream")'
```

Log modules: `db`, `hooks`, `stream`, `xtream`, `playlists`, `users`, `setup`. Cached provider data and Playlist mutations are logged by `playlists`.

## Tests

```bash
pnpm test          # deterministic Vitest suite; isolated in-memory SQLite
pnpm test:watch    # watch mode
pnpm lint
pnpm exec playwright install chromium  # one-time browser setup
pnpm test:browser                     # guide scrolling + CDN settings
# After pnpm build, run the same smoke test against the production server:
PLAYWRIGHT_TEST_PRODUCTION=1 pnpm test:browser
```

Tests exercise owned Playlist data, the HLS proxy request interface, and Playlist-scoped guide state. Provider responses are fixtures; no real provider credentials or existing database are used.

Account regressions exercise real authentication/user handlers and the request guard, including closed registration, production origins, administrator-created username logins, and session revocation. Startup tests cover fresh and legacy databases and repeated migrations. Channel reads return only the browser-facing fields, excluding provider stream URLs and unknown transport metadata.

The browser check starts its own app and provider fixture, upgrades an isolated legacy Playlist table, and checks search selection, row scrolling, and CDN host editing. Its database and artifacts live in the OS temp directory. To use an existing Chromium installation instead of downloading one, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable.

## CDN host settings

Streaming requests may use the Playlist server's hostname and any **Allowed CDN hosts** explicitly configured in **Settings → Playlists**. Enter exact hostnames separated by commas, without schemes, ports, paths, or wildcards. Every redirect and manifest URI is checked before fetching; adding a CDN does not give it the provider's cookies. Hostnames cover all HTTP/HTTPS ports for providers that change ports during playback.

Existing Playlists start with no additional CDN hosts. Providers that redirect to another hostname require that hostname to be added before playback works. Changing these settings takes effect on subsequent token requests. Restart playback after upgrading: older proxy tokens do not include Playlist identity and are intentionally rejected.

Categories and Channels are cached for six hours; EPG for five minutes. Ownership is checked before every cached read. Failed requests are not cached as empty EPG. The guide ignores obsolete Playlist/Category responses, retains loaded EPG across Category changes, and offers retries after loading failures.

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
│       ├── playlist-data.ts # Owned Playlist reads, cache lifetime, mutations
│       ├── crypto.ts        # AES-256-GCM encryption primitives
│       ├── db/              # SQLite setup, schema, Drizzle client
│       ├── epg.ts           # EPG utilities
│       ├── logger.ts        # Pino root logger
│       ├── playlist.ts      # Production Playlist module configuration
│       ├── stream-proxy.ts  # Redirects, cookies, manifest rewriting, tokens
│       ├── stream-policy.ts # Exact CDN host validation and stream URL policy
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
- Streaming requests, including every redirect, are restricted to the Playlist host and explicitly allowed CDN hosts
- Proxy tokens are encrypted and bound to a user and Playlist; ownership and current host settings are checked again on every request
- A strict Content Security Policy is applied to all responses

## License

MIT
