import { error } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { playlist } from "$lib/server/db/schema";
import { eq } from "drizzle-orm";
import { XtreamApi } from "$lib/server/xtream";
import { getPlaylistWithCreds } from "$lib/server/playlist";
import type { RequestHandler } from "./$types";

// ── Per-user session cookie jar ───────────────────────────────────────────────
// Key: `${userId}:${hostname}`  Value: Cookie header string
// Keyed on hostname (not full origin) so that cookies set on port 8080
// are also sent when fetching segments on port 80.
const cookieJar = new Map<string, string>();

// ── Per-user trusted hostnames ────────────────────────────────────────────────
// Hostnames seen inside manifests we've already proxied for a user.
// This handles Xtream servers that redirect manifests to CDN/proxy hostnames
// different from the registered playlist server URL.
// Key: userId  Value: Set of trusted hostnames
const trustedHostnames = new Map<string, Set<string>>();

function addTrustedHostname(userId: string, hostname: string) {
  let set = trustedHostnames.get(userId);
  if (!set) {
    set = new Set();
    trustedHostnames.set(userId, set);
  }
  set.add(hostname);
}

function isTrustedHostname(userId: string, hostname: string): boolean {
  return trustedHostnames.get(userId)?.has(hostname) ?? false;
}

function jarKey(userId: string, hostname: string) {
  return `${userId}:${hostname}`;
}

function loadCookies(userId: string, hostname: string): string {
  return cookieJar.get(jarKey(userId, hostname)) ?? "";
}

/** Merge Set-Cookie values from a response into the jar. */
function saveCookies(userId: string, hostname: string, response: Response): void {
  // getSetCookie() returns each header separately (Node 18+)
  const setCookies: string[] =
    (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ??
    (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")!] : []);

  if (setCookies.length === 0) return;

  // Take only name=value, discard attributes (Path, Expires…)
  const pairs = setCookies.map((c) => c.split(";")[0].trim());

  const existing = cookieJar.get(jarKey(userId, hostname));
  if (existing) {
    // Merge: overwrite existing keys, add new ones
    const map = new Map(existing.split("; ").map((p) => p.split("=") as [string, string]));
    for (const pair of pairs) {
      const eqIdx = pair.indexOf("=");
      if (eqIdx > 0) map.set(pair.slice(0, eqIdx), pair.slice(eqIdx + 1));
    }
    cookieJar.set(
      jarKey(userId, hostname),
      [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
    );
  } else {
    cookieJar.set(jarKey(userId, hostname), pairs.join("; "));
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) error(401);
  const userId = locals.user.id;

  const playlistId = url.searchParams.get("playlistId");
  const streamIdStr = url.searchParams.get("streamId");

  // ── Case 1: initial stream request ───────────────────────────────────────
  if (playlistId && streamIdStr) {
    const streamId = parseInt(streamIdStr, 10);
    if (isNaN(streamId)) error(400, "Invalid streamId");

    const creds = await getPlaylistWithCreds(playlistId, userId);
    if (!creds) error(404);

    const api = new XtreamApi(creds);
    return proxyManifest(api.liveStreamUrl(streamId), url.origin, userId);
  }

  // ── Case 2: proxied manifest/segment request ──────────────────────────────
  // url.searchParams.get() already URL-decodes — do NOT call decodeURIComponent again.
  const targetUrl = url.searchParams.get("url");
  if (!targetUrl) error(400, "url parameter required");

  // Security: only proxy to hostnames registered in this user's playlists.
  // We match hostname only (not port) because Xtream servers often serve the
  // initial manifest on a custom port but return segment URLs on port 80/443.
  const userPlaylists = await db
    .select({ serverUrl: playlist.serverUrl })
    .from(playlist)
    .where(eq(playlist.userId, userId));

  let targetHostname: string;
  try {
    targetHostname = new URL(targetUrl).hostname;
  } catch {
    error(400, "Invalid url parameter");
  }

  const allowedByPlaylist = userPlaylists.some((p) => {
    try {
      return new URL(p.serverUrl).hostname === targetHostname;
    } catch {
      return false;
    }
  });
  if (!allowedByPlaylist && !isTrustedHostname(userId, targetHostname)) {
    console.error(
      "[stream] blocked proxy to",
      targetHostname,
      "— not in user playlists or manifests",
    );
    error(403, "Target server not in your playlists");
  }

  return proxyUrl(targetUrl, url.origin, userId);
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const UA = "VLC/3.0.20 LibVLC/3.0.20";

async function fetchUpstream(targetUrl: string, userId: string): Promise<Response> {
  let hostname: string;
  let origin: string;
  try {
    const u = new URL(targetUrl);
    hostname = u.hostname;
    origin = u.origin;
  } catch {
    hostname = "";
    origin = "";
  }

  const cookies = loadCookies(userId, hostname);
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Referer: origin + "/",
    Origin: origin,
  };
  if (cookies) headers["Cookie"] = cookies;

  let res: Response;
  try {
    res = await fetch(targetUrl, {
      headers,
      signal: AbortSignal.timeout(20_000),
      redirect: "follow",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[stream] network error for", targetUrl, "-", msg);
    error(502, `Network error: ${msg}`);
  }

  // Always persist any new cookies the server sends back
  if (hostname) saveCookies(userId, hostname, res);

  if (!res.ok) {
    const preview = await res.text().catch(() => "");
    console.error(
      "[stream] upstream returned",
      res.status,
      "for",
      targetUrl,
      "-",
      preview.slice(0, 120),
    );
    error(502, `Stream server returned ${res.status}`);
  }

  return res;
}

async function proxyManifest(streamUrl: string, proxyOrigin: string, userId: string) {
  const res = await fetchUpstream(streamUrl, userId);
  const ct = res.headers.get("content-type") ?? "";
  // Use the final URL after any redirects as the base for resolving relative paths
  const finalUrl = res.url || streamUrl;

  if (isHlsManifest(ct, finalUrl)) {
    const text = await res.text();
    return new Response(rewriteManifest(text, finalUrl, proxyOrigin, userId), {
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Raw MPEG-TS — pass through directly
  return new Response(res.body, {
    headers: { "Content-Type": ct || "video/MP2T", "Access-Control-Allow-Origin": "*" },
  });
}

async function proxyUrl(targetUrl: string, proxyOrigin: string, userId: string) {
  const res = await fetchUpstream(targetUrl, userId);
  const ct = res.headers.get("content-type") ?? "";
  const finalUrl = res.url || targetUrl;

  if (isHlsManifest(ct, finalUrl)) {
    const text = await res.text();
    return new Response(rewriteManifest(text, finalUrl, proxyOrigin, userId), {
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  return new Response(res.body, {
    headers: {
      "Content-Type": ct || "video/MP2T",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function isHlsManifest(contentType: string, urlStr: string): boolean {
  if (contentType.includes("mpegurl") || contentType.includes("x-mpegURL")) return true;
  try {
    const path = new URL(urlStr).pathname;
    return path.endsWith(".m3u8") || path.endsWith(".m3u");
  } catch {
    return false;
  }
}

function rewriteManifest(
  content: string,
  manifestUrl: string,
  proxyOrigin: string,
  userId: string,
): string {
  const base = manifestUrl.substring(0, manifestUrl.lastIndexOf("/") + 1);

  return content
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return line;

      let absolute: string;
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        absolute = trimmed;
      } else if (trimmed.startsWith("/")) {
        try {
          const u = new URL(manifestUrl);
          absolute = `${u.protocol}//${u.host}${trimmed}`;
        } catch {
          return line;
        }
      } else {
        absolute = base + trimmed;
      }

      // Trust any hostname we encounter inside a manifest we've already proxied
      try {
        addTrustedHostname(userId, new URL(absolute).hostname);
      } catch {
        /* ignore */
      }

      return `${proxyOrigin}/api/stream?url=${encodeURIComponent(absolute)}`;
    })
    .join("\n");
}
