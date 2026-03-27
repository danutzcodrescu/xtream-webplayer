import type { XtreamEpgEntry } from "./xtream.js";

/**
 * Given the programs list for a channel, return the program currently on air
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
