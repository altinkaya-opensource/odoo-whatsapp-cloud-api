/**
 * Server-side customer analytics cache
 *
 * Caches 720-day sales stats per session and commercial partner so opening a
 * chat does not re-run get_partner_summary every time. The session is part of
 * the key because invoice and sale.order record rules are user-specific.
 *
 * For production multi-instance deployments, replace with Redis.
 */

export type CustomerAnalytics = {
  available: boolean;
  periodDays?: number;
  currency?: "USD";
  totalSalesUsd?: number;
  confirmedOrderCount?: number;
  averageInvoiceValueUsd?: number;
  daysSinceLastInvoice?: number | null;
  invoicesPerMonth?: number | null;
  uniqueProductsCount?: number | null;
};

interface CachedAnalytics {
  analytics: CustomerAnalytics;
  timestamp: number;
}

export const CUSTOMER_ANALYTICS_TTL_MS = 15 * 60 * 1000;

class CustomerContextCache {
  private cache = new Map<string, CachedAnalytics>();
  private inflight = new Map<string, Promise<CustomerAnalytics>>();
  private readonly TTL_MS = CUSTOMER_ANALYTICS_TTL_MS;
  private cleanupIntervalId?: NodeJS.Timeout;

  constructor() {
    this.startCleanup();
  }

  private buildKey(sessionId: string, commercialPartnerId: number): string {
    return `${sessionId}:${commercialPartnerId}`;
  }

  get(
    sessionId: string,
    commercialPartnerId: number
  ): CustomerAnalytics | null {
    const key = this.buildKey(sessionId, commercialPartnerId);
    const data = this.cache.get(key);

    if (!data) {
      return null;
    }

    const age = Date.now() - data.timestamp;
    if (age > this.TTL_MS) {
      console.log(
        `[CustomerContextCache] Entry expired for partner ${commercialPartnerId} (age: ${Math.round(age / 1000 / 60)}min)`
      );
      this.cache.delete(key);
      return null;
    }

    console.log(
      `[CustomerContextCache] Cache HIT for partner ${commercialPartnerId}`
    );
    return data.analytics;
  }

  set(
    sessionId: string,
    commercialPartnerId: number,
    analytics: CustomerAnalytics
  ): void {
    const key = this.buildKey(sessionId, commercialPartnerId);

    this.cache.set(key, {
      analytics,
      timestamp: Date.now(),
    });

    console.log(
      `[CustomerContextCache] Cached analytics for partner ${commercialPartnerId}`
    );
  }

  async getOrLoad(
    sessionId: string,
    commercialPartnerId: number,
    loader: () => Promise<CustomerAnalytics>
  ): Promise<CustomerAnalytics> {
    const cached = this.get(sessionId, commercialPartnerId);
    if (cached) {
      return cached;
    }

    const key = this.buildKey(sessionId, commercialPartnerId);
    const pending = this.inflight.get(key);
    if (pending) {
      return pending;
    }

    const loadPromise = loader()
      .then((analytics) => {
        this.set(sessionId, commercialPartnerId, analytics);
        return analytics;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, loadPromise);
    return loadPromise;
  }

  clear(): void {
    this.cache.clear();
    this.inflight.clear();
  }

  stopCleanup(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = undefined;
    }
  }

  private startCleanup(): void {
    if (this.cleanupIntervalId) {
      return;
    }

    const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

    this.cleanupIntervalId = setInterval(() => {
      this.cleanupExpired();
    }, CLEANUP_INTERVAL_MS);
    this.cleanupIntervalId.unref?.();
  }

  private cleanupExpired(): void {
    const now = Date.now();
    let removed = 0;

    this.cache.forEach((data, key) => {
      if (now - data.timestamp > this.TTL_MS) {
        this.cache.delete(key);
        removed++;
      }
    });

    if (removed > 0) {
      console.log(
        `[CustomerContextCache] Cleanup: removed ${removed} expired entries (remaining: ${this.cache.size})`
      );
    }
  }
}

export const customerContextCache = new CustomerContextCache();
