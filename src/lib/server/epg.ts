import type { XtreamEpgEntry } from "./xtream.js";

interface CacheEntry {
  /** channel EPG id → programs sorted by start_timestamp */
  programs: Map<string, XtreamEpgEntry[]>;
  fetchedAt: number;
}

// In-memory cache keyed by playlistId
const cache = new Map<string, CacheEntry>();

const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export function getEpgCache(playlistId: string): Map<string, XtreamEpgEntry[]> | null {
  const entry = cache.get(playlistId);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > TTL_MS) {
    cache.delete(playlistId);
    return null;
  }
  return entry.programs;
}

export function setEpgCache(playlistId: string, programs: Map<string, XtreamEpgEntry[]>): void {
  cache.set(playlistId, { programs, fetchedAt: Date.now() });
}

export function invalidateEpgCache(playlistId: string): void {
  cache.delete(playlistId);
}

/**
 * Given the programs map for a channel, return the program currently on air
 * and the next one.
 */
export function getNowNext(programs: XtreamEpgEntry[]): {
  now: XtreamEpgEntry | null;
  next: XtreamEpgEntry | null;
} {
  const ts = Math.floor(Date.now() / 1000);
  const now = programs.find((p) => p.start_timestamp <= ts && p.stop_timestamp > ts) ?? null;
  const idx = now ? programs.indexOf(now) : -1;
  const next = idx >= 0 ? (programs[idx + 1] ?? null) : null;
  return { now, next };
}
