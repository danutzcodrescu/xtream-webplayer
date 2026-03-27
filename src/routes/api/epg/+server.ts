import { json, error } from "@sveltejs/kit";
import { XtreamApi } from "$lib/server/xtream";
import { getPlaylistWithCreds } from "$lib/server/playlist";
import { logger } from "$lib/server/logger";
import type { XtreamEpgEntry } from "$lib/server/xtream";
import type { RequestHandler } from "./$types";

const log = logger.child({ module: "epg" });

/** Xtream encodes title and description as Base64. Decode them. */
function decodeListings(listings: XtreamEpgEntry[]): XtreamEpgEntry[] {
  return listings.map((e) => ({
    ...e,
    title: tryBase64Decode(e.title),
    description: tryBase64Decode(e.description),
  }));
}

function tryBase64Decode(value: string): string {
  if (!value || value.length < 4) return value;
  // Real text has spaces; valid base64 does not. Bail early on obvious non-base64.
  if (/\s/.test(value) || !/^[A-Za-z0-9+/]+=*$/.test(value)) return value;
  const decoded = Buffer.from(value, "base64").toString("utf8");
  // Reject if the decoded bytes contain non-printable control characters
  if (/[\x00-\x08\x0E-\x1F\x7F]/.test(decoded)) return value;
  return decoded;
}

export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) error(401);

  const playlistId = url.searchParams.get("playlistId");
  const streamIdStr = url.searchParams.get("streamId");

  if (!playlistId || !streamIdStr) error(400, "playlistId and streamId required");
  const streamId = parseInt(streamIdStr, 10);
  if (isNaN(streamId)) error(400, "Invalid streamId");

  const creds = await getPlaylistWithCreds(playlistId, locals.user.id);
  if (!creds) error(404);

  const api = new XtreamApi(creds);
  const limitStr = url.searchParams.get("limit");
  let limit = 5;
  if (limitStr !== null) {
    if (!/^\d+$/.test(limitStr)) error(400, "limit must be a positive integer");
    limit = Math.min(50, Math.max(1, parseInt(limitStr, 10)));
  }
  log.debug({ playlistId, streamId, limit }, "fetching epg");
  const data = await api.getShortEpg(streamId, limit);
  const listings = decodeListings(data.epg_listings ?? []);
  log.debug({ playlistId, streamId, count: listings.length }, "epg fetched");
  return json(listings);
};
