/** A sanitized provider failure: never retain the credential-bearing request URL. */
export class XtreamApiError extends Error {
  constructor(
    action: string,
    readonly status: number,
    public retryAfterMs = 0,
  ) {
    super(`Xtream API ${action} failed: ${status}`);
  }
}

export function retryAfterMs(value: string | null, now = Date.now()): number {
  if (!value) return 0;
  const ms = /^\d+$/.test(value.trim()) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(ms) ? Math.max(0, ms) : 0;
}

type Job = { background: boolean; start: () => void; reject: (cause: unknown) => void };
type ProviderState = {
  active: number;
  nextStart: number;
  blockedUntil: number;
  failures: number;
  queue: Job[];
  timer?: ReturnType<typeof setTimeout>;
};

/** Process-wide, origin-scoped metadata budget. Streaming does not use this queue. */
export class ProviderScheduler {
  private providers = new Map<string, ProviderState>();

  constructor(private options = { concurrency: 2, intervalMs: 500 }) {}

  run<T>(key: string, background: boolean, call: () => Promise<T>): Promise<T> {
    let state = this.providers.get(key);
    if (!state) {
      state = { active: 0, nextStart: 0, blockedUntil: 0, failures: 0, queue: [] };
      this.providers.set(key, state);
    }
    const provider = state;
    if (provider.blockedUntil > Date.now())
      return Promise.reject(
        new XtreamApiError("cooldown", 429, provider.blockedUntil - Date.now()),
      );

    return new Promise<T>((resolve, reject) => {
      provider.queue.push({
        background,
        reject,
        start: () => {
          provider.active++;
          provider.nextStart = Date.now() + this.options.intervalMs;
          void Promise.resolve()
            .then(call)
            .then(
              (value) => {
                if (Date.now() >= provider.blockedUntil) provider.failures = 0;
                resolve(value);
              },
              (cause) => {
                if (cause instanceof XtreamApiError && cause.status === 429) {
                  const backoff = Math.min(300_000, 30_000 * 2 ** Math.min(provider.failures++, 4));
                  provider.blockedUntil = Math.max(
                    provider.blockedUntil,
                    Date.now() + Math.max(backoff, cause.retryAfterMs),
                  );
                  cause.retryAfterMs = provider.blockedUntil - Date.now();
                  for (const job of provider.queue.splice(0))
                    job.reject(new XtreamApiError("cooldown", 429, cause.retryAfterMs));
                }
                reject(cause);
              },
            )
            .finally(() => {
              provider.active--;
              this.drain(provider);
            });
        },
      });
      this.drain(provider);
    });
  }

  private drain(state: ProviderState) {
    if (state.timer) clearTimeout(state.timer);
    state.timer = undefined;
    if (!state.queue.length || state.active >= this.options.concurrency) return;
    const delay = state.nextStart - Date.now();
    if (delay > 0) {
      state.timer = setTimeout(() => this.drain(state), delay);
      return;
    }
    const interactive = state.queue.findIndex((job) => !job.background);
    state.queue.splice(interactive < 0 ? 0 : interactive, 1)[0].start();
    this.drain(state);
  }
}

function setting(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

export const providerScheduler = new ProviderScheduler({
  concurrency: setting("XTREAM_API_CONCURRENCY", 2, 1, 10),
  intervalMs: setting("XTREAM_API_MIN_INTERVAL_MS", 500, 0, 60_000),
});
