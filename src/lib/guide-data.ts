import { writable } from "svelte/store";

export interface Category {
  category_id: string;
  category_name: string;
  hidden: boolean;
}
export interface Channel {
  stream_id: number;
  name: string;
  stream_icon: string;
  category_id: string;
  epg_channel_id: string;
  tv_archive?: number;
  tv_archive_duration?: number;
}
export interface EpgEntry {
  id: string;
  title: string;
  description: string;
  start_timestamp: number;
  stop_timestamp: number;
  has_archive?: number;
}
export interface CatchupProgramme {
  start_timestamp: number;
  stop_timestamp: number;
  title: string;
}
export interface EpgResponse {
  entries: EpgEntry[];
  stale: boolean;
  retryAfterMs: number;
  expiresAt?: number;
  cooldown?: boolean;
}
export class GuideRequestError extends Error {
  constructor(
    readonly retryAfterMs: number,
    readonly sharedCooldown = true,
  ) {
    super("Guide request failed");
  }
}
export interface GuideTransport {
  categories(playlistId: string, signal: AbortSignal): Promise<Category[]>;
  channels(
    playlistId: string,
    categoryId: string | undefined,
    signal: AbortSignal,
  ): Promise<Channel[]>;
  epg(playlistId: string, streamId: number, signal: AbortSignal): Promise<EpgEntry[] | EpgResponse>;
}
interface SearchResult {
  channel: Channel;
  matchedProgramme: string | null;
}
interface GuideState {
  playlistId: string;
  activeCatId: string;
  categories: Category[];
  channels: Channel[];
  allChannels: Channel[];
  epg: Record<number, EpgEntry[]>;
  epgErrors: Record<number, string>;
  epgStale: Record<number, boolean>;
  providerRetryAt: number;
  loadingCategories: boolean;
  loadingChannels: boolean;
  loadingSearch: boolean;
  error: string;
  searchError: string;
  searchResults: SearchResult[];
}
const empty = (playlistId = ""): GuideState => ({
  playlistId,
  activeCatId: "",
  categories: [],
  channels: [],
  allChannels: [],
  epg: {},
  epgErrors: {},
  epgStale: {},
  providerRetryAt: 0,
  loadingCategories: false,
  loadingChannels: false,
  loadingSearch: false,
  error: "",
  searchError: "",
  searchResults: [],
});

async function request<T>(
  path: string,
  params: Record<string, string>,
  signal: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/${path}?${new URLSearchParams(params)}`, { signal });
  if (!response.ok)
    throw new GuideRequestError(
      responseDelay(response),
      response.headers.get("X-Provider-Cooldown") === "true",
    );
  return response.json();
}
function responseDelay(response: Response) {
  const header = response.headers.get("Retry-After");
  if (!header) return 0;
  const delay = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(delay) ? Math.max(0, delay) : 0;
}
const httpTransport: GuideTransport = {
  categories: (playlistId, signal) => request("categories", { playlistId }, signal),
  channels: (playlistId, categoryId, signal) =>
    request("channels", { playlistId, ...(categoryId && { categoryId }) }, signal),
  epg: async (playlistId, streamId, signal) => {
    const response = await fetch(
      `/api/epg?${new URLSearchParams({ playlistId, streamId: String(streamId) })}`,
      { signal },
    );
    if (!response.ok)
      throw new GuideRequestError(
        responseDelay(response),
        response.headers.get("X-Provider-Cooldown") === "true",
      );
    const expiresAt = Number(response.headers.get("X-EPG-Expires-At"));
    return {
      entries: await response.json(),
      stale: response.headers.get("X-EPG-Stale") === "true",
      retryAfterMs: responseDelay(response),
      expiresAt: expiresAt > 0 ? expiresAt : undefined,
      cooldown: response.headers.get("X-Provider-Cooldown") === "true",
    };
  },
};

type EpgLoad = {
  at: number;
  pending: boolean;
  failed: boolean;
  nextAt: number;
  expiresAt?: number;
  retryDelayMs?: number;
};
type EpgJob = { streamId: number; visible: boolean; run: () => Promise<void>; cancel: () => void };

/** Playlist-scoped request validity, retry, EPG freshness, and search coverage. */
export class GuideData {
  private state = empty();
  private store = writable(this.state);
  readonly subscribe = this.store.subscribe;
  private version = 0;
  private categoryVersion = 0;
  private requests = new AbortController();
  private categoryRequest = new AbortController();
  private epgLoads = new Map<number, EpgLoad>();
  private epgQueue: EpgJob[] = [];
  private activeEpg = 0;
  private visibleChannels = new Set<number>();
  private recoveryTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private allLoaded = false;
  private query = "";
  private time = Date.now();

  constructor(private transport: GuideTransport = httpTransport) {}

  private publish(change: Partial<GuideState>) {
    this.state = { ...this.state, ...change };
    const words = this.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (text: string) => words.every((word) => text.toLowerCase().includes(word));
    const results: SearchResult[] = [];
    if (words.length)
      for (const channel of this.state.allChannels) {
        if (matches(channel.name)) results.push({ channel, matchedProgramme: null });
        else {
          const current = this.state.epg[channel.stream_id]?.find(
            (programme) =>
              programme.start_timestamp * 1000 <= this.time &&
              programme.stop_timestamp * 1000 > this.time &&
              matches(programme.title),
          );
          if (current) results.push({ channel, matchedProgramme: current.title });
        }
      }
    this.state.searchResults = results;
    this.store.set(this.state);
  }

  async setPlaylist(playlistId: string) {
    if (playlistId === this.state.playlistId) return;
    const version = ++this.version;
    this.requests.abort();
    this.categoryRequest.abort();
    this.requests = new AbortController();
    this.clearQueuedEpg();
    this.visibleChannels.clear();
    clearTimeout(this.recoveryTimer);
    this.epgLoads.clear();
    this.allLoaded = false;
    this.query = "";
    this.state = empty(playlistId);
    this.publish({ loadingCategories: !!playlistId });
    if (!playlistId) return;
    await this.loadCategories(version);
  }

  private async loadCategories(version: number) {
    try {
      const categories = await this.transport.categories(
        this.state.playlistId,
        this.requests.signal,
      );
      if (version !== this.version) return;
      const visible = categories.filter((category) => !category.hidden);
      this.publish({ categories: visible, error: "" });
      if (visible.length) await this.selectCategory(visible[0].category_id);
    } catch (cause) {
      if (version === this.version) {
        this.backoff(cause);
        this.publish({ error: "Unable to load Categories. Please retry." });
      }
    } finally {
      if (version === this.version) this.publish({ loadingCategories: false });
    }
  }

  async retry() {
    this.publish({ error: "" });
    if (!this.state.categories.length) {
      this.publish({ loadingCategories: true });
      await this.loadCategories(this.version);
    } else await this.selectCategory(this.state.activeCatId);
  }

  async selectCategory(categoryId: string): Promise<boolean> {
    const version = this.version;
    const categoryVersion = ++this.categoryVersion;
    this.categoryRequest.abort();
    this.categoryRequest = new AbortController();
    this.setVisibleChannels([], Date.now());
    this.publish({ activeCatId: categoryId, channels: [], loadingChannels: true, error: "" });
    try {
      const channels = await this.transport.channels(
        this.state.playlistId,
        categoryId,
        this.categoryRequest.signal,
      );
      if (version !== this.version || categoryVersion !== this.categoryVersion) return false;
      this.publish({ channels });
      return true;
    } catch (cause) {
      if (version === this.version && categoryVersion === this.categoryVersion) {
        this.backoff(cause);
        this.publish({ error: "Unable to load Channels. Please retry." });
      }
      return false;
    } finally {
      if (version === this.version && categoryVersion === this.categoryVersion)
        this.publish({ loadingChannels: false });
    }
  }

  setSearch(query: string, nowMs: number) {
    this.query = query;
    this.time = nowMs;
    this.publish({});
    if (query.trim()) void this.ensureAllChannels();
  }

  async ensureAllChannels() {
    if (!this.state.playlistId || this.allLoaded || this.state.loadingSearch) return;
    const version = this.version;
    this.publish({ loadingSearch: true, searchError: "" });
    try {
      const channels = await this.transport.channels(
        this.state.playlistId,
        undefined,
        this.requests.signal,
      );
      if (version !== this.version) return;
      this.allLoaded = true;
      this.publish({ allChannels: channels });
    } catch (cause) {
      if (version === this.version) {
        this.backoff(cause);
        this.publish({ searchError: "Unable to search Channels. Please retry." });
      }
    } finally {
      if (version === this.version) this.publish({ loadingSearch: false });
    }
  }

  setVisibleChannels(streamIds: number[], nowMs: number) {
    this.visibleChannels = new Set(streamIds);
    const retained: EpgJob[] = [];
    for (const job of this.epgQueue) {
      if (job.visible && !this.visibleChannels.has(job.streamId)) job.cancel();
      else retained.push(job);
    }
    this.epgQueue = retained;
    for (const streamId of streamIds) void this.enqueueEpg(streamId, nowMs, false, true);
    this.scheduleRecovery();
  }

  async loadEpg(streamId: number, nowMs: number, force = false) {
    return this.enqueueEpg(streamId, nowMs, force, false);
  }

  private async enqueueEpg(streamId: number, nowMs: number, force: boolean, visible: boolean) {
    if (!this.state.playlistId || this.disposed || this.state.providerRetryAt > Date.now()) return;
    const previous = this.epgLoads.get(streamId);
    if (
      previous?.pending ||
      (!force &&
        previous &&
        nowMs - previous.at < (previous.failed ? (previous.retryDelayMs ?? 30_000) : 300_000))
    )
      return;
    const version = this.version;
    const marker: EpgLoad = {
      at: nowMs,
      pending: true,
      failed: false,
      nextAt: 0,
      expiresAt: previous?.expiresAt,
    };
    this.epgLoads.set(streamId, marker);
    return new Promise<void>((resolve) => {
      const job: EpgJob = {
        streamId,
        visible,
        cancel: () => {
          if (this.epgLoads.get(streamId) === marker) {
            if (previous) this.epgLoads.set(streamId, previous);
            else this.epgLoads.delete(streamId);
          }
          resolve();
        },
        run: async () => {
          await this.fetchEpg(streamId, marker, version);
          resolve();
        },
      };
      if (visible) this.epgQueue.push(job);
      else this.epgQueue.unshift(job);
      this.drainEpg();
    });
  }

  private async fetchEpg(streamId: number, marker: EpgLoad, version: number) {
    let retryDelay = 30_000;
    const errors = { ...this.state.epgErrors };
    delete errors[streamId];
    this.publish({ epgErrors: errors });
    try {
      const result = await this.transport.epg(
        this.state.playlistId,
        streamId,
        this.requests.signal,
      );
      if (version === this.version) {
        const response = Array.isArray(result)
          ? { entries: result, stale: false, retryAfterMs: 0 }
          : result;
        marker.failed = response.stale;
        retryDelay = Math.max(retryDelay, response.retryAfterMs);
        marker.expiresAt = response.expiresAt ?? Date.now() + 6 * 60 * 60 * 1000;
        if (response.cooldown && response.retryAfterMs)
          this.backoff(new GuideRequestError(response.retryAfterMs));
        this.publish({
          epg: { ...this.state.epg, [streamId]: response.entries },
          epgStale: { ...this.state.epgStale, [streamId]: response.stale },
        });
      }
    } catch (cause) {
      marker.failed = true;
      if (cause instanceof GuideRequestError) retryDelay = Math.max(retryDelay, cause.retryAfterMs);
      if (version === this.version) {
        this.backoff(cause);
        const epg = { ...this.state.epg };
        if (!marker.expiresAt || marker.expiresAt <= Date.now()) delete epg[streamId];
        this.publish({
          epg,
          epgStale: { ...this.state.epgStale, [streamId]: !!epg[streamId] },
          epgErrors: { ...this.state.epgErrors, [streamId]: "EPG unavailable" },
        });
      }
    } finally {
      marker.pending = false;
      marker.retryDelayMs = retryDelay;
      marker.nextAt = Date.now() + (marker.failed ? retryDelay : 300_000);
    }
  }

  private drainEpg() {
    if (this.disposed || this.state.providerRetryAt > Date.now()) return;
    while (this.activeEpg < 2 && this.epgQueue.length) {
      const job = this.epgQueue.shift()!;
      this.activeEpg++;
      void job.run().finally(() => {
        this.activeEpg--;
        this.drainEpg();
        this.scheduleRecovery();
      });
    }
  }

  private clearQueuedEpg() {
    for (const job of this.epgQueue.splice(0)) job.cancel();
  }

  private backoff(cause: unknown) {
    if (!(cause instanceof GuideRequestError) || !cause.sharedCooldown || !cause.retryAfterMs)
      return;
    this.publish({
      providerRetryAt: Math.max(this.state.providerRetryAt, Date.now() + cause.retryAfterMs),
    });
    this.scheduleRecovery();
  }

  private scheduleRecovery() {
    clearTimeout(this.recoveryTimer);
    if (this.disposed) return;
    const due = [...this.visibleChannels]
      .map((id) => this.epgLoads.get(id))
      .filter((load) => load && !load.pending)
      .map((load) => load!.nextAt);
    for (const [id, load] of this.epgLoads)
      if (this.state.epg[id] && load.expiresAt) due.push(load.expiresAt);
    if (this.state.providerRetryAt) due.push(this.state.providerRetryAt);
    if (!due.length) return;
    const nextAttempt = Math.max(this.state.providerRetryAt, Math.min(...due));
    const expirations = [...this.epgLoads.values()].flatMap((load) =>
      load.expiresAt ? [load.expiresAt] : [],
    );
    const next = Math.min(nextAttempt, ...expirations);
    this.recoveryTimer = setTimeout(
      () => {
        const epg = { ...this.state.epg };
        for (const [id, load] of this.epgLoads) {
          if (load.expiresAt && load.expiresAt <= Date.now()) {
            delete epg[id];
            load.expiresAt = undefined;
          }
        }
        this.publish({
          epg,
          providerRetryAt: this.state.providerRetryAt > Date.now() ? this.state.providerRetryAt : 0,
        });
        if (this.state.error) void this.retry();
        if (this.state.searchError && this.query.trim()) void this.ensureAllChannels();
        for (const id of this.visibleChannels) {
          const marker = this.epgLoads.get(id);
          if (!marker || marker.nextAt <= Date.now())
            void this.enqueueEpg(id, Date.now(), true, true);
        }
        this.drainEpg();
        this.scheduleRecovery();
      },
      Math.min(2_147_483_647, Math.max(1, next - Date.now())),
    );
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.recoveryTimer);
    this.clearQueuedEpg();
    this.version++;
    this.requests.abort();
    this.categoryRequest.abort();
  }
}
