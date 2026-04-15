import { afterEach, describe, expect, it, vi } from "vitest";

import { dedupeMessages, isPastOrToday } from "../../web/modules/common.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("dedupeMessages", () => {
  it("removes duplicates while preserving the first occurrence order", () => {
    expect(dedupeMessages(["alpha", "beta", "alpha", "gamma", "beta"])).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("returns an empty list for non-arrays", () => {
    expect(dedupeMessages(null)).toEqual([]);
  });
});

describe("isPastOrToday", () => {
  it("accepts today and past dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-14T12:00:00Z"));

    expect(isPastOrToday("2026-04-14")).toBe(true);
    expect(isPastOrToday("1990-06-15")).toBe(true);
  });

  it("rejects future or invalid dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-14T12:00:00Z"));

    expect(isPastOrToday("2026-04-15")).toBe(false);
    expect(isPastOrToday("not-a-date")).toBe(false);
  });
});
