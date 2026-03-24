import { json, error } from "@sveltejs/kit";
import { XtreamApi } from "$lib/server/xtream";
import { getPlaylistWithCreds } from "$lib/server/playlist";
import type { XtreamEpgEntry } from "$lib/server/xtream";
import type { RequestHandler } from "./$types";

/** Xtream encodes title and description as Base64. Decode them. */
function decodeListings(listings: XtreamEpgEntry[]): XtreamEpgEntry[] {
  return listings.map((e) => ({
    ...e,
    title: tryBase64Decode(e.title),
    description: tryBase64Decode(e.description),
  }));
}

function tryBase64Decode(value: string): string {
  if (!value) return value;
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    // Only use the decoded value if it looks like human-readable text
    // (base64 strings are typically alphanumeric+/+= with no spaces)
    return /^[A-Za-z0-9+/]+=*$/.test(value) ? decoded : value;
  } catch {
    return value;
  }
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
  const limit = limitStr ? Math.min(50, Math.max(1, parseInt(limitStr, 10) || 5)) : 5;
  const data = await api.getShortEpg(streamId, limit);
  return json(decodeListings(data.epg_listings ?? []));
};
