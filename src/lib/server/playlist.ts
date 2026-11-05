import { db } from "./db/index.js";
import { XtreamApi } from "./xtream.js";
import { PlaylistData } from "./playlist-data.js";

export const playlistData = new PlaylistData(db, (credentials) => new XtreamApi(credentials));
