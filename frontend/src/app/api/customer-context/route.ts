import { NextRequest, NextResponse } from "next/server";
import { OdooClient } from "@/app/lib/odoo/jsonrpc";

const REQUIRED_ENV_VARS = [
  "ODOO_JSONRPC_HOST",
  "ODOO_JSONRPC_DATABASE",
] as const;

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

type CustomerAnalytics = {
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

const ensureEnv = () => {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }
};

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

export async function GET(request: NextRequest) {
  try {
    ensureEnv();
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Server configuration error",
      },
      { status: 500 }
    );
  }

  const threadIdValue = request.nextUrl.searchParams.get("threadId");
  const threadId = threadIdValue ? Number(threadIdValue) : Number.NaN;

  if (!Number.isSafeInteger(threadId) || threadId <= 0) {
    return NextResponse.json(
      { error: "threadId must be a valid positive integer" },
      { status: 400 }
    );
  }

  const sessionId = request.headers.get("x-session-id");
  if (!sessionId) {
    return NextResponse.json(
      { error: "Missing Odoo session id" },
      { status: 401 }
    );
  }

  const protocol: "http" | "https" =
    process.env.ODOO_JSONRPC_PROTOCOL === "https" ? "https" : "http";
  const portValue = process.env.ODOO_JSONRPC_PORT;
  const port = portValue ? Number(portValue) : undefined;

  if (typeof port !== "undefined" && !Number.isSafeInteger(port)) {
    return NextResponse.json(
      { error: "ODOO_JSONRPC_PORT must be a valid number" },
      { status: 500 }
    );
  }

  const odooClient = new OdooClient({
    host: process.env.ODOO_JSONRPC_HOST as string,
    port,
    protocol,
  });
  const sessionClient = odooClient.createSession(sessionId);

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

    const summary = await sessionClient.call<PartnerSummary>(
      "res.partner",
      "get_partner_summary",
      [[commercialPartnerId]],
      {},
      false
    );
    const totalSalesUsd = summaryNumber(summary, "total_order_amount_usd");
    const averageInvoiceValueUsd = summaryNumber(
      summary,
      "avg_order_value_usd"
    );

    if (totalSalesUsd === null || averageInvoiceValueUsd === null) {
      return NextResponse.json({ analytics: unavailable() });
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
    const daysSinceLastInvoice = summaryNumber(
      summary,
      "days_since_last_order"
    );
    const invoicesPerMonth = summaryNumber(summary, "order_frequency");
    const uniqueProductsCount = summaryNumber(summary, "unique_products_count");

    return NextResponse.json({
      analytics: {
        available: true,
        periodDays: ANALYTICS_PERIOD_DAYS,
        currency: "USD",
        totalSalesUsd,
        confirmedOrderCount,
        averageInvoiceValueUsd,
        daysSinceLastInvoice:
          daysSinceLastInvoice === null
            ? null
            : Math.max(0, daysSinceLastInvoice),
        invoicesPerMonth,
        uniqueProductsCount:
          uniqueProductsCount === null
            ? null
            : Math.max(0, uniqueProductsCount),
      } satisfies CustomerAnalytics,
    });
  } catch (error) {
    console.error("[CustomerContext] Failed to load analytics:", error);
    return NextResponse.json(
      { error: "Unable to load customer analytics" },
      { status: 502 }
    );
  }
}
