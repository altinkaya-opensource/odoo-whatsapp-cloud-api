/**
 * Server-side session cache for storing user backend access
 *
 * This cache stores backend_ids per session to prevent:
 * 1. Unnecessary RPC calls on every SSE connection
 * 2. Client-side manipulation of backend access (security)
 *
 * For production multi-instance deployments, replace with Redis.
 */

interface SessionData {
  backendIds: number[];
  timestamp: number;
}

class SessionCache {
  private cache = new Map<string, SessionData>();
  private readonly TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
  private cleanupIntervalId?: NodeJS.Timeout;

  constructor() {
    // Start cleanup interval (every 30 minutes)
    this.startCleanup();
  }

  /**
   * Store backend IDs for a session
   */
  set(sessionId: string, backendIds: number[]): void {
    const timestamp = Date.now();
    this.cache.set(sessionId, {
      backendIds,
      timestamp,
    });

    console.log(
      `[SessionCache] Stored a session with backends: [${backendIds.join(", ")}]`
    );
  }

  /**
   * Get backend IDs for a session
   * Returns null if session not found or expired
   */
  get(sessionId: string): number[] | null {
    const data = this.cache.get(sessionId);

    if (!data) {
      return null;
    }

    // Check if expired
    const age = Date.now() - data.timestamp;
    if (age > this.TTL_MS) {
      console.log(
        `[SessionCache] Session expired (age: ${Math.round(age / 1000 / 60)}min)`
      );
      this.cache.delete(sessionId);
      return null;
    }

    return data.backendIds;
  }

  /**
   * Remove a session from cache
   */
  delete(sessionId: string): void {
    if (this.cache.delete(sessionId)) {
      console.log("[SessionCache] Deleted a session");
    }
  }

  /**
   * Update the timestamp of a session without changing its data
   * This is useful for keeping sessions alive during SSE heartbeats
   */
  touch(sessionId: string): boolean {
    const data = this.cache.get(sessionId);

    if (!data) {
      return false;
    }

    data.timestamp = Date.now();
    return true;
  }

  /**
   * Check if session exists and is valid
   */
  has(sessionId: string): boolean {
    return this.get(sessionId) !== null;
  }

  /**
   * Get cache statistics
   */
  getStats(): { total: number; expired: number } {
    const now = Date.now();
    let expired = 0;

    this.cache.forEach((data) => {
      if (now - data.timestamp > this.TTL_MS) {
        expired++;
      }
    });

    return {
      total: this.cache.size,
      expired,
    };
  }

  /**
   * Start periodic cleanup of expired sessions
   */
  private startCleanup(): void {
    if (this.cleanupIntervalId) {
      return;
    }

    const CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

    this.cleanupIntervalId = setInterval(() => {
      this.cleanupExpired();
    }, CLEANUP_INTERVAL_MS);

    console.log(
      `[SessionCache] Cleanup started (interval: ${CLEANUP_INTERVAL_MS / 1000 / 60}min, TTL: ${this.TTL_MS / 1000 / 60 / 60}h)`
    );
  }

  /**
   * Remove all expired sessions
   */
  private cleanupExpired(): void {
    const now = Date.now();
    let removed = 0;

    this.cache.forEach((data, sessionId) => {
      if (now - data.timestamp > this.TTL_MS) {
        this.cache.delete(sessionId);
        removed++;
      }
    });

    if (removed > 0) {
      console.log(
        `[SessionCache] Cleanup: removed ${removed} expired sessions (remaining: ${this.cache.size})`
      );
    }
  }

  /**
   * Stop cleanup interval (for testing)
   */
  stopCleanup(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = undefined;
    }
  }

  /**
   * Clear all sessions (for testing)
   */
  clear(): void {
    this.cache.clear();
    console.log("[SessionCache] Cache cleared");
  }
}

// Singleton instance
export const sessionCache = new SessionCache();
