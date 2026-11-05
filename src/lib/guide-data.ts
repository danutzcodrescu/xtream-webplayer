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
export interface GuideTransport {
  categories(playlistId: string, signal: AbortSignal): Promise<Category[]>;
  channels(
    playlistId: string,
    categoryId: string | undefined,
    signal: AbortSignal,
  ): Promise<Channel[]>;
  epg(playlistId: string, streamId: number, signal: AbortSignal): Promise<EpgEntry[]>;
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
  if (!response.ok) throw new Error("Guide request failed");
  return response.json();
}
const httpTransport: GuideTransport = {
  categories: (playlistId, signal) => request("categories", { playlistId }, signal),
  channels: (playlistId, categoryId, signal) =>
    request("channels", { playlistId, ...(categoryId && { categoryId }) }, signal),
  epg: (playlistId, streamId, signal) =>
    request("epg", { playlistId, streamId: String(streamId) }, signal),
};

/** Playlist-scoped request validity, retry, EPG freshness, and search coverage. */
export class GuideData {
  private state = empty();
  private store = writable(this.state);
  readonly subscribe = this.store.subscribe;
  private version = 0;
  private categoryVersion = 0;
  private requests = new AbortController();
  private categoryRequest = new AbortController();
  private epgLoads = new Map<number, { at: number; pending: boolean; failed: boolean }>();
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
    } catch {
      if (version === this.version)
        this.publish({ error: "Unable to load Categories. Please retry." });
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
    } catch {
      if (version === this.version && categoryVersion === this.categoryVersion)
        this.publish({ error: "Unable to load Channels. Please retry." });
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
    } catch {
      if (version === this.version)
        this.publish({ searchError: "Unable to search Channels. Please retry." });
    } finally {
      if (version === this.version) this.publish({ loadingSearch: false });
    }
  }

  async loadEpg(streamId: number, nowMs: number, force = false) {
    if (!this.state.playlistId) return;
    const previous = this.epgLoads.get(streamId);
    if (
      previous?.pending ||
      (!force && previous && nowMs - previous.at < (previous.failed ? 30_000 : 300_000))
    )
      return;
    const version = this.version;
    const marker = { at: nowMs, pending: true, failed: false };
    this.epgLoads.set(streamId, marker);
    const errors = { ...this.state.epgErrors };
    delete errors[streamId];
    this.publish({ epgErrors: errors });
    try {
      const entries = await this.transport.epg(
        this.state.playlistId,
        streamId,
        this.requests.signal,
      );
      if (version === this.version)
        this.publish({ epg: { ...this.state.epg, [streamId]: entries } });
    } catch {
      marker.failed = true;
      if (version === this.version)
        this.publish({ epgErrors: { ...this.state.epgErrors, [streamId]: "EPG unavailable" } });
    } finally {
      marker.pending = false;
    }
  }

  dispose() {
    this.version++;
    this.requests.abort();
    this.categoryRequest.abort();
  }
}
