import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const sessionClient = { call: vi.fn() };
  // vitest 4 constructs mocks with Reflect.construct, so `new OdooClient()`
  // needs a real function here, not an arrow.
  const OdooClient = vi.fn(function () {
    return { createSession: () => sessionClient };
  });
  return { OdooClient, sessionClient };
});

vi.mock("@/app/lib/odoo/jsonrpc", () => ({ OdooClient: mocks.OdooClient }));

import { POST } from "./route";

const validate = () =>
  POST(
    new Request("http://localhost/api/auth/validate-session", {
      method: "POST",
      body: JSON.stringify({ sessionId: "s".repeat(40) }),
    })
  );

const odooError = (code: number, name: string) =>
  Object.assign(new Error("Odoo error"), { code, data: { name } });

describe("POST /api/auth/validate-session", () => {
  beforeEach(() => {
    vi.stubEnv("ODOO_JSONRPC_HOST", "odoo.test");
    vi.stubEnv("ODOO_JSONRPC_DATABASE", "test");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("rejects an expired session with 401", async () => {
    mocks.sessionClient.call.mockRejectedValue(
      odooError(100, "odoo.http.SessionExpiredException")
    );
    expect((await validate()).status).toBe(401);
  });

  it("rejects a session without a user with 401", async () => {
    mocks.sessionClient.call.mockResolvedValue({ uid: false });
    expect((await validate()).status).toBe(401);
  });

  it("keeps the session when Odoo cannot be reached", async () => {
    mocks.sessionClient.call.mockRejectedValue(new TypeError("fetch failed"));
    expect((await validate()).status).toBe(500);
  });
});
