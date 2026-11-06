import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderScheduler, XtreamApiError } from "./provider-scheduler.js";
import { deferred } from "../../test/fixtures.js";

afterEach(() => vi.useRealTimers());

describe("provider-wide metadata scheduling", () => {
  it("spaces requests, bounds concurrency, and prioritizes interactive work", async () => {
    vi.useFakeTimers();
    const scheduler = new ProviderScheduler({ concurrency: 1, intervalMs: 500 });
    const first = deferred<string>();
    const order: string[] = [];
    const one = scheduler.run("provider", true, () => first.promise);
    const background = scheduler.run("provider", true, async () => {
      order.push("epg");
    });
    const interactive = scheduler.run("provider", false, async () => {
      order.push("channels");
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(order).toEqual([]); // Spacing alone must not exceed concurrency.
    first.resolve("done");
    await one;
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["channels"]);
    await vi.advanceTimersByTimeAsync(499);
    expect(order).toEqual(["channels"]);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([background, interactive]);
    expect(order).toEqual(["channels", "epg"]);
  });

  it("shares cooldown across callers, rejects queued work, and backs off repeated 429s", async () => {
    vi.useFakeTimers();
    const scheduler = new ProviderScheduler({ concurrency: 1, intervalMs: 0 });
    const failed = deferred<void>();
    const first = scheduler.run("provider", true, () => failed.promise);
    const queued = scheduler.run("provider", false, async () => "not called");
    const firstCheck = expect(first).rejects.toMatchObject({ status: 429, retryAfterMs: 60_000 });
    const queuedCheck = expect(queued).rejects.toMatchObject({ status: 429, retryAfterMs: 60_000 });
    failed.reject(new XtreamApiError("get_simple_data_table", 429, 60_000));
    await Promise.all([firstCheck, queuedCheck]);
    const call = vi.fn(async () => "ok");
    await expect(scheduler.run("provider", false, call)).rejects.toMatchObject({ status: 429 });
    expect(call).not.toHaveBeenCalled();
    expect(await scheduler.run("other", false, call)).toBe("ok");
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(
      scheduler.run("provider", true, async () => {
        throw new XtreamApiError("get_simple_data_table", 429);
      }),
    ).rejects.toMatchObject({ retryAfterMs: 60_000 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await scheduler.run("provider", false, call)).toBe("ok");
  });
});
