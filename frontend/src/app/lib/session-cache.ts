/**
 * Server-side cache of each session's WhatsApp backends.
 *
 * It saves asking Odoo on every request. Entries live a few minutes, so a
 * revoked session or a user removed from a backend loses access soon after.
 *
 * For production multi-instance deployments, replace with Redis.
 */

interface SessionData {
  backendIds: number[];
  timestamp: number;
}

class SessionCache {
  private cache = new Map<string, SessionData>();
  private readonly TTL_MS = 10 * 60 * 1000; // 10 minutes
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

    const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

    this.cleanupIntervalId = setInterval(() => {
      this.cleanupExpired();
    }, CLEANUP_INTERVAL_MS);

    console.log(
      `[SessionCache] Cleanup started (interval: ${CLEANUP_INTERVAL_MS / 1000 / 60}min, TTL: ${this.TTL_MS / 1000 / 60}min)`
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
