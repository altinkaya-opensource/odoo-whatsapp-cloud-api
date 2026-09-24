import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionCache } from "@/app/lib/session-cache";
import { accountFailures, addressFailures } from "@/app/lib/rate-limit";

const SESSION_ID = "e".repeat(40);

const mocks = vi.hoisted(() => {
  const session = { call: vi.fn() };
  const authenticate = vi.fn();
  // vitest 4 constructs mocks with Reflect.construct, so `new OdooClient()`
  // needs a real function here, not an arrow.
  const OdooClient = vi.fn(function () {
    return { authenticate };
  });
  return { OdooClient, authenticate, session };
});

vi.mock("@/app/lib/odoo/jsonrpc", () => ({ OdooClient: mocks.OdooClient }));

import { POST } from "./route";

const login = (username = "agent", address = "203.0.113.7") =>
  POST(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "x-real-ip": address },
      body: JSON.stringify({ username, password: "secret" }),
    })
  );

const wrongPassword = Object.assign(new Error("Access Denied"), {
  data: {
    name: "odoo.exceptions.AccessDenied",
    message: "Wrong login/password",
  },
});

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.stubEnv("ODOO_JSONRPC_HOST", "odoo.test");
    vi.stubEnv("ODOO_JSONRPC_DATABASE", "test");
    mocks.session.call.mockResolvedValue({ backend_ids: [1] });
  });

  afterEach(() => {
    sessionCache.clear();
    accountFailures.clear();
    addressFailures.clear();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("puts the session in an HttpOnly cookie, never in the body", async () => {
    mocks.authenticate.mockResolvedValue({
      sessionId: SESSION_ID,
      result: { uid: 7 },
      session: mocks.session,
    });

    const response = await login();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain(SESSION_ID);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`whatsapp_session=${SESSION_ID}`);
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it("keeps a TOTP half-session out of the session cookie", async () => {
    mocks.authenticate.mockResolvedValue({
      sessionId: SESSION_ID,
      result: { uid: null },
      session: mocks.session,
    });

    const response = await login();

    expect(await response.json()).toEqual({ totpRequired: true });
    expect(response.headers.get("set-cookie")).not.toContain(
      "whatsapp_session="
    );
  });

  it("stops guessing one account before Odoo locks everyone out", async () => {
    mocks.authenticate.mockRejectedValue(wrongPassword);
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await login("Agent", `198.51.100.${attempt}`)).status).toBe(401);
    }

    const blocked = await login("agent", "198.51.100.99");
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "too_many_attempts" });
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(mocks.authenticate).toHaveBeenCalledTimes(5);

    // Colleagues behind the same address still get in
    mocks.authenticate.mockResolvedValue({
      sessionId: SESSION_ID,
      result: { uid: 8 },
      session: mocks.session,
    });
    expect((await login("colleague", "198.51.100.0")).status).toBe(200);
  });
});
