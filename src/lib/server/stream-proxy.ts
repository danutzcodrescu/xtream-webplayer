import { error } from "@sveltejs/kit";
import { encrypt, decrypt } from "./crypto.js";
import { XtreamApi } from "./xtream.js";
import type { PlaylistCredentials } from "./playlist-data.js";
import { streamTarget } from "./stream-policy.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "stream" });
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const TIMEOUT_MS = 20_000;

/** All upstream transitions, cookies, token binding, and HLS rewriting live here. */
export class StreamProxy {
  private cookies = new Map<string, Map<string, string>>();

  constructor(
    private credentials: (userId: string, playlistId: string) => Promise<PlaylistCredentials>,
    private fetch: typeof globalThis.fetch = globalThis.fetch,
  ) {}

  async respond(requestUrl: URL, userId: string): Promise<Response> {
    const params = requestUrl.searchParams;
    let playlistId: string;
    let target: string;
    if (params.has("token")) {
      let payload: unknown;
      try {
        payload = JSON.parse(decrypt(params.get("token")!));
      } catch {
        error(400, "Invalid or tampered token");
      }
      if (
        !payload ||
        typeof payload !== "object" ||
        !("url" in payload) ||
        typeof payload.url !== "string" ||
        !("userId" in payload) ||
        typeof payload.userId !== "string" ||
        !("playlistId" in payload) ||
        typeof payload.playlistId !== "string"
      )
        error(400, "Invalid proxy token");
      if (payload.userId !== userId) error(403, "Token user mismatch");
      playlistId = payload.playlistId;
      target = payload.url;
    } else {
      playlistId = params.get("playlistId") ?? "";
      const streamId = positiveInteger(params.get("streamId"), "streamId");
      if (!playlistId) error(400, "playlistId required");
      const credentials = await this.credentials(userId, playlistId);
      log.info(
        { userId, playlistId, streamId, catchup: params.has("start") },
        "stream session started",
      );
      const provider = new XtreamApi(credentials);
      if (params.has("start") || params.has("duration")) {
        const start = positiveInteger(params.get("start"), "start");
        const duration = positiveInteger(params.get("duration"), "duration");
        const date = new Date(start * 1000);
        if (isNaN(date.getTime())) error(400, "Invalid start");
        target = provider.catchupStreamUrl(streamId, date, duration);
      } else target = provider.liveStreamUrl(streamId);
      return this.proxy(target, userId, credentials);
    }

    // Re-read ownership even for existing tokens.
    return this.proxy(target, userId, await this.credentials(userId, playlistId));
  }

  private cookieKey(userId: string, playlistId: string, host: string) {
    return JSON.stringify([userId, playlistId, host]);
  }

  private saveCookies(key: string, response: Response) {
    const headers = response.headers.getSetCookie();
    if (!headers.length) return;
    const jar = this.cookies.get(key) ?? new Map<string, string>();
    for (const header of headers) {
      const pair = header.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator > 0) jar.set(pair.slice(0, separator).trim(), pair.slice(separator + 1));
    }
    if (this.cookies.size >= 512 && !this.cookies.has(key))
      this.cookies.delete(this.cookies.keys().next().value!);
    this.cookies.set(key, jar);
  }

  private async upstream(target: string, userId: string, credentials: PlaylistCredentials) {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    for (let hop = 0; hop <= 5; hop++) {
      const url = streamTarget(target);
      const key = this.cookieKey(userId, credentials.id, url.hostname);
      const cookies = [...(this.cookies.get(key) ?? [])]
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
      let response: Response;
      try {
        response = await this.fetch(url.href, {
          redirect: "manual",
          signal,
          headers: {
            "User-Agent": "VLC/3.0.20 LibVLC/3.0.20",
            Referer: `${url.origin}/`,
            Origin: url.origin,
            ...(cookies && { Cookie: cookies }),
          },
        });
      } catch {
        log.warn({ host: url.hostname }, "upstream network error");
        error(502, "Stream server unavailable or timed out");
      }
      this.saveCookies(key, response);
      if (REDIRECTS.has(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) error(502, "Stream redirect has no location");
        try {
          target = new URL(location, url).href;
        } catch {
          error(502, "Invalid stream redirect");
        }
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        error(502, `Stream server returned ${response.status}`);
      }
      return { response, url };
    }
    error(502, "Too many stream redirects");
  }

  private async proxy(target: string, userId: string, credentials: PlaylistCredentials) {
    const { response, url } = await this.upstream(target, userId, credentials);
    const contentType = response.headers.get("content-type") ?? "";
    const manifest =
      /mpegurl/i.test(contentType) ||
      (!/^(video|audio)\//i.test(contentType) && /\.m3u8?$/i.test(url.pathname));
    if (!manifest)
      return new Response(response.body, {
        headers: { "Content-Type": contentType || "video/MP2T", "Cache-Control": "no-cache" },
      });

    let content: string;
    try {
      content = await response.text();
    } catch {
      error(502, "Unable to read stream manifest");
    }
    const proxyUri = (uri: string) => {
      let resolved: URL;
      try {
        resolved = new URL(uri, url);
      } catch {
        error(502, "Invalid manifest URI");
      }
      streamTarget(resolved.href);
      const token = encrypt(
        JSON.stringify({ url: resolved.href, userId, playlistId: credentials.id }),
      );
      return `/api/stream?token=${encodeURIComponent(token)}`;
    };
    const rewritten = content
      .split("\n")
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (!trimmed.startsWith("#")) return proxyUri(trimmed);
        // HLS keys, maps, alternate renditions, and I-frame manifests use URI attributes.
        return line.replace(/\bURI="([^"]*)"/g, (_match, uri: string) => `URI="${proxyUri(uri)}"`);
      })
      .join("\n");
    return new Response(rewritten, {
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-cache",
      },
    });
  }
}

function positiveInteger(value: string | null, name: string): number {
  if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0)
    error(400, `Invalid ${name}`);
  return Number(value);
}
