import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  const sessionClient = {
    searchRead: vi.fn(),
    read: vi.fn(),
    call: vi.fn(),
    count: vi.fn(),
  };
  const createSession = vi.fn(() => sessionClient);
  const OdooClient = vi.fn(() => ({ createSession }));

  return { OdooClient, createSession, sessionClient };
});

vi.mock("@/app/lib/odoo/jsonrpc", () => ({
  OdooClient: mocks.OdooClient,
}));

import { GET } from "./route";

const requestFor = (threadId: string, withSession = true) =>
  new NextRequest(
    `http://localhost/api/customer-context?threadId=${threadId}`,
    {
      headers: withSession ? { "x-session-id": "s".repeat(40) } : {},
    }
  );

const summary = {
  total_order_amount_usd: { value: 2450.5 },
  avg_order_value_usd: { value: 490.1 },
  days_since_last_order: { value: 8 },
  order_frequency: { value: 0.42 },
  unique_products_count: { value: 12 },
};

const originalEnv = {
  host: process.env.ODOO_JSONRPC_HOST,
  database: process.env.ODOO_JSONRPC_DATABASE,
  protocol: process.env.ODOO_JSONRPC_PROTOCOL,
  port: process.env.ODOO_JSONRPC_PORT,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ODOO_JSONRPC_HOST = "odoo.test";
  process.env.ODOO_JSONRPC_DATABASE = "16test2";
  process.env.ODOO_JSONRPC_PROTOCOL = "http";
  process.env.ODOO_JSONRPC_PORT = "8069";
});

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    const environmentKey = `ODOO_JSONRPC_${key.toUpperCase()}`;
    if (value === undefined) {
      delete process.env[environmentKey];
    } else {
      process.env[environmentKey] = value;
    }
  }
});

describe("GET /api/customer-context", () => {
  it("rejects invalid thread ids before calling Odoo", async () => {
    const response = await GET(requestFor("not-a-number"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "threadId must be a valid positive integer",
    });
    expect(mocks.OdooClient).not.toHaveBeenCalled();
  });

  it("returns access-scoped USD analytics for the thread's commercial partner", async () => {
    mocks.sessionClient.searchRead.mockResolvedValue([
      { id: 77, partner_id: [12, "Contact"] },
    ]);
    mocks.sessionClient.read
      .mockResolvedValueOnce([
        { id: 12, commercial_partner_id: [10, "Commercial customer"] },
      ])
      .mockResolvedValueOnce([{ id: 10 }]);
    mocks.sessionClient.call.mockResolvedValue(summary);
    mocks.sessionClient.count.mockResolvedValue(5);

    const response = await GET(requestFor("77"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      analytics: {
        available: true,
        periodDays: 720,
        currency: "USD",
        totalSalesUsd: 2450.5,
        confirmedOrderCount: 5,
        averageInvoiceValueUsd: 490.1,
        daysSinceLastInvoice: 8,
        invoicesPerMonth: 0.42,
        uniqueProductsCount: 12,
      },
    });
    expect(mocks.sessionClient.call).toHaveBeenCalledWith(
      "res.partner",
      "get_partner_summary",
      [[10]],
      {},
      false
    );
    expect(mocks.sessionClient.count).toHaveBeenCalledWith(
      "sale.order",
      expect.arrayContaining([
        ["partner_id", "child_of", 10],
        ["state", "in", ["sale", "done"]],
      ])
    );
  });

  it("returns an unavailable result when the accessible thread has no partner", async () => {
    mocks.sessionClient.searchRead.mockResolvedValue([
      { id: 77, partner_id: false },
    ]);

    const response = await GET(requestFor("77"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ analytics: { available: false } });
    expect(mocks.sessionClient.read).not.toHaveBeenCalled();
    expect(mocks.sessionClient.call).not.toHaveBeenCalled();
  });
});
