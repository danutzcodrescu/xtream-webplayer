import { db } from "./db/index.js";
import { playlist } from "./db/schema.js";
import { and, eq } from "drizzle-orm";
import { decrypt } from "./crypto.js";
import type { XtreamCredentials } from "./xtream.js";

export interface PlaylistWithCreds extends XtreamCredentials {
  id: string;
  name: string;
}

/**
 * Fetches a playlist row and decrypts its Xtream credentials.
 * Returns null if the playlist doesn't exist or doesn't belong to the user.
 */
export async function getPlaylistWithCreds(
  playlistId: string,
  userId: string,
): Promise<PlaylistWithCreds | null> {
  const [row] = await db
    .select()
    .from(playlist)
    .where(and(eq(playlist.id, playlistId), eq(playlist.userId, userId)));

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    serverUrl: row.serverUrl,
    username: decrypt(row.xtreamUsername),
    password: decrypt(row.xtreamPassword),
  };
}
