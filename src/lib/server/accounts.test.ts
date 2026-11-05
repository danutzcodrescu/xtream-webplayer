import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestEvent } from "@sveltejs/kit";

const password = "fixture-only-password";
let fixtureClient = 0;
function event<Event extends RequestEvent = RequestEvent>(
  path: string,
  body?: unknown,
  cookie?: string,
  locals = {},
): Event {
  const origin = process.env.ORIGIN!;
  const url = new URL(path, origin);
  return {
    url,
    locals,
    request: new Request(url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "Sec-Fetch-Site": "same-origin",
        "X-Forwarded-For": `203.0.113.${fixtureClient}`,
        ...(cookie && { Cookie: cookie }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    }),
  } as Event;
}
async function signup(username = "first_admin") {
  const { POST } = await import("../../routes/api/auth/[...all]/+server.js");
  return POST(
    event("/api/auth/sign-up/email", {
      name: username,
      username,
      email: `${username}@iptv.local`,
      password,
    }),
  );
}
function cookieOf(response: Response) {
  return response.headers
    .getSetCookie()
    .map((header) => header.split(";", 1)[0])
    .join("; ");
}
async function administrator() {
  const response = await signup();
  expect(response.status).toBe(200);
  const cookie = cookieOf(response);
  const { user } = await response.json();
  const { POST } = await import("../../routes/api/setup/promote/+server.js");
  await POST(event("/api/setup/promote", {}, cookie, { user }));
  return { cookie, user: { ...user, role: "admin" } };
}
async function managedViewer(administratorSession: Awaited<ReturnType<typeof administrator>>) {
  const { POST } = await import("../../routes/api/users/+server.js");
  const response = await POST(
    event(
      "/api/users",
      { name: "Managed Viewer", username: "managed_viewer", password },
      administratorSession.cookie,
      { user: administratorSession.user },
    ),
  );
  expect(response.status).toBe(201);
  return (await response.json()).user;
}

beforeEach(() => {
  fixtureClient++;
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", ":memory:");
  // Better Auth disables origin checks under NODE_ENV=test; exercise production rules.
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("ORIGIN", "http://localhost:5173");
  vi.stubEnv("BETTER_AUTH_URL", undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("account HTTP interfaces", () => {
  it("allows initial setup but refuses public registration after an administrator exists", async () => {
    await administrator();
    const response = await signup("uninvited");
    expect(response.status).toBe(403);
    expect(cookieOf(response)).toBe("");
  });

  it("permits only one initial registration when requests arrive together", async () => {
    const responses = await Promise.all([signup("initial_one"), signup("initial_two")]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 403]);
  });

  it("accepts setup, username login, and sign-out at the documented production ORIGIN", async () => {
    vi.stubEnv("ORIGIN", "https://player.example.test");
    vi.stubEnv("BETTER_AUTH_URL", undefined);
    const { cookie } = await administrator();
    const { POST } = await import("../../routes/api/auth/[...all]/+server.js");
    const login = await POST(
      event("/api/auth/sign-in/username", { username: "first_admin", password }, cookie),
    );
    expect(login.status).toBe(200);
    expect(cookieOf(login)).not.toBe("");
    const untrusted = event<Parameters<typeof POST>[0]>("/api/auth/sign-out", {}, cookieOf(login));
    untrusted.request.headers.set("Origin", "https://untrusted.example.test");
    expect((await POST(untrusted)).status).toBe(403);
    const logout = await POST(event("/api/auth/sign-out", {}, cookieOf(login)));
    expect(logout.status).toBe(200);
  });

  it("lets an authenticated administrator create an account that can sign in by username", async () => {
    const administratorSession = await administrator();
    const users = await import("../../routes/api/users/+server.js");
    const created = await users.POST(
      event(
        "/api/users",
        { name: "Managed Viewer", username: "managed_viewer", password },
        administratorSession.cookie,
        { user: administratorSession.user },
      ),
    );
    expect(created.status).toBe(201);
    expect((await created.json()).user.username).toBe("managed_viewer");
    const { POST } = await import("../../routes/api/auth/[...all]/+server.js");
    const login = await POST(
      event("/api/auth/sign-in/username", { username: "managed_viewer", password }),
    );
    expect(login.status).toBe(200);
    expect((await login.json()).user.username).toBe("managed_viewer");
  });

  it("revokes existing access on ban and requires a fresh login after unbanning", async () => {
    const administratorSession = await administrator();
    const viewer = await managedViewer(administratorSession);
    const authRoutes = await import("../../routes/api/auth/[...all]/+server.js");
    const login = await authRoutes.POST(
      event("/api/auth/sign-in/username", { username: viewer.username, password }),
    );
    const cookie = cookieOf(login);
    const { handle } = await import("../../hooks.server.js");
    const protectedRequest = () =>
      handle({
        event: event("/watch", undefined, cookie),
        resolve: async () => new Response("protected"),
      } as Parameters<typeof handle>[0]);
    expect((await protectedRequest()).status).toBe(200);
    const { PUT } = await import("../../routes/api/users/[id]/+server.js");
    const mutation = (banned: boolean) => {
      const request = event<Parameters<typeof PUT>[0]>(
        `/api/users/${viewer.id}`,
        { banned },
        administratorSession.cookie,
        { user: administratorSession.user },
      );
      request.params = { id: viewer.id };
      return PUT(request);
    };
    expect((await mutation(true)).status).toBe(200);
    await expect(protectedRequest()).rejects.toMatchObject({ status: 302, location: "/login" });
    expect((await mutation(false)).status).toBe(200);
    await expect(protectedRequest()).rejects.toMatchObject({ status: 302, location: "/login" });
    expect(
      (
        await authRoutes.POST(
          event("/api/auth/sign-in/username", { username: viewer.username, password }),
        )
      ).status,
    ).toBe(200);
  });

  it("rejects an existing session whose account was already marked banned by a legacy deployment", async () => {
    const administratorSession = await administrator();
    const viewer = await managedViewer(administratorSession);
    const { POST } = await import("../../routes/api/auth/[...all]/+server.js");
    const login = await POST(
      event("/api/auth/sign-in/username", { username: viewer.username, password }),
    );
    const { db } = await import("./db/index.js");
    const { user } = await import("./db/schema.js");
    const { eq } = await import("drizzle-orm");
    await db.update(user).set({ banned: true, role: "admin" }).where(eq(user.id, viewer.id));
    const { handle } = await import("../../hooks.server.js");
    const resolve = vi.fn(async () => new Response("protected"));
    await expect(
      handle({ event: event("/watch", undefined, cookieOf(login)), resolve } as Parameters<
        typeof handle
      >[0]),
    ).rejects.toMatchObject({ status: 403 });
    expect(resolve).not.toHaveBeenCalled();
    const { GET } = await import("../../routes/api/auth/[...all]/+server.js");
    await expect(
      handle({
        event: event("/api/auth/admin/list-users", undefined, cookieOf(login)),
        resolve: (request) => GET(request as Parameters<typeof GET>[0]),
      } as Parameters<typeof handle>[0]),
    ).rejects.toMatchObject({ status: 403 });
  });
});
