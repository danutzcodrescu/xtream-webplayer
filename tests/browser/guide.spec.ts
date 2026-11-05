import { createServer } from "node:http";
import { test, expect } from "@playwright/test";

test("setup and login work; guide search scrolls; CDN settings validate and persist", async ({
  page,
}) => {
  const channels = ["news", "sport"].flatMap((category, cat) =>
    Array.from({ length: 40 }, (_, index) => ({
      stream_id: cat * 100 + index + 1,
      name: cat === 1 && index === 30 ? "Target Sport" : `${category} ${index + 1}`,
      category_id: category,
      stream_icon: "",
      epg_channel_id: `${category}-${index}`,
    })),
  );
  const provider = createServer((request, response) => {
    const url = new URL(request.url!, "http://fixture.test");
    response.setHeader("Content-Type", "application/json");
    switch (url.searchParams.get("action")) {
      case "get_live_categories":
        response.end(
          JSON.stringify([
            { category_id: "news", category_name: "News", parent_id: 0 },
            { category_id: "sport", category_name: "Sport", parent_id: 0 },
          ]),
        );
        break;
      case "get_live_streams":
        response.end(
          JSON.stringify(
            channels.filter(
              (c) =>
                !url.searchParams.has("category_id") ||
                c.category_id === url.searchParams.get("category_id"),
            ),
          ),
        );
        break;
      case "get_simple_data_table": {
        const now = Math.floor(Date.now() / 1000);
        response.end(
          JSON.stringify({
            epg_listings: [
              {
                id: "current",
                title: Buffer.from("Current Bulletin").toString("base64"),
                description: "",
                start_timestamp: now - 600,
                stop_timestamp: now + 1800,
              },
            ],
          }),
        );
        break;
      }
      default:
        if (url.pathname.startsWith("/live/")) response.writeHead(404);
        response.end(JSON.stringify({ user_info: { auth: 1 } }));
    }
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  const pageErrors: string[] = [];
  let playlistId: string | undefined;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    const setup = await page.request.get("/setup", { maxRedirects: 0 });
    if (setup.status() === 200) {
      // On a cold dev server, wait for client modules before submitting the SSR form.
      await page.goto("/setup", { waitUntil: "networkidle" });
      await page.getByLabel("Display Name", { exact: true }).fill("Browser Test");
      await page.getByLabel("Username", { exact: true }).fill("browser_fixture");
      await page.getByLabel("Password", { exact: true }).fill("test-only-password");
      await page.getByLabel("Confirm Password", { exact: true }).fill("test-only-password");
      await page.getByRole("button", { name: "Create Admin Account", exact: true }).click();
      await expect(page).toHaveURL(/\/watch$/);
      const signedOut = await page.request.post("/api/auth/sign-out", {
        headers: { Origin: "http://127.0.0.1:5182" },
        data: {},
      });
      expect(signedOut.ok()).toBe(true);
    }
    await page.goto("/login", { waitUntil: "networkidle" });
    await page.getByLabel("Username", { exact: true }).fill("browser_fixture");
    await page.getByLabel("Password", { exact: true }).fill("test-only-password");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page).toHaveURL(/\/watch$/);
    const created = await page.request.post("/api/playlists", {
      data: {
        name: "Fixture Playlist",
        serverUrl: `http://127.0.0.1:${address.port}`,
        xtreamUsername: "fixture",
        xtreamPassword: "fixture",
      },
    });
    expect(created.status()).toBe(201);
    playlistId = (await created.json()).id;
    await page.goto("/watch");
    await expect(page.getByRole("button", { name: "News", exact: true })).toBeVisible();
    await page.getByPlaceholder("Search channels…").fill("Target Sport");
    await expect(
      page.getByText(
        "Searches all Channel names and currently airing Programmes in already-loaded EPG.",
      ),
    ).toBeVisible();
    await page.getByRole("button").filter({ hasText: "Target Sport" }).click();
    await expect(page.getByPlaceholder("Search channels…")).toHaveValue("");
    await expect(page.getByTitle("Target Sport", { exact: true })).toBeVisible();
    const guide = page.getByRole("region", { name: "TV guide", exact: true });
    await expect.poll(() => guide.evaluate((el) => el.scrollTop)).toBeGreaterThan(1000);
    const selected = await page.getByTitle("Target Sport", { exact: true }).boundingBox();
    const viewport = await guide.boundingBox();
    expect(
      selected && viewport && selected.y >= viewport.y && selected.y < viewport.y + viewport.height,
    ).toBeTruthy();

    await page.goto("/settings");
    await page.getByLabel("Allowed CDN hosts", { exact: true }).fill("*.invalid.test");
    await expect(page.getByLabel("Allowed CDN hosts", { exact: true })).toHaveValue(
      "*.invalid.test",
    );
    await page.getByRole("button", { name: "Save hosts", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("exact CDN hostnames");
    await page.getByLabel("Allowed CDN hosts", { exact: true }).fill("cdn.fixture.test");
    await page.getByRole("button", { name: "Save hosts", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save hosts", exact: true })).toBeEnabled();
    await page.reload();
    await expect(page.getByLabel("Allowed CDN hosts", { exact: true })).toHaveValue(
      "cdn.fixture.test",
    );
    expect(pageErrors).toEqual([]);
  } finally {
    try {
      if (playlistId) await page.request.delete(`/api/playlists/${playlistId}`);
    } finally {
      await new Promise<void>((resolve, reject) =>
        provider.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }
});
