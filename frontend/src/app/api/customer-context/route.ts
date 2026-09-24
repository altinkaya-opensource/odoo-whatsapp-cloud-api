import { NextRequest, NextResponse } from "next/server";
import type { OdooSessionClient } from "@/app/lib/odoo/jsonrpc";
import { odooErrorResponse, requireSession } from "@/app/lib/odoo/server";
import {
  type CustomerAnalytics,
  customerContextCache,
} from "@/app/lib/customer-context-cache";

const ANALYTICS_PERIOD_DAYS = 720;

type OdooThreadRecord = {
  id: number;
  partner_id: false | number | [number, string] | null;
};

type OdooPartnerRecord = {
  id: number;
  commercial_partner_id: false | number | [number, string] | null;
};

type OdooPartnerAccessRecord = {
  id: number;
};

type SummaryEntry = {
  value?: unknown;
};

type PartnerSummary = Record<string, SummaryEntry | undefined>;

const asId = (value: OdooThreadRecord["partner_id"]): number | null => {
  if (Array.isArray(value)) {
    return typeof value[0] === "number" ? value[0] : null;
  }
  return typeof value === "number" ? value : null;
};

const summaryNumber = (summary: PartnerSummary, key: string): number | null => {
  const value = summary[key]?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const unavailable = (): CustomerAnalytics => ({ available: false });

const loadPartnerAnalytics = async (
  sessionClient: OdooSessionClient,
  commercialPartnerId: number
): Promise<CustomerAnalytics> => {
  const summary = await sessionClient.call<PartnerSummary>(
    "res.partner",
    "get_partner_summary",
    [[commercialPartnerId]],
    {},
    false
  );
  const totalSalesUsd = summaryNumber(summary, "total_order_amount_usd");
  const averageInvoiceValueUsd = summaryNumber(summary, "avg_order_value_usd");

  if (totalSalesUsd === null || averageInvoiceValueUsd === null) {
    return unavailable();
  }

  const periodStart = new Date();
  periodStart.setUTCDate(periodStart.getUTCDate() - ANALYTICS_PERIOD_DAYS);
  const periodEndExclusive = new Date();
  periodEndExclusive.setUTCDate(periodEndExclusive.getUTCDate() + 1);
  const confirmedOrderCount = await sessionClient.count("sale.order", [
    ["partner_id", "child_of", commercialPartnerId],
    ["state", "in", ["sale", "done"]],
    ["date_order", ">=", periodStart.toISOString().slice(0, 10)],
    ["date_order", "<", periodEndExclusive.toISOString().slice(0, 10)],
  ]);
  const daysSinceLastInvoice = summaryNumber(summary, "days_since_last_order");
  const invoicesPerMonth = summaryNumber(summary, "order_frequency");
  const uniqueProductsCount = summaryNumber(summary, "unique_products_count");

  return {
    available: true,
    periodDays: ANALYTICS_PERIOD_DAYS,
    currency: "USD",
    totalSalesUsd,
    confirmedOrderCount,
    averageInvoiceValueUsd,
    daysSinceLastInvoice:
      daysSinceLastInvoice === null ? null : Math.max(0, daysSinceLastInvoice),
    invoicesPerMonth,
    uniqueProductsCount:
      uniqueProductsCount === null ? null : Math.max(0, uniqueProductsCount),
  };
};

export async function GET(request: NextRequest) {
  const threadIdValue = request.nextUrl.searchParams.get("threadId");
  const threadId = threadIdValue ? Number(threadIdValue) : Number.NaN;

  if (!Number.isSafeInteger(threadId) || threadId <= 0) {
    return NextResponse.json(
      { error: "threadId must be a valid positive integer" },
      { status: 400 }
    );
  }

  const auth = await requireSession(request);
  if ("response" in auth) {
    return auth.response;
  }
  const { sessionId, session: sessionClient } = auth;

  try {
    // Resolve the partner from an access-controlled thread. The browser never
    // supplies a partner ID, so users cannot request another customer's data.
    const threads = await sessionClient.searchRead<OdooThreadRecord[]>(
      "whatsapp.thread",
      [["id", "=", threadId]],
      { limit: 1, select: ["partner_id"] }
    );
    const partnerId = threads[0] ? asId(threads[0].partner_id) : null;

    if (!partnerId) {
      return NextResponse.json({ analytics: unavailable() });
    }

    const partners = await sessionClient.read<OdooPartnerRecord[]>(
      "res.partner",
      [partnerId],
      { select: ["commercial_partner_id"] }
    );
    const commercialPartnerId = partners[0]
      ? asId(partners[0].commercial_partner_id)
      : null;

    if (!commercialPartnerId) {
      return NextResponse.json({ analytics: unavailable() });
    }

    // The commercial parent may differ from the contact on the thread. Verify
    // that parent under the current session before invoking its public method.
    const accessibleCommercialPartners = await sessionClient.read<
      OdooPartnerAccessRecord[]
    >("res.partner", [commercialPartnerId], { select: ["display_name"] });

    if (
      !accessibleCommercialPartners.some(
        (partner) => partner.id === commercialPartnerId
      )
    ) {
      return NextResponse.json({ analytics: unavailable() });
    }

    const analytics = await customerContextCache.getOrLoad(
      sessionId,
      commercialPartnerId,
      () => loadPartnerAnalytics(sessionClient, commercialPartnerId)
    );

    return NextResponse.json({ analytics });
  } catch (error) {
    // Users without sales or invoicing rights have no analytics to see
    if (
      (error as { data?: { name?: string } }).data?.name ===
      "odoo.exceptions.AccessError"
    ) {
      return NextResponse.json({ analytics: unavailable() });
    }
    return odooErrorResponse(error, "Unable to load customer analytics");
  }
}
