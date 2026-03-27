import type { XtreamCategory, XtreamStream, XtreamEpgEntry } from "./xtream.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "cache" });

const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface Entry<T> {
  value: T;
  at: number;
}

class TtlCache<T> {
  private map = new Map<string, Entry<T>>();

  get(key: string): T | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() - entry.at > TTL_MS) {
      this.map.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.map.set(key, { value, at: Date.now() });
  }

  /** Remove all keys that start with the given prefix. */
  invalidatePrefix(prefix: string): void {
    for (const key of this.map.keys()) {
      if (key.startsWith(prefix)) this.map.delete(key);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

// ── Per-resource caches ───────────────────────────────────────────────────────

/** Key: playlistId */
export const categoryCache = new TtlCache<XtreamCategory[]>();

/** Key: `${playlistId}:${categoryId}` — use empty string for "all categories" */
export const channelCache = new TtlCache<XtreamStream[]>();

/** Key: `${playlistId}:${streamId}` */
export const epgCache = new TtlCache<XtreamEpgEntry[]>();

/**
 * Invalidates all cached data for a playlist (categories, channels, EPG).
 * Call this whenever a playlist is updated or deleted.
 */
export function invalidatePlaylistCache(playlistId: string): void {
  const prefix = playlistId;
  const before = categoryCache.size + channelCache.size + epgCache.size;
  categoryCache.invalidatePrefix(prefix);
  channelCache.invalidatePrefix(prefix);
  epgCache.invalidatePrefix(prefix);
  const after = categoryCache.size + channelCache.size + epgCache.size;
  log.debug({ playlistId, evicted: before - after }, "playlist cache invalidated");
}
