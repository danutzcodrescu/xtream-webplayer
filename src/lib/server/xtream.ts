export interface XtreamCredentials {
  serverUrl: string;
  username: string;
  password: string;
}

export interface XtreamCategory {
  category_id: string;
  category_name: string;
  parent_id: number;
}

export interface XtreamStream {
  num: number;
  name: string;
  stream_type: string;
  stream_id: number;
  stream_icon: string;
  epg_channel_id: string;
  added: string;
  category_id: string;
  direct_source: string;
}

export interface XtreamEpgEntry {
  id: string;
  epg_id: string;
  title: string;
  lang: string;
  start: string;
  end: string;
  description: string;
  channel_id: string;
  start_timestamp: number;
  stop_timestamp: number;
}

export interface XtreamUserInfo {
  username: string;
  password: string;
  auth: number;
  status: string;
  exp_date: string | null;
  is_trial: string;
  active_cons: string;
  max_connections: string;
  allowed_output_formats: string[];
}

export interface XtreamServerInfo {
  url: string;
  port: string;
  https_port: string;
  server_protocol: string;
  timezone: string;
  timestamp_now: number;
  time_now: string;
}

export interface XtreamAuthResponse {
  user_info: XtreamUserInfo;
  server_info: XtreamServerInfo;
}

const TIMEOUT_MS = 30_000;

export class XtreamApi {
  private base: string;

  constructor(private creds: XtreamCredentials) {
    this.base = creds.serverUrl.replace(/\/$/, "");
  }

  private async call<T>(action: string, params: Record<string, string> = {}): Promise<T> {
    const qs = new URLSearchParams({
      username: this.creds.username,
      password: this.creds.password,
      action,
      ...params,
    });
    const res = await fetch(`${this.base}/player_api.php?${qs}`, {
      headers: { "User-Agent": "IPTV-WebPlayer/1.0" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Xtream API ${action} failed: ${res.status}`);
    return res.json() as Promise<T>;
  }

  async authenticate(): Promise<XtreamAuthResponse> {
    const qs = new URLSearchParams({
      username: this.creds.username,
      password: this.creds.password,
    });
    const res = await fetch(`${this.base}/player_api.php?${qs}`, {
      headers: { "User-Agent": "IPTV-WebPlayer/1.0" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Xtream auth failed: ${res.status}`);
    return res.json() as Promise<XtreamAuthResponse>;
  }

  getLiveCategories(): Promise<XtreamCategory[]> {
    return this.call<XtreamCategory[]>("get_live_categories");
  }

  getLiveStreams(categoryId?: string): Promise<XtreamStream[]> {
    return this.call<XtreamStream[]>(
      "get_live_streams",
      categoryId ? { category_id: categoryId } : {},
    );
  }

  getShortEpg(streamId: number, limit = 5): Promise<{ epg_listings: XtreamEpgEntry[] }> {
    return this.call("get_short_epg", {
      stream_id: String(streamId),
      limit: String(limit),
    });
  }

  /** Live HLS stream URL */
  liveStreamUrl(streamId: number): string {
    return `${this.base}/live/${this.creds.username}/${this.creds.password}/${streamId}.m3u8`;
  }

  xmltvUrl(): string {
    return `${this.base}/xmltv.php?username=${this.creds.username}&password=${this.creds.password}`;
  }
}
