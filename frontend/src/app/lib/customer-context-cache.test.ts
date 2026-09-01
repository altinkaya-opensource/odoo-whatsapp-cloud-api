import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CUSTOMER_ANALYTICS_TTL_MS,
  customerContextCache,
} from "./customer-context-cache";

const analytics = { available: false };
const sessionId = "s".repeat(40);

beforeEach(() => {
  vi.useFakeTimers();
  customerContextCache.stopCleanup();
  customerContextCache.clear();
});

afterEach(() => {
  customerContextCache.clear();
  customerContextCache.stopCleanup();
  vi.useRealTimers();
});

describe("customerContextCache", () => {
  it("returns cached analytics within the TTL", () => {
    customerContextCache.set(sessionId, 10, analytics);

    expect(customerContextCache.get(sessionId, 10)).toEqual(analytics);
  });

  it("does not share analytics across sessions", () => {
    customerContextCache.set(sessionId, 10, analytics);

    expect(customerContextCache.get("other-session", 10)).toBeNull();
  });

  it("expires entries after the TTL", () => {
    customerContextCache.set(sessionId, 10, analytics);
    vi.advanceTimersByTime(CUSTOMER_ANALYTICS_TTL_MS + 1);

    expect(customerContextCache.get(sessionId, 10)).toBeNull();
  });

  it("coalesces concurrent loads for the same partner", async () => {
    const loader = vi.fn(async () => analytics);

    const [first, second] = await Promise.all([
      customerContextCache.getOrLoad(sessionId, 10, loader),
      customerContextCache.getOrLoad(sessionId, 10, loader),
    ]);

    expect(first).toEqual(analytics);
    expect(second).toEqual(analytics);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed load", async () => {
    await expect(
      customerContextCache.getOrLoad(sessionId, 10, async () => {
        throw new Error("Odoo down");
      })
    ).rejects.toThrow("Odoo down");

    expect(customerContextCache.get(sessionId, 10)).toBeNull();
  });
});
