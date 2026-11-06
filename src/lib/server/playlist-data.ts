import { error } from "@sveltejs/kit";
import { and, asc, eq, sql } from "drizzle-orm";
import type { db as database } from "./db/index.js";
import { categoryOrder, playlist, type Playlist } from "./db/schema.js";
import type { XtreamApi, XtreamCredentials, XtreamEpgEntry } from "./xtream.js";
import { logger } from "./logger.js";
import { encrypt, decrypt } from "./crypto.js";
import type { Channel } from "../guide-data.js";
import { XtreamApiError } from "./provider-scheduler.js";

export type PlaylistCredentials = XtreamCredentials & { id: string };

type Provider = Pick<
  XtreamApi,
  "authenticate" | "getLiveCategories" | "getLiveStreams" | "getSimpleDataTable" | "getShortEpg"
>;
const TTL_MS = 6 * 60 * 60 * 1000;
const log = logger.child({ module: "playlists" });
type CachedResult<T> = {
  value: T;
  stale: boolean;
  retryAfterMs?: number;
  expiresAt?: number;
  cooldown?: boolean;
};
type CacheEntry = {
  at: number;
  value: Promise<CachedResult<unknown>>;
  retryAt?: number;
  cooldown?: boolean;
};

/** Owns Playlist access, provider data lifetime, and mutation-driven invalidation. */
export class PlaylistData {
  private caches = new Map<string, Map<string, CacheEntry>>();

  constructor(
    private db: typeof database,
    private provider: (credentials: XtreamCredentials) => Provider,
    private now: () => number = () => Date.now(),
  ) {}

  private async owned(userId: string, id: string): Promise<Playlist> {
    const [row] = await this.db
      .select()
      .from(playlist)
      .where(and(eq(playlist.id, id), eq(playlist.userId, userId)));
    if (!row) error(404, "Playlist not found");
    return row;
  }

  private safe(row: Playlist) {
    return {
      id: row.id,
      name: row.name,
      serverUrl: decrypt(row.serverUrl),
      createdAt: row.createdAt,
    };
  }

  private credentialsFor(row: Playlist): PlaylistCredentials {
    return {
      id: row.id,
      serverUrl: decrypt(row.serverUrl),
      username: decrypt(row.xtreamUsername),
      password: decrypt(row.xtreamPassword),
    };
  }

  async credentials(userId: string, id: string) {
    return this.credentialsFor(await this.owned(userId, id));
  }

  private async cached<T>(row: Playlist, key: string, load: () => Promise<T>): Promise<T> {
    return (await this.cachedResult(row, key, load)).value;
  }

  private async cachedResult<T>(
    row: Playlist,
    key: string,
    load: () => Promise<T>,
    staleMs = 0,
  ): Promise<CachedResult<T>> {
    let bucket = this.caches.get(row.id);
    if (!bucket) this.caches.set(row.id, (bucket = new Map()));
    const previous = bucket.get(key);
    if (previous?.retryAt && previous.retryAt > this.now() && this.now() - previous.at < staleMs)
      return {
        ...((await previous.value) as CachedResult<T>),
        stale: true,
        retryAfterMs: previous.retryAt - this.now(),
        cooldown: previous.cooldown,
      };
    if (previous && this.now() - previous.at < (key.startsWith("epg:") ? 300_000 : TTL_MS)) {
      log.debug({ playlistId: row.id, resource: key }, "Playlist data cache hit");
      return previous.value as Promise<CachedResult<T>>;
    }
    log.debug({ playlistId: row.id, resource: key }, "loading Playlist data");
    const entry: CacheEntry = {
      at: this.now(),
      value: Promise.resolve()
        .then(load)
        .then((value) => ({
          value,
          stale: false,
          ...(staleMs && { expiresAt: entry.at + staleMs }),
        }))
        .catch(async (cause) => {
          if (bucket.get(key) === entry) bucket.delete(key);
          if (previous && this.now() - previous.at < staleMs) {
            const result = (await previous.value) as CachedResult<T>;
            const retryAfterMs = Math.max(
              30_000,
              cause instanceof XtreamApiError ? cause.retryAfterMs : 0,
            );
            previous.retryAt = this.now() + retryAfterMs;
            previous.cooldown = cause instanceof XtreamApiError && cause.status === 429;
            // A mutation may have detached this bucket; never restore into the new one.
            if (!bucket.has(key)) bucket.set(key, previous);
            return { ...result, stale: true, retryAfterMs, cooldown: previous.cooldown };
          }
          throw cause;
        }),
    };
    bucket.set(key, entry);
    return entry.value as Promise<CachedResult<T>>;
  }

  async list(userId: string) {
    return (await this.db.select().from(playlist).where(eq(playlist.userId, userId))).map((row) =>
      this.safe(row),
    );
  }

  async get(userId: string, id: string) {
    return this.safe(await this.owned(userId, id));
  }

  async create(userId: string, body: Record<string, unknown>) {
    if (!body || typeof body !== "object" || Array.isArray(body))
      error(400, "Invalid Playlist details");
    const { name, serverUrl, xtreamUsername, xtreamPassword } = body;
    if (
      ![name, serverUrl, xtreamUsername, xtreamPassword].every(
        (v) => typeof v === "string" && v.trim(),
      )
    ) {
      error(400, "Name, server URL, and credentials are required");
    }
    const server = this.serverUrl(serverUrl);
    const credentials = {
      serverUrl: server,
      username: String(xtreamUsername),
      password: String(xtreamPassword),
    };
    const info = await this.provider(credentials)
      .authenticate()
      .catch(() => null);
    if (info?.user_info?.auth !== 1) error(400, "Invalid Xtream credentials or server unreachable");
    const [row] = await this.db
      .insert(playlist)
      .values({
        userId,
        name: String(name),
        serverUrl: encrypt(server),
        xtreamUsername: encrypt(credentials.username),
        xtreamPassword: encrypt(credentials.password),
      })
      .returning();
    log.info({ userId, playlistId: row.id }, "Playlist created");
    return this.safe(row);
  }

  private serverUrl(value: unknown): string {
    if (typeof value !== "string") error(400, "Invalid server URL");
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      error(400, "Invalid server URL");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      error(
        400,
        "Use an HTTP or HTTPS server URL without embedded credentials, query, or fragment",
      );
    }
    return url.toString().replace(/\/$/, "");
  }

  async update(userId: string, id: string, body: Record<string, unknown>) {
    await this.owned(userId, id);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !["name", "serverUrl", "xtreamUsername", "xtreamPassword"].some(
        (field) => body[field] !== undefined,
      )
    ) {
      error(400, "No Playlist changes provided");
    }
    for (const field of ["name", "serverUrl", "xtreamUsername", "xtreamPassword"]) {
      if (body[field] !== undefined && (typeof body[field] !== "string" || !body[field].trim())) {
        error(400, `Invalid ${field}`);
      }
    }
    const [row] = await this.db
      .update(playlist)
      .set({
        ...(typeof body.name === "string" && { name: body.name }),
        ...(body.serverUrl !== undefined && {
          serverUrl: encrypt(this.serverUrl(body.serverUrl)),
        }),
        ...(typeof body.xtreamUsername === "string" && {
          xtreamUsername: encrypt(body.xtreamUsername),
        }),
        ...(typeof body.xtreamPassword === "string" && {
          xtreamPassword: encrypt(body.xtreamPassword),
        }),
      })
      .where(and(eq(playlist.id, id), eq(playlist.userId, userId)))
      .returning();
    if (!row) error(404, "Playlist not found");
    this.caches.delete(id); // In-flight work retains only its detached old bucket.
    log.info({ userId, playlistId: id }, "Playlist updated; cached data invalidated");
    return this.safe(row);
  }

  async delete(userId: string, id: string) {
    await this.owned(userId, id);
    await this.db.delete(playlist).where(and(eq(playlist.id, id), eq(playlist.userId, userId)));
    this.caches.delete(id);
    log.info({ userId, playlistId: id }, "Playlist deleted; cached data invalidated");
  }

  async categories(userId: string, id: string) {
    const row = await this.owned(userId, id); // Authorization precedes every cache lookup.
    const categories = await this.cached(row, "categories", () =>
      this.provider(this.credentialsFor(row)).getLiveCategories(),
    );
    const orders = await this.db
      .select()
      .from(categoryOrder)
      .where(eq(categoryOrder.playlistId, id))
      .orderBy(asc(categoryOrder.position));
    const orderMap = new Map(orders.map((order) => [order.categoryId, order]));
    return categories
      .map((category) => ({
        ...category,
        position: orderMap.get(category.category_id)?.position ?? 9999,
        hidden: orderMap.get(category.category_id)?.hidden ?? false,
      }))
      .sort((a, b) => a.position - b.position);
  }

  async saveCategoryOrder(userId: string, id: string, categories: unknown) {
    await this.owned(userId, id);
    if (
      !Array.isArray(categories) ||
      categories.some(
        (c) =>
          !c ||
          typeof c.categoryId !== "string" ||
          !Number.isSafeInteger(c.position) ||
          c.position < 0 ||
          typeof c.hidden !== "boolean",
      )
    )
      error(400, "Invalid category order");
    // A single statement keeps the complete ordering change atomic.
    if (categories.length)
      await this.db
        .insert(categoryOrder)
        .values(
          categories.map((c) => ({
            playlistId: id,
            categoryId: c.categoryId,
            position: c.position,
            hidden: c.hidden,
          })),
        )
        .onConflictDoUpdate({
          target: [categoryOrder.playlistId, categoryOrder.categoryId],
          set: { position: sqlExcluded("position"), hidden: sqlExcluded("hidden") },
        });
    log.info({ userId, playlistId: id, count: categories.length }, "Category order saved");
  }

  async channels(userId: string, id: string, categoryId?: string) {
    const row = await this.owned(userId, id);
    return this.cached(row, JSON.stringify(["channels", categoryId ?? ""]), async () => {
      const streams = await this.provider(this.credentialsFor(row)).getLiveStreams(categoryId);
      return streams.map((stream): Channel => ({
        stream_id: stream.stream_id,
        name: stream.name,
        stream_icon: stream.stream_icon,
        category_id: stream.category_id,
        epg_channel_id: stream.epg_channel_id,
        tv_archive: stream.tv_archive,
        tv_archive_duration: stream.tv_archive_duration,
      }));
    });
  }

  async epg(userId: string, id: string, streamId: number) {
    return (await this.epgWithStatus(userId, id, streamId)).value;
  }

  async epgWithStatus(userId: string, id: string, streamId: number) {
    const row = await this.owned(userId, id);
    return this.cachedResult(
      row,
      `epg:${streamId}`,
      async () => {
        const provider = this.provider(this.credentialsFor(row));
        let listings: XtreamEpgEntry[] = [];
        try {
          listings = (await provider.getSimpleDataTable(streamId)).epg_listings ?? [];
        } catch (cause) {
          // Unsupported full-guide endpoints can fall back; overload/auth/network errors cannot.
          if (!(cause instanceof XtreamApiError) || ![400, 404, 405, 501].includes(cause.status))
            throw cause;
          /* Try short EPG. */
        }
        if (!listings.length)
          listings = (await provider.getShortEpg(streamId, 20)).epg_listings ?? [];
        return listings.map((entry) => ({
          ...entry,
          title: decodeText(entry.title),
          description: decodeText(entry.description),
        }));
      },
      TTL_MS,
    );
  }
}

function sqlExcluded(column: "position" | "hidden") {
  return sql.raw(`excluded.${column}`);
}

function decodeText(value: string): string {
  if (!value || value.length < 4 || /\s/.test(value) || !/^[A-Za-z0-9+/]+=*$/.test(value))
    return value;
  const decoded = Buffer.from(value, "base64").toString("utf8");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000E-\u001F\u007F\uFFFD]/.test(decoded)) return value;
  return decoded;
}
