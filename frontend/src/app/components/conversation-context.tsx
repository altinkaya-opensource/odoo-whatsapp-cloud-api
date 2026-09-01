"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowSquareOut,
  BuildingsIcon,
  ChatCircleDotsIcon,
  ChartLineUpIcon,
  ClockIcon,
  CurrencyDollarIcon,
  PackageIcon,
  PhoneIcon,
  ReceiptIcon,
  ShoppingBagIcon,
} from "@phosphor-icons/react";
import { useAuth } from "@/app/hooks/use-auth";
import { useCurrentChat } from "@/app/hooks/use-current-chat";
import { useTranslations } from "@/app/context/translation-provider";
import Profile from "./profile";

type ContextRowProps = {
  icon: ReactNode;
  label: string;
  value: string;
};

type CustomerAnalytics = {
  available: true;
  periodDays: number;
  currency: "USD";
  totalSalesUsd: number;
  confirmedOrderCount: number;
  averageInvoiceValueUsd: number;
  daysSinceLastInvoice: number | null;
  invoicesPerMonth: number | null;
  uniqueProductsCount: number | null;
};

type AnalyticsStatus =
  "idle" | "loading" | "available" | "unavailable" | "error";

type CachedClientAnalytics = {
  analytics: CustomerAnalytics | null;
  status: "available" | "unavailable";
  timestamp: number;
};

const CLIENT_ANALYTICS_TTL_MS = 15 * 60 * 1000;
const clientAnalyticsCache = new Map<string, CachedClientAnalytics>();

const getClientCachedAnalytics = (
  threadId: string
): CachedClientAnalytics | null => {
  const entry = clientAnalyticsCache.get(threadId);
  if (!entry) {
    return null;
  }

  if (Date.now() - entry.timestamp > CLIENT_ANALYTICS_TTL_MS) {
    clientAnalyticsCache.delete(threadId);
    return null;
  }

  return entry;
};

const setClientCachedAnalytics = (
  threadId: string,
  entry: Omit<CachedClientAnalytics, "timestamp">
): void => {
  clientAnalyticsCache.set(threadId, {
    ...entry,
    timestamp: Date.now(),
  });
};

type MetricTileProps = {
  icon: ReactNode;
  label: string;
  value: string;
};

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const isCustomerAnalytics = (value: unknown): value is CustomerAnalytics => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const analytics = value as Record<string, unknown>;
  return (
    analytics.available === true &&
    typeof analytics.periodDays === "number" &&
    analytics.currency === "USD" &&
    typeof analytics.totalSalesUsd === "number" &&
    typeof analytics.confirmedOrderCount === "number" &&
    typeof analytics.averageInvoiceValueUsd === "number" &&
    (typeof analytics.daysSinceLastInvoice === "number" ||
      analytics.daysSinceLastInvoice === null) &&
    (typeof analytics.invoicesPerMonth === "number" ||
      analytics.invoicesPerMonth === null) &&
    (typeof analytics.uniqueProductsCount === "number" ||
      analytics.uniqueProductsCount === null)
  );
};

function ContextRow({ icon, label, value }: ContextRowProps) {
  return (
    <div className="flex items-start gap-3 rounded-xl px-3 py-2.5">
      <span className="mt-0.5 text-[rgb(var(--text-secondary))]">{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[rgb(var(--text-secondary)/var(--text-tertiary-opacity))]">
          {label}
        </p>
        <p className="mt-0.5 truncate text-sm font-medium text-[rgb(var(--text-primary))]">
          {value}
        </p>
      </div>
    </div>
  );
}

function MetricTile({ icon, label, value }: MetricTileProps) {
  return (
    <div className="rounded-xl border border-[rgb(var(--border-primary)/var(--border-primary-opacity))] bg-[rgb(var(--bg-secondary)/0.6)] p-3">
      <span className="mb-2 flex size-7 items-center justify-center rounded-lg bg-[rgb(var(--accent-primary)/0.12)] text-[rgb(var(--accent-primary))]">
        {icon}
      </span>
      <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[rgb(var(--text-secondary)/var(--text-tertiary-opacity))]">
        {label}
      </p>
      <p className="mt-1 text-base font-semibold tabular-nums text-[rgb(var(--text-primary))]">
        {value}
      </p>
    </div>
  );
}

export default function ConversationContext() {
  const {
    chatId,
    contact,
    group,
    threadName,
    partnerId,
    partnerName,
    partnerAvatar,
    hasAvatar,
    phoneNumber,
    backendId,
  } = useCurrentChat();
  const { backendNames, sessionId } = useAuth();
  const { locale, t } = useTranslations();
  const [odooBaseUrl, setOdooBaseUrl] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<CustomerAnalytics | null>(null);
  const [analyticsStatus, setAnalyticsStatus] =
    useState<AnalyticsStatus>("idle");

  useEffect(() => {
    let isActive = true;

    fetch("/api/config")
      .then((response) => response.json())
      .then((data) => {
        if (isActive && data.odooBaseUrl) {
          setOdooBaseUrl(data.odooBaseUrl);
        }
      })
      .catch(() => undefined);

    return () => {
      isActive = false;
    };
  }, []);

  const isCustomerConversation = Boolean(partnerId && !group);

  useEffect(() => {
    const controller = new AbortController();

    if (!chatId || !sessionId || !isCustomerConversation) {
      setAnalytics(null);
      setAnalyticsStatus("idle");
      return () => controller.abort();
    }

    const cacheKey = `${chatId}:${partnerId}`;
    const cached = getClientCachedAnalytics(cacheKey);
    if (cached) {
      setAnalytics(cached.analytics);
      setAnalyticsStatus(cached.status);
      return () => controller.abort();
    }

    setAnalytics(null);
    setAnalyticsStatus("loading");

    fetch(`/api/customer-context?threadId=${encodeURIComponent(chatId)}`, {
      headers: { "x-session-id": sessionId },
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = (await response.json()) as { analytics?: unknown };
        if (!response.ok) {
          throw new Error("Customer analytics request failed");
        }

        if (isCustomerAnalytics(data.analytics)) {
          setClientCachedAnalytics(cacheKey, {
            analytics: data.analytics,
            status: "available",
          });
          setAnalytics(data.analytics);
          setAnalyticsStatus("available");
          return;
        }

        setClientCachedAnalytics(cacheKey, {
          analytics: null,
          status: "unavailable",
        });
        setAnalyticsStatus("unavailable");
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        setAnalyticsStatus("error");
      });

    return () => controller.abort();
  }, [chatId, isCustomerConversation, partnerId, sessionId]);

  const displayName = useMemo(
    () =>
      group?.name ??
      partnerName ??
      contact?.displayName ??
      threadName ??
      t("context.unknownContact"),
    [contact?.displayName, group?.name, partnerName, t, threadName]
  );
  const backendName = backendId ? backendNames[backendId] : null;
  const partnerUrl =
    partnerId && odooBaseUrl
      ? `${odooBaseUrl}/web#id=${partnerId}&model=res.partner&view_type=form`
      : null;
  const metricsLocale = locale === "tr" ? "tr-TR" : "en-US";
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(metricsLocale, { maximumFractionDigits: 1 }),
    [metricsLocale]
  );
  const lastInvoiceLabel = analytics
    ? analytics.daysSinceLastInvoice === null
      ? t("context.noInvoices")
      : analytics.daysSinceLastInvoice === 0
        ? t("context.today")
        : t("context.daysAgo", { count: analytics.daysSinceLastInvoice })
    : "";

  if (!chatId) {
    return (
      <aside className="workspace-context hidden h-full min-h-0 flex-col items-center justify-center p-6 text-center xl:flex">
        <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-[rgb(var(--accent-primary)/0.12)] text-[rgb(var(--accent-primary))]">
          <ChatCircleDotsIcon className="size-7" weight="fill" />
        </div>
        <h2 className="text-base font-semibold text-[rgb(var(--text-primary))]">
          {t("context.emptyTitle")}
        </h2>
        <p className="mt-2 max-w-[22ch] text-sm leading-6 text-[rgb(var(--text-secondary))]">
          {t("context.emptyDescription")}
        </p>
      </aside>
    );
  }

  return (
    <aside className="workspace-context custom-scrollbar hidden h-full min-h-0 flex-col overflow-y-auto p-4 xl:flex">
      <header className="mb-4 flex items-center justify-between px-1">
        <p className="text-sm font-semibold text-[rgb(var(--text-primary))]">
          {t("context.title")}
        </p>
        <span className="rounded-md bg-[rgb(var(--status-success)/0.14)] px-2 py-1 text-[11px] font-semibold text-[rgb(var(--status-success))]">
          {t("context.channel")}
        </span>
      </header>

      <section className="surface-card rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <Profile
            size="12"
            url={
              group
                ? group.avatar || undefined
                : hasAvatar
                  ? (partnerAvatar ?? contact?.contactAvatar)
                  : undefined
            }
            alt={displayName}
            seed={partnerId ?? undefined}
            kind={group ? "group" : "person"}
          />
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-[rgb(var(--text-primary))]">
              {displayName}
            </p>
            <p className="mt-0.5 text-sm text-[rgb(var(--text-secondary))]">
              {group ? t("context.group") : t("context.customer")}
            </p>
          </div>
        </div>

        <div className="mt-4 border-t border-[rgb(var(--border-primary)/var(--border-primary-opacity))] pt-3">
          {phoneNumber && (
            <ContextRow
              icon={<PhoneIcon className="size-4" weight="bold" />}
              label={t("context.phone")}
              value={phoneNumber}
            />
          )}
          {backendName && (
            <ContextRow
              icon={<BuildingsIcon className="size-4" weight="bold" />}
              label={t("context.backend")}
              value={backendName}
            />
          )}
        </div>

        {isCustomerConversation && (
          <section
            className="mt-4 border-t border-[rgb(var(--border-primary)/var(--border-primary-opacity))] pt-4"
            aria-live="polite"
            aria-labelledby="customer-analytics-title"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <ChartLineUpIcon
                  className="size-4 text-[rgb(var(--accent-primary))]"
                  weight="bold"
                />
                <p
                  id="customer-analytics-title"
                  className="text-sm font-semibold text-[rgb(var(--text-primary))]"
                >
                  {t("context.analyticsTitle")}
                </p>
              </div>
              <span className="text-right text-[11px] font-medium text-[rgb(var(--text-secondary))]">
                {t("context.analyticsPeriod")}
              </span>
            </div>

            {analyticsStatus === "loading" && (
              <div className="mt-3 grid grid-cols-2 gap-2" aria-hidden="true">
                {[0, 1, 2, 3].map((index) => (
                  <div
                    key={index}
                    className="h-[104px] animate-pulse rounded-xl bg-[rgb(var(--bg-secondary))]"
                  />
                ))}
              </div>
            )}

            {analyticsStatus === "available" && analytics && (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <MetricTile
                    icon={
                      <CurrencyDollarIcon className="size-4" weight="bold" />
                    }
                    label={t("context.totalSales")}
                    value={usdFormatter.format(analytics.totalSalesUsd)}
                  />
                  <MetricTile
                    icon={<ShoppingBagIcon className="size-4" weight="bold" />}
                    label={t("context.confirmedOrders")}
                    value={numberFormatter.format(
                      analytics.confirmedOrderCount
                    )}
                  />
                  <MetricTile
                    icon={<ReceiptIcon className="size-4" weight="bold" />}
                    label={t("context.averageInvoice")}
                    value={usdFormatter.format(
                      analytics.averageInvoiceValueUsd
                    )}
                  />
                  <MetricTile
                    icon={<ClockIcon className="size-4" weight="bold" />}
                    label={t("context.lastInvoice")}
                    value={lastInvoiceLabel}
                  />
                </div>

                {(analytics.invoicesPerMonth !== null ||
                  analytics.uniqueProductsCount !== null) && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {analytics.invoicesPerMonth !== null && (
                      <div className="rounded-lg bg-[rgb(var(--bg-secondary)/0.45)] px-3 py-2">
                        <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[rgb(var(--text-secondary)/var(--text-tertiary-opacity))]">
                          {t("context.invoicesPerMonth")}
                        </p>
                        <p className="mt-0.5 text-sm font-semibold tabular-nums text-[rgb(var(--text-primary))]">
                          {numberFormatter.format(analytics.invoicesPerMonth)}
                        </p>
                      </div>
                    )}
                    {analytics.uniqueProductsCount !== null && (
                      <div className="rounded-lg bg-[rgb(var(--bg-secondary)/0.45)] px-3 py-2">
                        <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[rgb(var(--text-secondary)/var(--text-tertiary-opacity))]">
                          {t("context.productsPurchased")}
                        </p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold tabular-nums text-[rgb(var(--text-primary))]">
                          <PackageIcon
                            className="size-3.5 text-[rgb(var(--text-secondary))]"
                            weight="bold"
                          />
                          {numberFormatter.format(
                            analytics.uniqueProductsCount
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {analyticsStatus === "unavailable" && (
              <p className="mt-3 rounded-xl bg-[rgb(var(--bg-secondary)/0.65)] px-3 py-3 text-sm leading-5 text-[rgb(var(--text-secondary))]">
                {t("context.analyticsUnavailable")}
              </p>
            )}

            {analyticsStatus === "error" && (
              <p className="mt-3 rounded-xl bg-[rgb(var(--status-warning)/0.1)] px-3 py-3 text-sm leading-5 text-[rgb(var(--text-secondary))]">
                {t("context.analyticsError")}
              </p>
            )}
          </section>
        )}

        {partnerUrl && (
          <a
            className="primary-action mt-4 flex w-full items-center justify-center gap-2 px-3 py-2.5 text-sm font-semibold"
            href={partnerUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("chat.openInOdoo")}
            <ArrowSquareOut className="size-4" weight="bold" />
          </a>
        )}
      </section>
    </aside>
  );
}
