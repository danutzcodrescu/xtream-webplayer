import { error } from "@sveltejs/kit";
import { XtreamApi } from "$lib/server/xtream";
import { getPlaylistWithCreds } from "$lib/server/playlist";
import { encryptProxyToken, decryptProxyToken } from "$lib/server/crypto";
import type { RequestHandler } from "./$types";

// ── Per-user session cookie jar ───────────────────────────────────────────────
// Key: `${userId}:${hostname}`  Value: Cookie header string
// Keyed on hostname (not full origin) so that cookies set on port 8080
// are also sent when fetching segments on port 80.
const cookieJar = new Map<string, string>();

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

const UPSTREAM_TIMEOUT_MS = 20_000;

/** Returns true for hostnames that resolve to private/internal addresses. */
function isPrivateHost(hostname: string): boolean {
  return (
    /^localhost$/i.test(hostname) ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^169\.254\./.test(hostname) || // link-local / cloud metadata (AWS, GCP, Azure)
    /^::1$/.test(hostname) ||
    /^fd[0-9a-f]{2}:/i.test(hostname) // IPv6 ULA
  );
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

    const allowedHost = new URL(creds.serverUrl).hostname;
    const api = new XtreamApi(creds);
    return proxyManifest(api.liveStreamUrl(streamId), url.origin, userId, allowedHost);
  }

  // ── Case 2: token-based proxied manifest/segment request ─────────────────
  // The token was produced by rewriteManifest() and contains an AES-GCM-encrypted
  // payload of { url, userId, allowedHost }. The upstream URL (which contains Xtream
  // credentials) is never sent to the browser in plaintext.
  const token = url.searchParams.get("token");
  if (!token) error(400, "token parameter required");

  let targetUrl: string;
  let allowedHost: string;
  try {
    const payload = decryptProxyToken(token);
    if (payload.userId !== userId) error(403, "Token user mismatch");
    targetUrl = payload.url;
    allowedHost = payload.allowedHost;
  } catch (e) {
    // Re-throw SvelteKit HTTP errors (e.g. the 403 above); only catch crypto failures.
    if (e != null && typeof e === "object" && "status" in e) throw e;
    error(400, "Invalid or tampered token");
  }

  // SSRF guard: reject if the target host doesn't match the original server host.
  let targetHost: string;
  try {
    targetHost = new URL(targetUrl).hostname;
  } catch {
    error(400, "Invalid target URL in token");
  }
  if (targetHost !== allowedHost) {
    error(403, "Target host not permitted");
  }

  return proxyUrl(targetUrl, url.origin, userId, allowedHost);
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
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
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

async function proxyManifest(streamUrl: string, proxyOrigin: string, userId: string, allowedHost: string) {
  const res = await fetchUpstream(streamUrl, userId);
  const ct = res.headers.get("content-type") ?? "";
  // Use the final URL after any redirects as the base for resolving relative paths
  const finalUrl = res.url || streamUrl;
  // If the manifest redirected to a different host (e.g. CDN), use that host as
  // allowedHost so the segment tokens it generates will pass the SSRF guard.
  const finalHost = (() => { try { return new URL(finalUrl).hostname; } catch { return allowedHost; } })();

  if (isHlsManifest(ct, finalUrl)) {
    const text = await res.text();
    return new Response(rewriteManifest(text, finalUrl, proxyOrigin, userId, finalHost), {
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-cache",
      },
    });
  }

  // Raw MPEG-TS — pass through directly
  return new Response(res.body, {
    headers: { "Content-Type": ct || "video/MP2T" },
  });
}

async function proxyUrl(targetUrl: string, proxyOrigin: string, userId: string, allowedHost: string) {
  const res = await fetchUpstream(targetUrl, userId);
  const ct = res.headers.get("content-type") ?? "";
  const finalUrl = res.url || targetUrl;
  const finalHost = (() => { try { return new URL(finalUrl).hostname; } catch { return allowedHost; } })();

  if (isHlsManifest(ct, finalUrl)) {
    const text = await res.text();
    return new Response(rewriteManifest(text, finalUrl, proxyOrigin, userId, finalHost), {
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-cache",
      },
    });
  }

  return new Response(res.body, {
    headers: {
      "Content-Type": ct || "video/MP2T",
      "Cache-Control": "no-cache",
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
  allowedHost: string,
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

      const token = encryptProxyToken(absolute, userId, allowedHost);
      return `${proxyOrigin}/api/stream?token=${encodeURIComponent(token)}`;
    })
    .join("\n");
}
