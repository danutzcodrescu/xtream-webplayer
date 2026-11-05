import type { XtreamEpgEntry } from "./xtream.js";

/**
 * Given a Channel's Programmes, return the Programme currently on air
 * and the next one.
 */
export function getNowNext(programmes: XtreamEpgEntry[]): {
  now: XtreamEpgEntry | null;
  next: XtreamEpgEntry | null;
} {
  const ts = Math.floor(Date.now() / 1000);
  const now = programmes.find((p) => p.start_timestamp <= ts && p.stop_timestamp > ts) ?? null;
  const idx = now ? programmes.indexOf(now) : -1;
  const next = idx >= 0 ? (programmes[idx + 1] ?? null) : null;
  return { now, next };
}
