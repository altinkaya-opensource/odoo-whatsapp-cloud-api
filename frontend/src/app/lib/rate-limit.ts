import { NextResponse } from "next/server";

type Entry = { count: number; resetAt: number };

const WINDOW_MS = 15 * 60 * 1000;
// Forget expired keys once the map grows past this
const SWEEP_AT = 1000;

/**
 * Counts failed sign-in attempts per key in a fixed window, in this process.
 *
 * Odoo has its own lockout, but it counts by client address and every
 * attempt reaches it from this server: five wrong passwords from anywhere
 * lock every user out. These limits stop one client or one account first.
 */
export class FailureLimiter {
  private entries = new Map<string, Entry>();

  constructor(
    private readonly maxFailures: number,
    private readonly windowMs = WINDOW_MS
  ) {}

  /** Seconds until this key may try again, or 0 when it may now. */
  retryAfter(key: string): number {
    const entry = this.entries.get(key);
    if (!entry || entry.resetAt <= Date.now()) {
      return 0;
    }
    return entry.count >= this.maxFailures
      ? Math.ceil((entry.resetAt - Date.now()) / 1000)
      : 0;
  }

  fail(key: string) {
    const now = Date.now();
    if (this.entries.size > SWEEP_AT) {
      this.entries.forEach((entry, entryKey) => {
        if (entry.resetAt <= now) {
          this.entries.delete(entryKey);
        }
      });
    }
    const entry = this.entries.get(key);
    if (entry && entry.resetAt > now) {
      entry.count += 1;
    } else {
      this.entries.set(key, { count: 1, resetAt: now + this.windowMs });
    }
  }

  reset(key: string) {
    this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
  }
}

// An office shares one address: allow for everyone's typos there
export const addressFailures = new FailureLimiter(20);
export const accountFailures = new FailureLimiter(5);

/**
 * The client's address as nginx saw it. Behind the documented nginx the
 * browser cannot set X-Real-IP; port 3000 must not be reachable directly.
 */
export const clientAddress = (request: Request): string =>
  request.headers.get("x-real-ip")?.trim() || "unknown";

/** The answer to a client that must wait. */
export const tooManyAttempts = (retryAfterSeconds: number) =>
  NextResponse.json(
    { error: "too_many_attempts" },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
