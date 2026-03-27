import { json, error } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { playlist, categoryOrder } from "$lib/server/db/schema";
import { and, eq, asc } from "drizzle-orm";
import { XtreamApi } from "$lib/server/xtream";
import { getPlaylistWithCreds } from "$lib/server/playlist";
import { categoryCache } from "$lib/server/cache";
import { logger } from "$lib/server/logger";
import type { RequestHandler } from "./$types";

const log = logger.child({ module: "categories" });

export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) error(401);

  const playlistId = url.searchParams.get("playlistId");
  if (!playlistId) error(400, "playlistId required");

  // Raw Xtream categories are cached; DB ordering is always fresh (fast local query)
  let rawCategories = categoryCache.get(playlistId);
  if (rawCategories) {
    log.debug({ playlistId, count: rawCategories.length }, "categories cache hit");
  } else {
    const creds = await getPlaylistWithCreds(playlistId, locals.user.id);
    if (!creds) error(404);

    log.debug({ playlistId }, "fetching categories from xtream");
    const api = new XtreamApi(creds);
    rawCategories = await api.getLiveCategories();
    categoryCache.set(playlistId, rawCategories);
    log.debug({ playlistId, count: rawCategories.length }, "categories fetched and cached");
  }

  const orders = await db
    .select()
    .from(categoryOrder)
    .where(eq(categoryOrder.playlistId, playlistId))
    .orderBy(asc(categoryOrder.position));

  const orderMap = new Map(orders.map((o) => [o.categoryId, o]));

  const merged = rawCategories.map((cat) => {
    const ord = orderMap.get(cat.category_id);
    return {
      ...cat,
      position: ord?.position ?? 9999,
      hidden: ord?.hidden ?? false,
    };
  });

  merged.sort((a, b) => a.position - b.position);
  return json(merged);
};

export const PUT: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) error(401);

  const body = (await request.json()) as {
    playlistId: string;
    categories: { categoryId: string; position: number; hidden: boolean }[];
  };

  const { playlistId, categories } = body;
  if (!playlistId || !Array.isArray(categories)) error(400);

  // Verify ownership
  const [row] = await db
    .select({ id: playlist.id })
    .from(playlist)
    .where(and(eq(playlist.id, playlistId), eq(playlist.userId, locals.user.id)));
  if (!row) error(404);

  for (const cat of categories) {
    await db
      .insert(categoryOrder)
      .values({
        playlistId,
        categoryId: cat.categoryId,
        position: cat.position,
        hidden: cat.hidden,
      })
      .onConflictDoUpdate({
        target: [categoryOrder.playlistId, categoryOrder.categoryId],
        set: { position: cat.position, hidden: cat.hidden },
      });
  }

  log.info({ playlistId, count: categories.length }, "category order saved");
  return json({ ok: true });
};
